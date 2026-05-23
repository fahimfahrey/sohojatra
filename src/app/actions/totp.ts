"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient as createAdminClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth/require-user";
import { validateCsrfToken } from "@/lib/security/csrf";
import { checkRateLimit } from "@/lib/rate-limit/server";
import { logAuditEvent } from "@/lib/audit";
import {
  totpCodeSchema,
  recoveryCodeSchema,
  type ActionResult,
} from "@/lib/validation/schemas";
import {
  buildOtpauthUri,
  formatSecretForDisplay,
  formatRecoveryCodeForDisplay,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
} from "@/lib/totp";
import {
  TOTP_PASSED_COOKIE,
  TOTP_STEPUP_COOKIE,
  buildTotpPassedCookie,
  buildTotpStepupCookie,
} from "@/lib/auth/totp-cookies";

const CSRF_ERROR: ActionResult<never> = {
  success: false,
  error: "Invalid or missing CSRF token",
};

function safeRedirectPath(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) {
    return "/dashboard";
  }
  return next;
}

function getAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("Service-role Supabase credentials missing");
  }
  return createAdminClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

async function setTotpAppMetadata(
  userId: string,
  totpEnabled: boolean,
): Promise<void> {
  const admin = getAdminClient();
  const { error } = await admin.auth.admin.updateUserById(userId, {
    app_metadata: { totp_enabled: totpEnabled },
  });
  if (error) {
    throw new Error(`app_metadata update failed: ${error.message}`);
  }
}

export async function startTotpEnrollmentAction(
  csrfToken: string,
): Promise<ActionResult<{ otpauthUri: string; secretFormatted: string }>> {
  if (!(await validateCsrfToken(csrfToken))) return CSRF_ERROR;

  let user;
  try {
    user = await requireUser();
  } catch {
    return { success: false, error: "Unauthorized" };
  }

  if (user.app_metadata?.totp_enabled === true) {
    return { success: false, error: "Two-factor authentication is already enabled" };
  }

  if (!(await checkRateLimit(`totp:enroll_start:${user.id}`, 5, 60 * 60 * 1000))) {
    await logAuditEvent({
      action: "auth.totp.enroll_start",
      outcome: "failure",
      userId: user.id,
      detail: { reason: "rate_limited" },
    });
    return { success: false, error: "Too many attempts. Try again later." };
  }

  const { secretHex, secretBase32 } = generateTotpSecret();
  const accountLabel = user.email ?? user.id;
  const otpauthUri = buildOtpauthUri({ secretBase32, accountLabel });

  const supabase = await createClient();
  const { error } = await supabase.rpc("set_pending_totp_secret", {
    p_secret_hex: secretHex,
  });
  if (error) {
    await logAuditEvent({
      action: "auth.totp.enroll_start",
      outcome: "failure",
      userId: user.id,
      detail: { reason: "rpc_error", code: error.code ?? null },
    });
    return { success: false, error: "Could not start enrollment. Try again." };
  }

  await logAuditEvent({
    action: "auth.totp.enroll_start",
    outcome: "success",
    userId: user.id,
  });

  return {
    success: true,
    data: { otpauthUri, secretFormatted: formatSecretForDisplay(secretBase32) },
  };
}

export async function confirmTotpEnrollmentAction(
  _prev: ActionResult<{ recoveryCodes: string[] }> | null,
  formData: FormData,
): Promise<ActionResult<{ recoveryCodes: string[] }>> {
  const csrfToken = formData.get("csrfToken")?.toString();
  if (!(await validateCsrfToken(csrfToken))) return CSRF_ERROR;

  let user;
  try {
    user = await requireUser();
  } catch {
    return { success: false, error: "Unauthorized" };
  }

  if (!(await checkRateLimit(`totp:enroll_confirm:${user.id}`, 10, 15 * 60 * 1000))) {
    await logAuditEvent({
      action: "auth.totp.enroll_complete",
      outcome: "failure",
      userId: user.id,
      detail: { reason: "rate_limited" },
    });
    return { success: false, error: "Too many attempts. Try again later." };
  }

  const parsed = totpCodeSchema.safeParse(formData.get("code"));
  if (!parsed.success) {
    await logAuditEvent({
      action: "auth.totp.enroll_complete",
      outcome: "failure",
      userId: user.id,
      detail: { reason: "invalid_input" },
    });
    return { success: false, error: "Invalid verification code" };
  }

  const supabase = await createClient();
  const { data: verified, error: verifyError } = await supabase.rpc(
    "verify_totp_code",
    { p_code: parsed.data, p_use_pending: true },
  );

  if (verifyError) {
    await logAuditEvent({
      action: "auth.totp.enroll_complete",
      outcome: "failure",
      userId: user.id,
      detail: { reason: "rpc_error", code: verifyError.code ?? null },
    });
    return { success: false, error: "Verification failed. Please try again." };
  }

  if (!verified) {
    return { success: false, error: "Invalid verification code" };
  }

  const codes = generateRecoveryCodes();
  const hashes = codes.map(hashRecoveryCode);

  const { error: codesError } = await supabase.rpc("set_totp_recovery_codes", {
    p_hashes: hashes,
  });
  if (codesError) {
    await supabase.rpc("disable_totp");
    await logAuditEvent({
      action: "auth.totp.enroll_complete",
      outcome: "failure",
      userId: user.id,
      detail: { reason: "recovery_persist_failed" },
    });
    return { success: false, error: "Could not finish enrollment. Try again." };
  }

  try {
    await setTotpAppMetadata(user.id, true);
  } catch {
    await supabase.rpc("disable_totp");
    await logAuditEvent({
      action: "auth.totp.enroll_complete",
      outcome: "failure",
      userId: user.id,
      detail: { reason: "metadata_update_failed" },
    });
    return { success: false, error: "Could not finish enrollment. Try again." };
  }

  const store = await cookies();
  const passed = buildTotpPassedCookie(user.id);
  store.set(passed.name, passed.value, passed.options);

  await logAuditEvent({
    action: "auth.totp.enroll_complete",
    outcome: "success",
    userId: user.id,
  });

  revalidatePath("/dashboard");
  return {
    success: true,
    data: { recoveryCodes: codes.map(formatRecoveryCodeForDisplay) },
  };
}

