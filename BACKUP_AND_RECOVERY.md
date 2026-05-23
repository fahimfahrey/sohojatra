# Database Backup and Recovery

Disaster-recovery runbook for the Supabase Postgres database powering Sohojatra.

## RTO / RPO

| Metric | Target | Rationale |
|--------|--------|-----------|
| **RTO** (Recovery Time Objective) | **4 hours** | Maximum tolerable downtime between incident detection and full service restoration. Driven by ride-sharing operational hours (peak 06:00–22:00 BST). |
| **RPO** (Recovery Point Objective) | **5 minutes** | Maximum tolerable data loss. Requires PITR (Point-in-Time Recovery), which writes WAL segments every 2 min on the Supabase Pro plan. |
| **Backup retention** | **30 days** PITR + **90 days** cross-region archive | PITR covers operational recovery; archives cover regulatory and forensic needs. |
| **Cross-region archive cadence** | Daily 02:00 UTC | After daily managed backup completes. |
| **Recovery-drill cadence** | Monthly, first Monday | Verifies that backups actually restore and that runbook steps still work. |

## Backup layers

The system runs **three independent backup layers** so a single failure (region outage, key compromise, Supabase incident) cannot destroy all copies.

### 1. Supabase managed daily backups (Pro plan)

- Automatic. No code required.
- Retention: 7 days on Pro, 14 days on Team, 28 days on Enterprise.
- Configure: Dashboard → Project Settings → Database → Backups.
- Stored in the same region as the project (ap-south-1 for Sohojatra).
- **Verify enabled:** the Backups tab must list a backup for every day of the retention window. Page someone on-call if a day is missing.

### 2. Supabase Point-in-Time Recovery (PITR add-on)

- Required to hit the 5-minute RPO. Daily-only backups give an RPO of ~24h, which is too loose for this product.
- Enable: Dashboard → Project Settings → Add-ons → Point in Time Recovery (\$100/month at the time of writing — re-verify pricing before approving the spend).
- Retention configurable 7–28 days.
- WAL archive granularity: ~2 minutes.

### 3. Cross-region archive (this repo)

- Independent of Supabase's own backup infra. Survives a full Supabase regional failure or account compromise.
- `scripts/backup-cross-region.sh` runs `pg_dump --format=custom` against the production database and uploads the dump to S3 in **a different region than the database**.
  - Database region: `ap-south-1` (Mumbai).
  - Backup bucket region: **`ap-southeast-1` (Singapore)**. Picked because it is geographically separate but still inside Asia for compliance with the data-localisation expectations of Bangladeshi users.
- Object lock + versioning enabled on the bucket so a compromised AWS key cannot delete archives.
- Server-side encryption with a KMS CMK that is **separate from the production AWS account**.
- Run nightly via `.github/workflows/backup.yml`.

## Required secrets / configuration

Set these GitHub Actions repository secrets before the nightly workflow can run:

| Secret | Purpose |
|--------|---------|
| `SUPABASE_DB_URL` | Direct Postgres connection string (port 5432, NOT the pooler). Used by `pg_dump`. |
| `BACKUP_AWS_ACCESS_KEY_ID` | IAM user limited to `s3:PutObject` on the backup bucket. |
| `BACKUP_AWS_SECRET_ACCESS_KEY` | Matching secret. |
| `BACKUP_S3_BUCKET` | Bucket name in the secondary region. |
| `BACKUP_S3_REGION` | Region of the bucket, e.g. `ap-southeast-1`. |
| `BACKUP_KMS_KEY_ID` | KMS CMK ARN for SSE-KMS. |

IAM policy for the backup user must scope to a single bucket + KMS key and grant ONLY `s3:PutObject` and `kms:GenerateDataKey`. It must NOT have `s3:DeleteObject`, `s3:PutBucketPolicy`, or any IAM permissions.

## Monthly recovery drill

Run on the first Monday of every month. Owner: on-call SRE (rotates monthly).

1. Pick an archive from the **previous calendar day** in the cross-region bucket.
2. Run `scripts/recovery-drill.sh <s3-object-key>`. The script:
   - Spins up a throwaway Postgres 16 container.
   - Downloads the archive.
   - Runs `pg_restore` into the container.
   - Executes a fixed set of sanity queries (row counts on `ride_requests`, `users`, `ride_passengers`; the latest `created_at` per table).
3. Compare row counts and latest timestamps against production. Variance must be within expected daily growth.
4. Record results in `BACKUP_DRILL_LOG.md` (create on first run): date, drill operator, archive used, restore time, row-count delta, anomalies.
5. If the drill **fails**, open a P1 incident: backups are non-functional until a successful drill is logged.

## Recovery procedures

### Scenario A: accidental data corruption (single table, recent)

Use PITR. Restore to a point ~2 minutes before the corrupting change.

1. Dashboard → Database → Backups → "Restore to point in time".
2. Pick a timestamp just before the bad write.
3. Supabase provisions a new database; cut application traffic over once verified.
4. Expected wall-clock time: ~30 min for a database under 50 GB.

### Scenario B: full regional outage in ap-south-1

PITR and managed backups are also in ap-south-1, so a true regional failure makes them unreachable. Fall back to the cross-region archive.

1. Pick the most recent archive from the Singapore bucket.
2. Provision a fresh Supabase project in a different region (`ap-southeast-1` preferred).
3. `pg_restore --no-owner --no-privileges --dbname=<new-db-url> <archive-file>`.
4. Update DNS / app environment variables to point at the new project URL.
5. Rotate JWT signing keys before traffic resumes — assume the original project may still be exposed.
6. Expected wall-clock time: ~3 hours for the dataset's current size.

### Scenario C: full account compromise / data wiped

Worst case. Cross-region archive is the only remaining copy because the attacker can delete Supabase-managed backups from inside the dashboard.

1. Revoke all AWS access keys used by the production app.
2. Spin up a fresh Supabase project under a new owner email if the original account is unrecoverable.
3. Restore from the latest cross-region archive (the bucket has object-lock so the attacker cannot have deleted it).
4. Rotate every secret: JWT signing keys, Ably keys, Upstash tokens, Sentry DSN, OAuth client secrets.
5. Force re-authentication of every user (delete all sessions from `auth.sessions`).

## Things this runbook deliberately does NOT cover

- Storage bucket backup (avatars, etc.) — separate concern, deferred until any user-uploaded content actually exists in the bucket. See [project_avatar_upload_spec](.) — that feature is not built yet.
- Realtime channel state — by design ephemeral, not part of recovery.
- Edge-function code — versioned in this repo; redeploy from git.
