/**
 * API key generation, hashing, and verification for third-party integrations.
 *
 * Format: ck_live_<base64url(32 random bytes)>  → 43-char secret, 256 bits.
 * Storage: only SHA-256 of full key is persisted (`key_hash` column). The
 * plaintext is shown to the caller exactly once at creation.
 *
 * Why SHA-256 and not bcrypt: API keys are 256-bit random tokens, not
 * user-chosen passwords. Brute-forcing the preimage requires 2^256 hashes —
 * adding a slow KDF on top costs latency on every request without buying
 * meaningful resistance. The DB unique index on `key_hash` doubles as
 * collision guard.
 *
 * Web Crypto only (no node:crypto) so this module runs in both the Node
 * runtime (route handlers) and the Edge runtime (middleware).
 */

export const API_KEY_PREFIX = "ck_live_";
export const API_KEY_SECRET_BYTES = 32;
export const API_KEY_PREFIX_DISPLAY_CHARS = 12; // ck_live_xxxx (for UI/audit)
export const API_KEY_DEFAULT_TTL_DAYS = 90;     // matches quarterly rotation
export const API_KEY_DEFAULT_RATE_LIMIT = 1000; // requests / minute

export type ApiKeyPermission =
  | "rides:read"
  | "rides:write"
  | "users:read"
  | "notifications:read";

export const API_KEY_PERMISSIONS: ReadonlyArray<ApiKeyPermission> = [
  "rides:read",
  "rides:write",
  "users:read",
  "notifications:read",
];

export interface GeneratedApiKey {
  plaintext: string;       // returned once to the caller
  keyHash: string;         // SHA-256 hex
  keyPrefix: string;       // first N chars for UI
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (const b of bytes) out += b.toString(16).padStart(2, "0");
  return out;
}

export async function generateApiKey(): Promise<GeneratedApiKey> {
  const buf = new Uint8Array(API_KEY_SECRET_BYTES);
  crypto.getRandomValues(buf);
  const plaintext = `${API_KEY_PREFIX}${bytesToBase64Url(buf)}`;
  return {
    plaintext,
    keyHash: await hashApiKey(plaintext),
    keyPrefix: plaintext.slice(0, API_KEY_PREFIX_DISPLAY_CHARS),
  };
}

export async function hashApiKey(plaintext: string): Promise<string> {
  const data = new TextEncoder().encode(plaintext);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return bytesToHex(new Uint8Array(digest));
}

export function parseApiKey(header: string | null | undefined): string | null {
  if (!header) return null;
  const trimmed = header.trim();
  // "Bearer <key>" or raw "ck_live_…"
  const candidate = trimmed.toLowerCase().startsWith("bearer ")
    ? trimmed.slice(7).trim()
    : trimmed;
  if (!candidate.startsWith(API_KEY_PREFIX)) return null;
  // Reject whitespace and absurd lengths early.
  if (/\s/.test(candidate)) return null;
  if (candidate.length < API_KEY_PREFIX.length + 16) return null;
  if (candidate.length > 256) return null;
  return candidate;
}

export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export interface ApiKeyRecord {
  id: string;
  user_id: string;
  permissions: string[];
  rate_limit: number;
  expires_at: string;
  revoked_at: string | null;
}

export type VerifyApiKeyFailure =
  | "missing"
  | "malformed"
  | "not_found"
  | "revoked"
  | "expired";

export type VerifyApiKeyResult =
  | { ok: true; record: ApiKeyRecord }
  | { ok: false; reason: VerifyApiKeyFailure };

/**
 * Look up an API key by hash and enforce revocation / expiry. Caller passes
 * the DB lookup so this module stays free of Supabase imports (keeps Edge
 * bundle small and makes unit-testing trivial).
 */
export async function verifyApiKey(
  authorizationHeader: string | null | undefined,
  lookup: (keyHash: string) => Promise<ApiKeyRecord | null>,
): Promise<VerifyApiKeyResult> {
  const plaintext = parseApiKey(authorizationHeader);
  if (!plaintext) {
    return { ok: false, reason: authorizationHeader ? "malformed" : "missing" };
  }
  const keyHash = await hashApiKey(plaintext);
  const record = await lookup(keyHash);
  if (!record) return { ok: false, reason: "not_found" };
  if (record.revoked_at) return { ok: false, reason: "revoked" };
  if (new Date(record.expires_at).getTime() <= Date.now()) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true, record };
}

export function hasPermission(
  record: Pick<ApiKeyRecord, "permissions">,
  required: ApiKeyPermission,
): boolean {
  return record.permissions.includes(required);
}

export function isDueRotation(
  record: Pick<ApiKeyRecord, "expires_at">,
  now = Date.now(),
): boolean {
  const expiresMs = new Date(record.expires_at).getTime();
  const thirtyDays = 30 * 24 * 60 * 60 * 1000;
  return expiresMs - now < thirtyDays;
}

export function defaultExpiry(now = new Date()): Date {
  return new Date(now.getTime() + API_KEY_DEFAULT_TTL_DAYS * 24 * 60 * 60 * 1000);
}
