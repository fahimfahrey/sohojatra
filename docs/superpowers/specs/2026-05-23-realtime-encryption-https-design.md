# Realtime Encryption + HTTPS Enforcement — Design

**Date:** 2026-05-23
**Scope:** Confidentiality + tamper detection on Ably realtime payloads, and HTTP→HTTPS upgrade for all browser traffic.

## Problem

- Realtime payloads broadcast through Ably (rides sync, notifications, ride lifecycle) carry sensitive fields (ride IDs, user IDs, addresses, phone numbers in some payloads). Ably TLS protects in transit between client/broker, but adds defense-in-depth and tamper detection if we ever expose data to a misconfigured channel or third party.
- HSTS already set, but a first-time visitor on HTTP can still send one plaintext request before the browser learns HSTS. Need an explicit redirect at the edge / middleware.

## Non-Goals

- End-to-end encryption against malicious clients (shared symmetric secret cannot achieve this; documented in `src/lib/encryption.ts`).
- Encrypting database-at-rest (handled separately by Supabase + `SUPABASE_PHONE_ENCRYPTION.sql`).
- Re-keying / key rotation flow (future).

## Architecture

### 1. HTTPS enforcement

Add to `src/middleware.ts`: if `process.env.NODE_ENV === "production"` and `x-forwarded-proto` header is set and not `"https"`, return a 308 permanent redirect to the `https://` equivalent.

- 308 preserves method + body (vs 301 which some clients downgrade to GET).
- Skip in development to avoid breaking `localhost` HTTP.
- Skip when no `x-forwarded-proto` header is present (direct local connection, no proxy).

### 2. Realtime encryption layer

Modify `src/contexts/AblyContext.tsx`:

- **publishEvent**: pass `data` through `encryptRealTimeData`, wrap as `{ __enc: 1, p: "<base64>" }`, publish.
- **subscribeToEvent**: on message, if `data` looks like `{ __enc: 1, p: string }`, run `decryptRealTimeData(data.p)` and forward the plaintext object to the consumer callback. Otherwise forward as-is (graceful during rolling deploy where some publishers haven't been upgraded yet).
- Encryption is async; publish/subscribe stay sync API at the boundary. publishEvent returns void as today; encryption runs as fire-and-forget promise that publishes once ciphertext is ready. Subscribe callback wraps an async handler that decrypts before invoking the consumer.
- Failures (decrypt error, bad envelope): log via `logger.warn` (no payload), drop the message. Do not deliver garbled data to consumers.

### 3. Tests (`tests/security/realtime-encryption.test.ts`)

- `encryptRealTimeData` round-trip preserves objects.
- Malformed envelope (wrong key, truncated b64) throws "Authentication failed".
- HTTPS redirect: middleware returns 308 when `x-forwarded-proto: http` in production.
- HTTPS redirect: middleware does not redirect in development.
- HTTPS redirect: middleware does not redirect when proto is `https`.

## Data Flow

```
publisher → publishEvent(channel, name, plaintext)
         → encryptRealTimeData(plaintext) → b64
         → ably.publish(channel, name, { __enc: 1, p: b64 })

subscriber ← ably message { __enc: 1, p: b64 }
          ← decryptRealTimeData(b64) → plaintext
          ← consumer callback(plaintext)
```

## Backward Compatibility

Receivers accept both encrypted and plaintext envelopes during deploy window. Publishers always encrypt after deploy. After one deploy cycle the plaintext path is dead code but kept for resilience against future config issues.

## Error Handling

- Encrypt fails (no SubtleCrypto): publishEvent silently drops the message; caller is unaware (matches current behavior on publish failures).
- Decrypt fails: subscriber drops the message + warns via logger; consumer not invoked.
- Redirect: 308 to `https://` with full path + query preserved.
