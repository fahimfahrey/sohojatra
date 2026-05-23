import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

export const TOTP_PASSED_COOKIE = "sb-2fa-passed";
export const TOTP_STEPUP_COOKIE = "sb-2fa-stepup";

export const TOTP_STEPUP_MAX_AGE_SEC = 15 * 60;
const PASSED_MAX_AGE_SEC = 12 * 60 * 60;

function getSecret(): Buffer {
  const raw = process.env.TOTP_COOKIE_SECRET;
  if (!raw) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("TOTP_COOKIE_SECRET is required in production");
    }
    return Buffer.from(
      "dev-only-totp-cookie-secret-not-for-production-use-please-set-env",
    );
  }
  return Buffer.from(raw, "utf8");
}

function b64url(buf: Buffer | string): string {
  const b = typeof buf === "string" ? Buffer.from(buf, "utf8") : buf;
  return b
    .toString("base64")
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function b64urlDecode(s: string): Buffer {
  const padded =
    s.replace(/-/g, "+").replace(/_/g, "/") +
    "=".repeat((4 - (s.length % 4)) % 4);
  return Buffer.from(padded, "base64");
}

function sign(payload: string): string {
  return b64url(createHmac("sha256", getSecret()).update(payload).digest());
}

function buildValue(userId: string, expiresAtMs: number): string {
  const uidPart = b64url(userId);
  const expPart = b64url(String(expiresAtMs));
  const sig = sign(`${uidPart}.${expPart}`);
  return `${uidPart}.${expPart}.${sig}`;
}

function verifyValue(
  raw: string | undefined | null,
  userId: string,
): { ok: true; expiresAtMs: number } | { ok: false } {
  if (!raw || typeof raw !== "string") return { ok: false };
  const parts = raw.split(".");
  if (parts.length !== 3) return { ok: false };
  const [uidPart, expPart, sig] = parts;

  let claimedUid: string;
  let claimedExpStr: string;
  try {
    claimedUid = b64urlDecode(uidPart).toString("utf8");
    claimedExpStr = b64urlDecode(expPart).toString("utf8");
  } catch {
    return { ok: false };
  }

  if (claimedUid !== userId) return { ok: false };

  const expectedSig = sign(`${uidPart}.${expPart}`);
  const sigBuf = Buffer.from(sig, "utf8");
  const expBuf = Buffer.from(expectedSig, "utf8");
  if (sigBuf.length !== expBuf.length) return { ok: false };
  if (!timingSafeEqual(sigBuf, expBuf)) return { ok: false };

  const expiresAtMs = Number(claimedExpStr);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
    return { ok: false };
  }
  return { ok: true, expiresAtMs };
}

export function buildTotpPassedCookie(userId: string): {
  name: string;
  value: string;
  options: {
    httpOnly: true;
    secure: boolean;
    sameSite: "strict";
    path: "/";
    maxAge: number;
  };
} {
  const expiresAt = Date.now() + PASSED_MAX_AGE_SEC * 1000;
  return {
    name: TOTP_PASSED_COOKIE,
    value: buildValue(userId, expiresAt),
    options: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: PASSED_MAX_AGE_SEC,
    },
  };
}

export function buildTotpStepupCookie(userId: string): {
  name: string;
  value: string;
  options: {
    httpOnly: true;
    secure: boolean;
    sameSite: "strict";
    path: "/";
    maxAge: number;
  };
} {
  const expiresAt = Date.now() + TOTP_STEPUP_MAX_AGE_SEC * 1000;
  return {
    name: TOTP_STEPUP_COOKIE,
    value: buildValue(userId, expiresAt),
    options: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: TOTP_STEPUP_MAX_AGE_SEC,
    },
  };
}

export function verifyTotpPassedCookie(
  raw: string | undefined | null,
  userId: string,
): boolean {
  return verifyValue(raw, userId).ok;
}

export function verifyTotpStepupCookie(
  raw: string | undefined | null,
  userId: string,
): boolean {
  return verifyValue(raw, userId).ok;
}
