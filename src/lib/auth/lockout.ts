import { createClient } from "@/lib/supabase/server";
import {
  LOCKOUT_DURATION_SECONDS,
  LOCKOUT_MAX_ATTEMPTS,
  LOCKOUT_UNLOCK_TTL_SECONDS,
  LOCKOUT_WINDOW_SECONDS,
} from "@/lib/auth/lockout-constants";

export type LockoutStatus =
  | { locked: false }
  | { locked: true; userId: string; lockedUntil: string };

export type FailedAttemptResult =
  | { lockedNow: false; userId?: string }
  | { lockedNow: true; userId: string; unlockToken: string };

export type UnlockResult =
  | { success: false }
  | { success: true; userId: string };

export async function checkLockout(email: string): Promise<LockoutStatus> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("lockout_status", {
    p_email: email,
  });
  if (error || !Array.isArray(data) || data.length === 0) {
    return { locked: false };
  }
  const row = data[0] as {
    user_id: string;
    locked: boolean;
    locked_until: string | null;
  };
  if (!row.locked || !row.locked_until) {
    return { locked: false };
  }
  return { locked: true, userId: row.user_id, lockedUntil: row.locked_until };
}

export async function recordFailedAttempt(
  email: string,
  ip: string,
): Promise<FailedAttemptResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("record_failed_attempt", {
    p_email: email,
    p_ip: ip,
    p_window_seconds: LOCKOUT_WINDOW_SECONDS,
    p_max_attempts: LOCKOUT_MAX_ATTEMPTS,
    p_lock_duration_seconds: LOCKOUT_DURATION_SECONDS,
    p_unlock_ttl_seconds: LOCKOUT_UNLOCK_TTL_SECONDS,
  });
  if (error || !Array.isArray(data) || data.length === 0) {
    return { lockedNow: false };
  }
  const row = data[0] as {
    locked_now: boolean;
    unlock_token: string | null;
    user_id: string;
  };
  if (!row.locked_now || !row.unlock_token) {
    return { lockedNow: false, userId: row.user_id };
  }
  return {
    lockedNow: true,
    userId: row.user_id,
    unlockToken: row.unlock_token,
  };
}

export async function recordSuccessfulAttempt(userId: string): Promise<void> {
  const supabase = await createClient();
  await supabase.rpc("record_successful_attempt", { p_user_id: userId });
}

export async function consumeUnlockToken(token: string): Promise<UnlockResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("consume_unlock_token", {
    p_token: token,
  });
  if (error || !Array.isArray(data) || data.length === 0) {
    return { success: false };
  }
  const row = data[0] as { user_id: string | null; success: boolean };
  if (!row.success || !row.user_id) {
    return { success: false };
  }
  return { success: true, userId: row.user_id };
}
