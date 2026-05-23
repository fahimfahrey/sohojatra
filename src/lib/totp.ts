import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { Secret, TOTP } from "otpauth";

export const TOTP_ISSUER = "Sohojatra";
export const TOTP_SECRET_BYTES = 20;
export const TOTP_RECOVERY_CODE_COUNT = 10;
export const TOTP_RECOVERY_CODE_LENGTH = 8;

// Crockford-ish base32 without the visually ambiguous I, O, 0, 1
const RECOVERY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export interface GeneratedSecret {
  secretHex: string;
  secretBase32: string;
}

export function generateTotpSecret(): GeneratedSecret {
  const bytes = randomBytes(TOTP_SECRET_BYTES);
  const secretHex = bytes.toString("hex");
  return {
    secretHex,
    secretBase32: Secret.fromHex(secretHex).base32,
  };
}

export function buildOtpauthUri(args: {
  secretBase32: string;
  accountLabel: string;
}): string {
  const totp = new TOTP({
    issuer: TOTP_ISSUER,
    label: args.accountLabel,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(args.secretBase32),
  });
  return totp.toString();
}

export function formatSecretForDisplay(secretBase32: string): string {
  return secretBase32.replace(/(.{4})/g, "$1 ").trim();
}

export function generateRecoveryCodes(
  count: number = TOTP_RECOVERY_CODE_COUNT,
): string[] {
  const codes: string[] = [];
  const buf = randomBytes(count * TOTP_RECOVERY_CODE_LENGTH);
  for (let i = 0; i < count; i++) {
    let code = "";
    for (let j = 0; j < TOTP_RECOVERY_CODE_LENGTH; j++) {
      const byte = buf[i * TOTP_RECOVERY_CODE_LENGTH + j];
      code += RECOVERY_ALPHABET[byte % RECOVERY_ALPHABET.length];
    }
    codes.push(code);
  }
  return codes;
}

export function formatRecoveryCodeForDisplay(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

export function hashRecoveryCode(code: string): string {
  return createHash("sha256").update(code.trim().toUpperCase(), "utf8").digest("hex");
}
