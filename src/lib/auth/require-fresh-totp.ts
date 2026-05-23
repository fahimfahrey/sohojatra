import "server-only";
import { cookies } from "next/headers";
import type { User } from "@supabase/supabase-js";
import {
  TOTP_STEPUP_COOKIE,
  verifyTotpStepupCookie,
} from "@/lib/auth/totp-cookies.server";

export type FreshTotpResult =
  | { ok: true }
  | { ok: false; reason: "stepup_required" };

export function isTotpEnabled(user: User): boolean {
  return user.app_metadata?.totp_enabled === true;
}

export async function requireFreshTotp(user: User): Promise<FreshTotpResult> {
  if (!isTotpEnabled(user)) return { ok: true };

  const store = await cookies();
  const raw = store.get(TOTP_STEPUP_COOKIE)?.value;
  if (!raw) return { ok: false, reason: "stepup_required" };
  if (!(await verifyTotpStepupCookie(raw, user.id))) {
    return { ok: false, reason: "stepup_required" };
  }
  return { ok: true };
}
