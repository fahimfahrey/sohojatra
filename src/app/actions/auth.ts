"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/rate-limit/server";
import { logAuditEvent } from "@/lib/audit";
import { captureError } from "@/lib/observability/sentry";
import {
  TOTP_PASSED_COOKIE,
  TOTP_STEPUP_COOKIE,
} from "@/lib/auth/totp-cookies";
import {
  signInSchema,
  signUpSchema,
  emailSchema,
  type ActionResult,
} from "@/lib/validation/schemas";

function safeRedirectPath(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) {
    return "/dashboard";
  }
  return next;
}

async function getClientIp(): Promise<string> {
  const headersList = await headers();
  return (
    headersList.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    headersList.get("x-real-ip") ??
    "unknown"
  );
}

async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function ensureUserProfile(
  userId: string,
  email: string,
  name: string,
) {
  const supabase = await createClient();
  const { data: existingUser } = await supabase
    .from("users")
    .select("id")
    .eq("id", userId)
    .maybeSingle();

  if (!existingUser) {
    await supabase.from("users").upsert({
      id: userId,
      email,
      name,
    });
  }
}

export async function signInAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    await logAuditEvent({
      action: "auth.signin",
      outcome: "failure",
      detail: { reason: "invalid_input" },
    });
    return { success: false, error: "Invalid email or password" };
  }

  const ip = await getClientIp();
  const rateKey = `login:${ip}:${parsed.data.email.toLowerCase()}`;
  if (!(await checkRateLimit(rateKey, 5, 15 * 60 * 1000))) {
    await logAuditEvent({
      action: "auth.signin",
      outcome: "failure",
      detail: { reason: "rate_limited", email: parsed.data.email },
    });
    return {
      success: false,
      error: "Too many login attempts. Please try again later.",
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error || !data.user) {
    await logAuditEvent({
      action: "auth.signin",
      outcome: "failure",
      detail: { reason: "invalid_credentials", email: parsed.data.email },
    });
    if (error && error.status && error.status >= 500) {
      captureError(error, {
        action: "auth.signin",
        severity: "critical",
        reason: "supabase_5xx",
      });
    }
    return { success: false, error: "Invalid email or password" };
  }

  await logAuditEvent({
    action: "auth.signin",
    outcome: "success",
    userId: data.user.id,
    resourceId: data.user.id,
  });

  const userName =
    (data.user.user_metadata?.name as string | undefined) ??
    (data.user.user_metadata?.full_name as string | undefined) ??
    parsed.data.email.split("@")[0];

  await ensureUserProfile(data.user.id, parsed.data.email, userName);
  revalidatePath("/", "layout");
  redirect(safeRedirectPath(formData.get("next")?.toString()));
}

export async function signUpAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = signUpSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    name: formData.get("name"),
  });

  if (!parsed.success) {
    await logAuditEvent({
      action: "auth.signup",
      outcome: "failure",
      detail: { reason: "invalid_input" },
    });
    return { success: false, error: "Please check your registration details" };
  }

  const ip = await getClientIp();
  if (!(await checkRateLimit(`signup:${ip}`, 3, 60 * 60 * 1000))) {
    await logAuditEvent({
      action: "auth.signup",
      outcome: "failure",
      detail: { reason: "rate_limited", email: parsed.data.email },
    });
    return {
      success: false,
      error: "Too many sign-up attempts. Please try again later.",
    };
  }

  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { name: parsed.data.name },
      emailRedirectTo: `${siteUrl}/auth/callback?next=/dashboard`,
    },
  });

  if (error) {
    await logAuditEvent({
      action: "auth.signup",
      outcome: "failure",
      detail: { reason: "supabase_error", email: parsed.data.email },
    });
    captureError(error, {
      action: "auth.signup",
      severity: "critical",
      reason: "supabase_error",
    });
    return {
      success: false,
      error:
        "Unable to complete registration. If you already have an account, try signing in.",
    };
  }

  if (data.user) {
    await ensureUserProfile(data.user.id, parsed.data.email, parsed.data.name);
  }

  await logAuditEvent({
    action: "auth.signup",
    outcome: "success",
    userId: data.user?.id ?? null,
    resourceId: data.user?.id ?? null,
  });

  revalidatePath("/", "layout");
  redirect("/email-confirmation");
}

