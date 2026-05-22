import { supabase } from "./supabase";

/**
 * Retention windows (must match SUPABASE_DATA_RETENTION.sql).
 * UI uses these to surface accurate "data will be deleted on…" copy.
 */
export const RETENTION_DAYS = {
  COMPLETED_RIDE: 90,
  CANCELLED_RIDE: 30,
  DELETED_USER: 30,
} as const;

export type AccountDeletionStatus = {
  requestedAt: string | null;
  scheduledPurgeAt: string | null;
  daysRemaining: number | null;
};

/**
 * Mark the current user's account for deletion. The row is soft-deleted
 * immediately (hidden by RLS) and hard-deleted after a 30-day grace window.
 * Returns the timestamp the request was recorded at.
 */
export const requestAccountDeletion = async (): Promise<string> => {
  const { data, error } = await supabase.rpc("request_account_deletion");
  if (error) throw error;
  return data as string;
};

/**
 * Cancel a pending account deletion. Only effective while the user is still
 * within the grace window.
 */
export const cancelAccountDeletion = async (): Promise<boolean> => {
  const { data, error } = await supabase.rpc("cancel_account_deletion");
  if (error) throw error;
  return Boolean(data);
};

/**
 * Read the current user's deletion status so the UI can show a countdown
 * and an "undo" affordance.
 */
export const getAccountDeletionStatus = async (
  userId: string,
): Promise<AccountDeletionStatus> => {
  const { data, error } = await supabase
    .from("users")
    .select("deletion_requested_at")
    .eq("id", userId)
    .maybeSingle();

  if (error) throw error;

  const requestedAt = data?.deletion_requested_at ?? null;
  if (!requestedAt) {
    return { requestedAt: null, scheduledPurgeAt: null, daysRemaining: null };
  }

  const requested = new Date(requestedAt).getTime();
  const scheduled = requested + RETENTION_DAYS.DELETED_USER * 86_400_000;
  const daysRemaining = Math.max(
    0,
    Math.ceil((scheduled - Date.now()) / 86_400_000),
  );

  return {
    requestedAt,
    scheduledPurgeAt: new Date(scheduled).toISOString(),
    daysRemaining,
  };
};

/**
 * Soft-delete a ride. Hides it from the app immediately; the nightly sweep
 * removes the row once the status-based retention window has elapsed.
 * Hard delete is reserved for the server-side sweep.
 */
export const softDeleteRide = async (rideId: string): Promise<void> => {
  const { error } = await supabase
    .from("ride_requests")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", rideId);

  if (error) throw error;
};

/**
 * Compute the scheduled hard-delete date for a ride given its current status
 * and the timestamp it entered that status. Returns null if the ride is not
 * in a terminal state.
 */
export const scheduledRidePurgeAt = (
  status: string,
  statusChangedAt: string | null,
): string | null => {
  if (!statusChangedAt) return null;
  const base = new Date(statusChangedAt).getTime();
  if (status === "completed") {
    return new Date(base + RETENTION_DAYS.COMPLETED_RIDE * 86_400_000).toISOString();
  }
  if (status === "cancelled") {
    return new Date(base + RETENTION_DAYS.CANCELLED_RIDE * 86_400_000).toISOString();
  }
  return null;
};
