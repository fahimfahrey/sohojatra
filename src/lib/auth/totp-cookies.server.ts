import "server-only";

export const TOTP_PASSED_COOKIE = "sb-2fa-passed";
export const TOTP_STEPUP_COOKIE = "sb-2fa-stepup";

export const TOTP_STEPUP_MAX_AGE_SEC = 15 * 60;
const PASSED_MAX_AGE_SEC = 12 * 60 * 60;

function getSecret(): Uint8Array {
  const raw = process.env.TOTP_COOKIE_SECRET;
  if (!raw) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("TOTP_COOKIE_SECRET is required in production");
    }
    return new TextEncoder().encode(
      "dev-only-totp-cookie-secret-not-for-production-use-please-set-env",
    );
  }
  return new TextEncoder().encode(raw);
}

function b64url(bytes: Uint8Array | string): string {
  const buf = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  let binary = "";
  for (let i = 0; i < buf.length; i++) {
    binary += String.fromCharCode(buf[i]);
  }
  return btoa(binary)
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function b64urlDecode(s: string): Uint8Array {
  const padded =
    s.replace(/-/g, "+").replace(/_/g, "/") +
    "=".repeat((4 - (s.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a[i] ^ b[i];
  }
  return result === 0;
}

async function sign(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    getSecret() as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload),
  );
  return b64url(new Uint8Array(signature));
}

async function buildValue(
  userId: string,
  expiresAtMs: number,
): Promise<string> {
  const uidPart = b64url(userId);
  const expPart = b64url(String(expiresAtMs));
  const sig = await sign(`${uidPart}.${expPart}`);
  return `${uidPart}.${expPart}.${sig}`;
}

async function verifyValue(
  raw: string | undefined | null,
  userId: string,
): Promise<{ ok: true; expiresAtMs: number } | { ok: false }> {
  if (!raw || typeof raw !== "string") return { ok: false };
  const parts = raw.split(".");
  if (parts.length !== 3) return { ok: false };
  const [uidPart, expPart, sig] = parts;

  let claimedUid: string;
  let claimedExpStr: string;
  try {
    claimedUid = new TextDecoder().decode(b64urlDecode(uidPart));
    claimedExpStr = new TextDecoder().decode(b64urlDecode(expPart));
  } catch {
    return { ok: false };
  }

  if (claimedUid !== userId) return { ok: false };

  const expectedSig = await sign(`${uidPart}.${expPart}`);
  let sigBytes: Uint8Array;
  let expBytes: Uint8Array;
  try {
    sigBytes = b64urlDecode(sig);
    expBytes = b64urlDecode(expectedSig);
  } catch {
    return { ok: false };
  }
  if (!constantTimeEqual(sigBytes, expBytes)) return { ok: false };

  const expiresAtMs = Number(claimedExpStr);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
    return { ok: false };
  }
  return { ok: true, expiresAtMs };
}

export async function buildTotpPassedCookie(userId: string): Promise<{
  name: string;
  value: string;
  options: {
    httpOnly: true;
    secure: boolean;
    sameSite: "strict";
    path: "/";
    maxAge: number;
  };
}> {
  const expiresAt = Date.now() + PASSED_MAX_AGE_SEC * 1000;
  return {
    name: TOTP_PASSED_COOKIE,
    value: await buildValue(userId, expiresAt),
    options: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: PASSED_MAX_AGE_SEC,
    },
  };
}

export async function buildTotpStepupCookie(userId: string): Promise<{
  name: string;
  value: string;
  options: {
    httpOnly: true;
    secure: boolean;
    sameSite: "strict";
    path: "/";
    maxAge: number;
  };
}> {
  const expiresAt = Date.now() + TOTP_STEPUP_MAX_AGE_SEC * 1000;
  return {
    name: TOTP_STEPUP_COOKIE,
    value: await buildValue(userId, expiresAt),
    options: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: TOTP_STEPUP_MAX_AGE_SEC,
    },
  };
}

export async function verifyTotpPassedCookie(
  raw: string | undefined | null,
  userId: string,
): Promise<boolean> {
  const result = await verifyValue(raw, userId);
  return result.ok;
}

export async function verifyTotpStepupCookie(
  raw: string | undefined | null,
  userId: string,
): Promise<boolean> {
  const result = await verifyValue(raw, userId);
  return result.ok;
}
