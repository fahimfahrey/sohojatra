import "server-only";
import { cookies } from "next/headers";

export const CSRF_COOKIE = "csrf-token";
export const CSRF_TOKEN_BYTES = 32;

export function generateCsrfToken(): string {
  const bytes = new Uint8Array(CSRF_TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function readCsrfCookie(): Promise<string | null> {
  const store = await cookies();
  return store.get(CSRF_COOKIE)?.value ?? null;
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function validateCsrfToken(
  submitted: string | undefined | null,
): Promise<boolean> {
  if (!submitted || typeof submitted !== "string") return false;
  const cookieToken = await readCsrfCookie();
  if (!cookieToken) return false;
  return constantTimeEqual(cookieToken, submitted);
}