export async function submitTotpChallengeAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const csrfToken = formData.get("csrfToken")?.toString();
  if (!(await validateCsrfToken(csrfToken))) return CSRF_ERROR;

  let user;
  try {
    user = await requireUser();
  } catch {
    return { success: false, error: "Unauthorized" };
  }

  if (user.app_metadata?.totp_enabled !== true) {
    return { success: false, error: "Two-factor authentication is not enabled" };
  }

  if (!(await checkRateLimit(`totp:challenge:${user.id}`, 5, 15 * 60 * 1000))) {
    await logAuditEvent({
      action: "auth.totp.verify",
      outcome: "failure",
      userId: user.id,
      detail: { reason: "rate_limited", kind: "challenge" },
    });
    return { success: false, error: "Too many attempts. Try again later." };
  }

  const parsed = totpCodeSchema.safeParse(formData.get("code"));
  if (!parsed.success) {
    return { success: false, error: "Invalid verification code" };
  }

  const supabase = await createClient();
  const { data: verified, error } = await supabase.rpc("verify_totp_code", {
    p_code: parsed.data,
    p_use_pending: false,
  });

  if (error) {
    await logAuditEvent({
      action: "auth.totp.verify",
      outcome: "failure",
      userId: user.id,
      detail: { reason: "rpc_error", kind: "challenge", code: error.code ?? null },
    });
    return { success: false, error: "Verification failed. Please try again." };
  }

  if (!verified) {
    return { success: false, error: "Invalid verification code" };
  }

  const store = await cookies();
  const passed = buildTotpPassedCookie(user.id);
  store.set(passed.name, passed.value, passed.options);

  await logAuditEvent({
    action: "auth.totp.verify",
    outcome: "success",
    userId: user.id,
    detail: { kind: "challenge" },
  });

  redirect(safeRedirectPath(formData.get("next")?.toString()));
}

export async function submitTotpRecoveryAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const csrfToken = formData.get("csrfToken")?.toString();
  if (!(await validateCsrfToken(csrfToken))) return CSRF_ERROR;

  let user;
  try {
    user = await requireUser();
  } catch {
    return { success: false, error: "Unauthorized" };
  }

  if (user.app_metadata?.totp_enabled !== true) {
    return { success: false, error: "Two-factor authentication is not enabled" };
  }

  if (!(await checkRateLimit(`totp:recovery:${user.id}`, 5, 60 * 60 * 1000))) {
    await logAuditEvent({
      action: "auth.totp.recovery_use",
      outcome: "failure",
      userId: user.id,
      detail: { reason: "rate_limited" },
    });
    return { success: false, error: "Too many attempts. Try again later." };
  }

  const parsed = recoveryCodeSchema.safeParse(formData.get("code"));
  if (!parsed.success) {
    return { success: false, error: "Invalid recovery code" };
  }

  const supabase = await createClient();
  const { data: consumed, error } = await supabase.rpc(
    "consume_totp_recovery_code",
    { p_hash: hashRecoveryCode(parsed.data) },
  );

  if (error) {
    await logAuditEvent({
      action: "auth.totp.recovery_use",
      outcome: "failure",
      userId: user.id,
      detail: { reason: "rpc_error", code: error.code ?? null },
    });
    return { success: false, error: "Verification failed. Please try again." };
  }

  if (!consumed) {
    return { success: false, error: "Invalid recovery code" };
  }

  const store = await cookies();
  const passed = buildTotpPassedCookie(user.id);
  store.set(passed.name, passed.value, passed.options);

  await logAuditEvent({
    action: "auth.totp.recovery_use",
    outcome: "success",
    userId: user.id,
  });

  redirect(safeRedirectPath(formData.get("next")?.toString()));
}

