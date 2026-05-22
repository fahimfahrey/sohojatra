# Data Retention Policy

Implements data minimization: personal data is retained only as long as it serves an operational purpose, then automatically deleted.

## Retention windows

| Data class                      | Soft-delete trigger                    | Hard-delete after          |
|---------------------------------|----------------------------------------|----------------------------|
| Ride — `status = 'completed'`   | status transition                      | **90 days** after transition |
| Ride — `status = 'cancelled'`   | status transition                      | **30 days** after transition |
| User account (profile + auth)   | user calls `request_account_deletion`  | **30 days** after request    |
| Ride passenger rows             | follows owning ride or owning user     | cascaded with the parent    |
| Notifications                   | follows owning user                    | cascaded with the parent    |

Soft delete = `deleted_at` (or `deletion_requested_at` for users) is stamped and the row becomes invisible to RLS-bound clients.
Hard delete = row is removed by the nightly `run_retention_sweep()` job.

## Schema

Migration: `SUPABASE_DATA_RETENTION.sql` (run once in the Supabase SQL editor).

Soft-delete columns:

- `public.users.deletion_requested_at timestamptz`
- `public.users.deleted_at timestamptz`
- `public.ride_requests.deleted_at timestamptz`
- `public.ride_requests.status_changed_at timestamptz` (stamped by trigger; drives the 30/90-day clock)
- `public.ride_passengers.deleted_at timestamptz`
- `public.notifications.deleted_at timestamptz`

RLS `SELECT` policies are updated to filter out rows where the relevant flag is non-null. Service role bypasses RLS so the sweep still sees everything.

## Scheduling

`pg_cron` job `retention_sweep_nightly` runs `SELECT public.run_retention_sweep();` at **03:15 UTC daily**. The function returns a JSON summary `{completed_purged, cancelled_purged, users_purged}` that is captured in `cron.job_run_details` for audit.

## App integration

Client helpers live in `src/lib/dataRetention.ts`:

- `requestAccountDeletion()` — calls the `request_account_deletion` RPC; user becomes invisible immediately.
- `cancelAccountDeletion()` — undoes a pending deletion within the 30-day grace window.
- `getAccountDeletionStatus(userId)` — returns `{requestedAt, scheduledPurgeAt, daysRemaining}` for the settings UI.
- `softDeleteRide(rideId)` — hides a ride; the sweep removes it once the status retention window elapses.
- `scheduledRidePurgeAt(status, statusChangedAt)` — UI helper to display the projected purge date.

Constant `RETENTION_DAYS` mirrors the SQL values. **Keep them in sync** if you tune the windows.

## Operational notes

- The user purge nulls `contact_phone(_encrypted)` on rides the user *created* (other passengers may still need the trip), then cascades the deletion through `ride_passengers`, `notifications`, `public.users`, and `auth.users`.
- Foreign keys must be `ON DELETE CASCADE` from `ride_passengers.user_id`, `notifications.user_id`, and `ride_passengers.ride_id`. Verify before deploying — section 9 of the migration includes a dry-run preview to surface unexpected counts.
- To pause sweeps (e.g. during incident response): `SELECT cron.unschedule('retention_sweep_nightly');`. Re-run section 8 of the migration to restore.
- To run an ad-hoc sweep from psql (service role): `SELECT public.run_retention_sweep();`.

## Compliance rationale

- **Data minimization** (GDPR Art. 5(1)(c), CCPA §1798.100): we hold ride and account data only for the period needed to support disputes, reconciliation, and user recovery.
- **Right to erasure** (GDPR Art. 17): self-serve via `request_account_deletion`; hard-delete within 30 days satisfies the "without undue delay" requirement.
- **Storage limitation** (GDPR Art. 5(1)(e)): the nightly sweep enforces the limit automatically — no manual janitor task required.