export async function signOutAction(): Promise<void> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  await supabase.auth.signOut();
  const store = await cookies();
  store.delete(TOTP_PASSED_COOKIE);
  store.delete(TOTP_STEPUP_COOKIE);
  await logAuditEvent({
    action: "auth.signout",
    outcome: "success",
    userId: user?.id ?? null,
    resourceId: user?.id ?? null,
  });
  revalidatePath("/", "layout");
  redirect("/");
}

export async function requestPasswordResetAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = emailSchema.safeParse(formData.get("email"));

  if (!parsed.success) {
    await logAuditEvent({
      action: "auth.reset.request",
      outcome: "failure",
      detail: { reason: "invalid_input" },
    });
    return { success: true };
  }

  const email = parsed.data.toLowerCase();
  const emailHash = await sha256Hex(email);
  const ip = await getClientIp();

  const ipOk = await checkRateLimit(`reset:req:ip:${ip}`, 3, 60 * 60 * 1000);
  const emailOk = await checkRateLimit(
    `reset:req:email:${emailHash}`,
    3,
    24 * 60 * 60 * 1000,
  );

  if (!ipOk || !emailOk) {
    await logAuditEvent({
      action: "auth.reset.rate_limited",
      outcome: "failure",
      detail: { reason: "rate_limited", emailHash },
    });
    return { success: true };
  }

  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const redirectTo = `${siteUrl}/auth/callback?next=/reset-password`;

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo,
  });

  await logAuditEvent({
    action: "auth.reset.request",
    outcome: error ? "failure" : "success",
    detail: error
      ? { reason: "supabase_error", emailHash }
      : { emailHash },
  });

  return { success: true };
}

const resetPasswordSchema = signUpSchema.shape.password;

export async function confirmPasswordResetAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    await logAuditEvent({
      action: "auth.reset.confirm",
      outcome: "failure",
      detail: { reason: "no_session" },
    });
    return {
      success: false,
      error: "Reset link expired. Request a new one.",
    };
  }

  const parsed = resetPasswordSchema.safeParse(formData.get("password"));
  if (!parsed.success) {
    await logAuditEvent({
      action: "auth.reset.confirm",
      outcome: "failure",
      userId: user.id,
      detail: { reason: "invalid_input" },
    });
    return {
      success: false,
      error: "Password must be at least 8 characters.",
    };
  }

  const limitKey = `reset:confirm:user:${user.id}`;
  if (!(await checkRateLimit(limitKey, 5, 15 * 60 * 1000))) {
    await logAuditEvent({
      action: "auth.reset.confirm",
      outcome: "failure",
      userId: user.id,
      detail: { reason: "rate_limited" },
    });
    return {
      success: false,
      error: "Too many attempts. Try again later.",
    };
  }

  const { error } = await supabase.auth.updateUser({ password: parsed.data });
  if (error) {
    await logAuditEvent({
      action: "auth.reset.confirm",
      outcome: "failure",
      userId: user.id,
      detail: { reason: "update_failed" },
    });
    return {
      success: false,
      error: "Could not update password. Please request a new reset link.",
    };
  }

  await supabase.auth.signOut({ scope: "others" });

  await logAuditEvent({
    action: "auth.reset.confirm",
    outcome: "success",
    userId: user.id,
    resourceId: user.id,
  });

  revalidatePath("/", "layout");
  redirect("/login?reset=ok");
}

export async function signInWithGoogleAction(): Promise<void> {
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const redirectTo = `${siteUrl}/auth/callback?next=/dashboard`;

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo,
      queryParams: {
        access_type: "offline",
        prompt: "consent",
      },
    },
  });

  if (error || !data.url) {
    await logAuditEvent({
      action: "auth.signin.oauth",
      outcome: "failure",
      detail: { provider: "google", reason: "oauth_init_failed" },
    });
    captureError(error ?? new Error("OAuth redirect URL missing"), {
      action: "auth.signin.oauth",
      severity: "critical",
      reason: "oauth_init_failed",
    });
    redirect("/login?error=oauth");
  }

  await logAuditEvent({
    action: "auth.signin.oauth",
    outcome: "success",
    detail: { provider: "google", stage: "redirect" },
  });

  redirect(data.url);
}
