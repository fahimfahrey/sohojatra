# Plan — Realtime Encryption + HTTPS Enforcement

Spec: `docs/superpowers/specs/2026-05-23-realtime-encryption-https-design.md`

## Steps

1. **Add tests** (TDD):
   - `tests/security/realtime-encryption.test.ts` — envelope round-trip, malformed envelope rejection.
   - `tests/security/https-redirect.test.ts` — middleware 308 in prod with `x-forwarded-proto: http`, no redirect on https or in dev.

2. **HTTPS redirect in middleware**:
   - Add `enforceHttps(request)` helper at top of `src/middleware.ts`.
   - Call first in `middleware()` before other checks.
   - Returns `NextResponse.redirect(httpsUrl, 308)` when condition matched.

3. **Encryption wrapper in AblyContext**:
   - Import `encryptRealTimeData` / `decryptRealTimeData` from `@/lib/encryption`.
   - Define `ENCRYPTED_ENVELOPE_KEY = "__enc"` constant + `isEncryptedEnvelope(data)` guard.
   - `publishEvent` becomes fire-and-forget async: encrypt → publish envelope.
   - `subscribeToEvent` wraps handler in async decrypt path; logs + drops on failure.

4. **Verify**:
   - `npm run test:security`
   - `npm run typecheck`

## Files

- New: `tests/security/realtime-encryption.test.ts`, `tests/security/https-redirect.test.ts`.
- Modify: `src/middleware.ts`, `src/contexts/AblyContext.tsx`.

## Risks

- AblyContext is consumed in many files via callback shape. Keep callback signature identical (`(message: AblyMessage) => void` with plaintext `data`).
- Async publish means message order is no longer guaranteed if multiple `publishEvent` calls fire in sequence and one encrypt is slower. Mitigation: chain via an internal publish queue (FIFO promise). Implemented as `publishQueue` per provider instance.
