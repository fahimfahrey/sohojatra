# Data Usage Reference

Companion to the user-facing [Privacy Policy](../src/app/privacy/page.tsx).
This document maps each category of personal data to its purpose, lawful
basis, retention window, and storage location. Engineers MUST update this
file when adding a new field that stores personal data.

Last reviewed: 2026-05-23

## Categories

| Category | Fields | Purpose | Legal basis (GDPR) | Retention | Where stored |
|---|---|---|---|---|---|
| Identity | `users.id`, `users.email`, `users.name`, `users.phone` (encrypted), `users.avatar_url` | Authenticate; identify ride participants | Contract | Until account deletion | Supabase `auth` + `public.users` |
| Authentication | password hash, refresh token, TOTP secret (encrypted) | Login, 2FA | Contract | Until account deletion | Supabase `auth` |
| Ride records | `ride_requests`, `ride_passengers`, `ride_messages` | Operate ride matching, history | Contract | 18 months after ride completion, then anonymised | Supabase `public.*` |
| Precise location | Browser `Geolocation` reads | Map centring, route start suggestion | Consent (in-app + browser prompt) | Never persisted server-side | Client memory only |
| Audit logs | `audit_log` table | Security, compliance | Legitimate interest / legal obligation | 12 months | Supabase `public.audit_log` |
| Rate-limit counters | Upstash Redis keys | Abuse prevention | Legitimate interest | 24 hours rolling | Upstash Redis |
| Notification messages | `notifications` table | Transactional alerts | Contract | 90 days | Supabase `public.notifications` |
| Error telemetry | Sentry events | Debugging | Legitimate interest | 90 days (Sentry default) | Sentry (PII scrubbed before send) |
| Analytics | Page views, vitals | Product improvement | Consent (cookie banner) | 90 days | Vercel Analytics |

## Consent Surfaces

- **Cookie consent banner** &mdash; `src/components/shared/CookieConsent.tsx`.
  Loaded for every visitor; decision persisted in `localStorage` for one year
  under key `sohojatra.consent.cookies`.
- **Location consent prompt** &mdash; `src/components/shared/LocationConsentPrompt.tsx`.
  Triggered on demand by `requestCurrentPosition` in
  `src/lib/geolocation.ts` when no decision is recorded. Decision lives in
  `localStorage` under `sohojatra.consent.location`.
- **Analytics loader** &mdash; `src/components/shared/ConsentGatedAnalytics.tsx`.
  Mounts `@vercel/analytics` and `@vercel/speed-insights` ONLY when cookie
  consent is granted.

## Engineer Checklist When Touching User Data

1. New column or field? Add a row to the table above.
2. Reading device location? Use `requestCurrentPosition` &mdash; never call
   `navigator.geolocation` directly.
3. Logging request bodies? Pass through `src/lib/observability/redact.ts`.
4. Pushing to a third party? Update the processors list in
   `src/app/privacy/page.tsx` (section 6).
5. Changing retention? Update both this file and the user-facing policy.

## Deletion &amp; Export Requests

Operational runbook: see `docs/INCIDENT_RESPONSE.md` &sect; user-data
requests. SLA is 30 days from request to fulfilment.
