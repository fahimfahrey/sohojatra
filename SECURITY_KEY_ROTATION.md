# Key Rotation Schedule

Rotation cadence for secrets used by the app. Limits blast radius of key compromise. All secrets managed via Vercel Environment Variables (Secrets) — never commit to repo.

## Schedule

| Secret | Cadence | Owner | Storage | Automation |
|---|---|---|---|---|
| Supabase `SUPABASE_ANON_KEY` | Quarterly | Backend | Vercel Secrets | Manual (rotate in Supabase dashboard → update Vercel env → redeploy) |
| Supabase `SUPABASE_SERVICE_ROLE_KEY` | Quarterly | Backend | Vercel Secrets | Manual (same flow as anon) |
| Supabase `SUPABASE_JWT_SECRET` | Quarterly | Backend | Vercel Secrets | Manual (forces re-login of all users — schedule off-peak) |
| Ably API key (`ABLY_API_KEY`) | Quarterly | Backend | Vercel Secrets | Manual (Ably dashboard → new key → update Vercel → revoke old after 24h overlap) |
| Encryption key (`PHONE_ENCRYPTION_KEY`) | Annually | Backend | Vercel Secrets | Manual (requires re-encrypt migration — see `SUPABASE_PHONE_ENCRYPTION.sql`) |

## Quarterly schedule (next 4 cycles)

| Cycle | Date | Items |
|---|---|---|
| Q3 2026 | 2026-08-01 | Supabase keys, Ably key |
| Q4 2026 | 2026-11-01 | Supabase keys, Ably key |
| Q1 2027 | 2027-02-01 | Supabase keys, Ably key |
| Q2 2027 | 2027-05-01 | Supabase keys, Ably key, **encryption key (annual)** |

## Rotation procedure

### Supabase keys

1. Supabase dashboard → Settings → API → Reset key
2. Copy new key
3. `vercel env rm <NAME> production` then `vercel env add <NAME> production`
4. Redeploy: `vercel --prod`
5. Verify: hit `/api/health` endpoint, check Supabase logs for 401s on old key
6. JWT secret rotation invalidates all sessions — post user notice 24h prior

### Ably API key

1. Ably dashboard → API Keys → Create new key (same capabilities)
2. Add new key to Vercel as `ABLY_API_KEY`
3. Deploy
4. Wait 24h overlap window (active connections drain)
5. Revoke old key in Ably dashboard

### Encryption key (`PHONE_ENCRYPTION_KEY`)

Re-encrypt requires migration. Do not rotate without DBA review.

1. Generate new key: `openssl rand -base64 32`
2. Add as `PHONE_ENCRYPTION_KEY_NEW` in Vercel
3. Run re-encrypt migration: decrypt with old, encrypt with new (one row at a time, batched)
4. Verify all rows re-encrypted (count check)
5. Promote `PHONE_ENCRYPTION_KEY_NEW` → `PHONE_ENCRYPTION_KEY`, remove old
6. Redeploy

## Automation roadmap

- [ ] GitHub Action: monthly reminder issue 2 weeks before rotation date
- [ ] Vercel API script: automate env var swap (reduces manual error)
- [ ] Ably webhook: alert on auth failures spike post-rotation
- [ ] Supabase: enable audit log export to detect old-key usage

## Emergency rotation

If key suspected compromised — rotate immediately, no schedule. Skip overlap window. Force user re-login if JWT secret affected. Post-incident: review access logs for window between compromise and rotation.

## References

- Vercel Secrets: https://vercel.com/docs/projects/environment-variables
- Supabase key rotation: Supabase dashboard → Settings → API
- Ably key management: Ably dashboard → API Keys
- Phone encryption schema: `SUPABASE_PHONE_ENCRYPTION.sql`
