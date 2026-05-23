/**
 * PII / secret redaction for logs and error reporting.
 *
 * Strategy:
 *   1. Walk arbitrary values (string / object / array / Error) and replace
 *      anything matching a sensitive key name OR sensitive value pattern with
 *      the literal string "[REDACTED]".
 *   2. Catch both shapes that leak in practice: top-level fields
 *      (`{ password: "..." }`) and free-form strings ("email: a@b.com").
 *
 * Used by `src/lib/observability/logger.ts` (auto-applied to every log call)
 * and `src/lib/observability/sentry.ts` (applied to extra context before
 * forwarding to Sentry).
 */

export const REDACTED = "[REDACTED]";

const MAX_DEPTH = 6;
const MAX_STRING_LEN = 4096;

const SENSITIVE_KEY_RE =
  /^(password|passwd|pwd|secret|token|access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|apikey|authorization|auth|session|cookie|set[_-]?cookie|jwt|bearer|client[_-]?secret|private[_-]?key|encryption[_-]?key|phone|phone[_-]?number|mobile|email|email[_-]?address|otp|totp|recovery[_-]?code|csrf|x[_-]?api[_-]?key)$/i;

const EMAIL_RE =
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

// E.164 (+8801…), parenthesised area codes, digit groups w/ separators.
const PHONE_RE =
  /\(?\+?\d[\d\s().-]{7,}\d\)?/g;

// JWT three-segment base64url tokens.
const JWT_RE = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;

// Long high-entropy tokens (Supabase service keys, Stripe keys, generic bearer tokens).
const LONG_TOKEN_RE = /\b(?:sk|pk|rk|sb|sbp|whsec)_[A-Za-z0-9_-]{16,}\b/g;

// "Bearer xyz", "Authorization: xyz", "password=xyz" inside free-form strings.
const KV_SECRET_RE =
  /\b(authorization|bearer|password|passwd|pwd|secret|token|api[_-]?key|x[_-]?api[_-]?key)\s*[:=]\s*["']?[^"'\s,;}]+["']?/gi;

function redactString(input: string): string {
  if (input.length > MAX_STRING_LEN) {
    input = input.slice(0, MAX_STRING_LEN) + "…[truncated]";
  }
  return input
    .replace(JWT_RE, REDACTED)
    .replace(LONG_TOKEN_RE, REDACTED)
    .replace(KV_SECRET_RE, (m) => {
      const key = m.split(/[:=]/)[0];
      return `${key}=${REDACTED}`;
    })
    .replace(EMAIL_RE, REDACTED)
    .replace(PHONE_RE, (m) => {
      // Skip short numbers (likely IDs, counts, timestamps).
      const digits = m.replace(/\D/g, "");
      return digits.length >= 10 && digits.length <= 15 ? REDACTED : m;
    });
}

function redactError(err: Error): Record<string, unknown> {
  return {
    name: err.name,
    message: redactString(err.message ?? ""),
    // Stack often contains file paths but not user PII — keep it but redact
    // anything that looks like a credential leak.
    stack: err.stack ? redactString(err.stack) : undefined,
  };
}

export function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (depth > MAX_DEPTH) return "[depth-limit]";

  if (typeof value === "string") return redactString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "function" || typeof value === "symbol") return undefined;

  if (value instanceof Error) return redactError(value);

  if (Array.isArray(value)) {
    return value.map((v) => redact(v, depth + 1));
  }

  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY_RE.test(k)) {
        out[k] = REDACTED;
        continue;
      }
      out[k] = redact(v, depth + 1);
    }
    return out;
  }

  return value;
}

/**
 * Convenience: redact a variadic argument list into a string fit for
 * `console.*`. Each non-string argument is JSON-stringified after redaction.
 */
export function redactArgs(args: unknown[]): unknown[] {
  return args.map((a) => {
    const r = redact(a);
    if (typeof r === "string") return r;
    try {
      return JSON.stringify(r);
    } catch {
      return "[unserializable]";
    }
  });
}