export async function submitTotpStepUpAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const csrfToken = formData.get("csrfToken")?.toString();
  if (!(await validateCsrfToken(csrfToken))) return CSRF_ERROR;

  let user;
  try {
    user = await requireUser();
  } catch {
    return { success: false, error: "Unauthorized" };
  }

  if (user.app_metadata?.totp_enabled !== true) {
    return { success: false, error: "Two-factor authentication is not enabled" };
  }

  if (!(await checkRateLimit(`totp:stepup:${user.id}`, 10, 15 * 60 * 1000))) {
    await logAuditEvent({
      action: "auth.totp.stepup",
      outcome: "failure",
      userId: user.id,
      detail: { reason: "rate_limited" },
    });
    return { success: false, error: "Too many attempts. Try again later." };
  }

  const parsed = totpCodeSchema.safeParse(formData.get("code"));
  if (!parsed.success) {
    return { success: false, error: "Invalid verification code" };
  }

  const supabase = await createClient();
  const { data: verified, error } = await supabase.rpc("verify_totp_code", {
    p_code: parsed.data,
    p_use_pending: false,
  });

  if (error) {
    await logAuditEvent({
      action: "auth.totp.stepup",
      outcome: "failure",
      userId: user.id,
      detail: { reason: "rpc_error", code: error.code ?? null },
    });
    return { success: false, error: "Verification failed. Please try again." };
  }

  if (!verified) {
    return { success: false, error: "Invalid verification code" };
  }

  const store = await cookies();
  const stepup = buildTotpStepupCookie(user.id);
  store.set(stepup.name, stepup.value, stepup.options);

  await logAuditEvent({
    action: "auth.totp.stepup",
    outcome: "success",
    userId: user.id,
  });

  redirect(safeRedirectPath(formData.get("next")?.toString()));
}

export async function disableTotpAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const csrfToken = formData.get("csrfToken")?.toString();
  if (!(await validateCsrfToken(csrfToken))) return CSRF_ERROR;

  let user;
  try {
    user = await requireUser();
  } catch {
    return { success: false, error: "Unauthorized" };
  }

  if (user.app_metadata?.totp_enabled !== true) {
    return { success: false, error: "Two-factor authentication is not enabled" };
  }

  if (!(await checkRateLimit(`totp:disable:${user.id}`, 3, 60 * 60 * 1000))) {
    await logAuditEvent({
      action: "auth.totp.disable",
      outcome: "failure",
      userId: user.id,
      detail: { reason: "rate_limited" },
    });
    return { success: false, error: "Too many attempts. Try again later." };
  }

  const password = formData.get("password")?.toString();
  const code = formData.get("code")?.toString();

  if (!password || password.length < 1) {
    return { success: false, error: "Password is required" };
  }
  const parsedCode = totpCodeSchema.safeParse(code);
  if (!parsedCode.success) {
    return { success: false, error: "Invalid verification code" };
  }
  if (!user.email) {
    return { success: false, error: "Account has no email; cannot verify password" };
  }

  const supabase = await createClient();
  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: user.email,
    password,
  });
  if (signInError) {
    await logAuditEvent({
      action: "auth.totp.disable",
      outcome: "failure",
      userId: user.id,
      detail: { reason: "password_invalid" },
    });
    return { success: false, error: "Password does not match" };
  }

  const { data: verified, error: verifyError } = await supabase.rpc(
    "verify_totp_code",
    { p_code: parsedCode.data, p_use_pending: false },
  );
  if (verifyError) {
    await logAuditEvent({
      action: "auth.totp.disable",
      outcome: "failure",
      userId: user.id,
      detail: { reason: "rpc_error", code: verifyError.code ?? null },
    });
    return { success: false, error: "Verification failed. Please try again." };
  }
  if (!verified) {
    await logAuditEvent({
      action: "auth.totp.disable",
      outcome: "failure",
      userId: user.id,
      detail: { reason: "invalid_code" },
    });
    return { success: false, error: "Invalid verification code" };
  }

  const { error: disableError } = await supabase.rpc("disable_totp");
  if (disableError) {
    await logAuditEvent({
      action: "auth.totp.disable",
      outcome: "failure",
      userId: user.id,
      detail: { reason: "rpc_error", code: disableError.code ?? null },
    });
    return { success: false, error: "Could not disable. Try again." };
  }

  try {
    await setTotpAppMetadata(user.id, false);
  } catch {
    await logAuditEvent({
      action: "auth.totp.disable",
      outcome: "failure",
      userId: user.id,
      detail: { reason: "metadata_update_failed" },
    });
    return { success: false, error: "Could not disable. Try again." };
  }

  const store = await cookies();
  store.delete(TOTP_PASSED_COOKIE);
  store.delete(TOTP_STEPUP_COOKIE);

  await logAuditEvent({
    action: "auth.totp.disable",
    outcome: "success",
    userId: user.id,
  });

  revalidatePath("/dashboard");
  return { success: true };
}
