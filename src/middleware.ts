import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { CSRF_COOKIE, CSRF_TOKEN_BYTES } from "@/lib/security/csrf";
import {
  applyApiRateLimit,
  consumeRateLimit,
  API_WINDOW_MS,
  type RateLimitResult,
} from "@/lib/rate-limit/server";
import { verifyApiKey } from "@/lib/security/api-key";
import {
  lookupApiKeyByHash,
  touchApiKey,
} from "@/lib/security/api-key-lookup";

const MAX_BODY_BYTES = 1_048_576; // 1 MB
const BODY_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const CSRF_MAX_AGE = 60 * 60 * 24 * 7; // 7 days

function enforceHttps(request: NextRequest): NextResponse | null {
  if (process.env.NODE_ENV !== "production") return null;
  const proto = request.headers.get("x-forwarded-proto");
  if (!proto || proto === "https") return null;

  const url = request.nextUrl.clone();
  url.protocol = "https:";
  return NextResponse.redirect(url, 308);
}

function generateCsrfToken(): string {
  const bytes = new Uint8Array(CSRF_TOKEN_BYTES);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function ensureCsrfCookie(request: NextRequest, response: NextResponse) {
  if (request.cookies.get(CSRF_COOKIE)) return;
  const token = generateCsrfToken();
  response.cookies.set(CSRF_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: CSRF_MAX_AGE,
  });
}

const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-XSS-Protection": "1; mode=block",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
};

const ALLOWED_ORIGIN = (() => {
  const raw = process.env.NEXT_PUBLIC_SITE_URL;
  if (!raw) return null;
  try {
    return new URL(raw).origin;
  } catch {
    return null;
  }
})();

const CORS_ALLOWED_METHODS = "GET,POST,PUT,PATCH,DELETE,OPTIONS";
const CORS_ALLOWED_HEADERS = "Content-Type, Authorization, X-Requested-With";
const CORS_MAX_AGE = "86400";

function applySecurityHeaders(response: NextResponse): NextResponse {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(key, value);
  }
  return response;
}

function applyCorsHeaders(response: NextResponse, origin: string): NextResponse {
  response.headers.set("Access-Control-Allow-Origin", origin);
  response.headers.set("Access-Control-Allow-Credentials", "true");
  response.headers.set("Access-Control-Allow-Methods", CORS_ALLOWED_METHODS);
  response.headers.set("Access-Control-Allow-Headers", CORS_ALLOWED_HEADERS);
  response.headers.set("Access-Control-Max-Age", CORS_MAX_AGE);
  response.headers.append("Vary", "Origin");
  return response;
}

function handleCors(request: NextRequest): NextResponse | null {
  if (!request.nextUrl.pathname.startsWith("/api/")) return null;

  const origin = request.headers.get("origin");

  // No Origin: same-origin nav or non-browser client. Allow; no CORS headers needed.
  if (!origin) {
    if (request.method === "OPTIONS") {
      return new NextResponse(null, { status: 204 });
    }
    return null;
  }

  if (!ALLOWED_ORIGIN || origin !== ALLOWED_ORIGIN) {
    const rejection = NextResponse.json(
      { error: "Origin not allowed" },
      { status: 403 },
    );
    rejection.headers.append("Vary", "Origin");
    return rejection;
  }

  if (request.method === "OPTIONS") {
    const preflight = new NextResponse(null, { status: 204 });
    return applyCorsHeaders(preflight, origin);
  }

  return null;
}

function validateApiRequest(request: NextRequest): NextResponse | null {
  if (!request.nextUrl.pathname.startsWith("/api/")) return null;
  if (!BODY_METHODS.has(request.method)) return null;

  const contentLengthHeader = request.headers.get("content-length");
  if (contentLengthHeader === null) {
    return NextResponse.json(
      { error: "Content-Length header required" },
      { status: 411 },
    );
  }

  const contentLength = Number(contentLengthHeader);
  if (!Number.isFinite(contentLength) || contentLength < 0) {
    return NextResponse.json(
      { error: "Invalid Content-Length" },
      { status: 400 },
    );
  }

  if (contentLength > MAX_BODY_BYTES) {
    return NextResponse.json(
      { error: "Payload too large", maxBytes: MAX_BODY_BYTES },
      { status: 413 },
    );
  }

  if (contentLength > 0) {
    const contentType = request.headers.get("content-type") ?? "";
    const mediaType = contentType.split(";")[0].trim().toLowerCase();
    if (mediaType !== "application/json") {
      return NextResponse.json(
        { error: "Content-Type must be application/json" },
        { status: 415 },
      );
    }
  }

  return null;
}

function resolveClientIp(request: NextRequest): string {
  const fwd = request.headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return first;
  }
  return request.headers.get("x-real-ip")?.trim() || "unknown";
}

function attachClientContext(request: NextRequest): void {
  request.headers.set("x-client-ip", resolveClientIp(request));
  if (!request.headers.get("user-agent")) {
    request.headers.set("user-agent", "unknown");
  }
}

function applyRateLimitHeaders(
  response: NextResponse,
  result: RateLimitResult,
): NextResponse {
  response.headers.set("X-RateLimit-Limit", String(result.limit));
  response.headers.set("X-RateLimit-Remaining", String(result.remaining));
  response.headers.set("X-RateLimit-Reset", String(result.reset));
  if (!result.allowed) {
    response.headers.set("Retry-After", String(result.retryAfter));
  }
  return response;
}

function isApiKeyAuth(request: NextRequest): boolean {
  const auth = request.headers.get("authorization");
  if (!auth) return false;
  const stripped = auth.toLowerCase().startsWith("bearer ")
    ? auth.slice(7).trim()
    : auth.trim();
  return stripped.startsWith("ck_live_");
}

export async function middleware(request: NextRequest) {
  const httpsRedirect = enforceHttps(request);
  if (httpsRedirect) return applySecurityHeaders(httpsRedirect);

  attachClientContext(request);

  const corsResponse = handleCors(request);
  if (corsResponse) return applySecurityHeaders(corsResponse);

  const rejection = validateApiRequest(request);
  if (rejection) {
    const origin = request.headers.get("origin");
    if (origin && origin === ALLOWED_ORIGIN) applyCorsHeaders(rejection, origin);
    return applySecurityHeaders(rejection);
  }

  const isApi = request.nextUrl.pathname.startsWith("/api/");

  // API-key auth path: bypass session / CSRF (Bearer keys are not cookie-bound,
  // so CSRF doesn't apply), but enforce per-key rate limit and forward context.
  if (isApi && isApiKeyAuth(request)) {
    const verified = await verifyApiKey(
      request.headers.get("authorization"),
      lookupApiKeyByHash,
    );
    if (!verified.ok) {
      const status = verified.reason === "expired" || verified.reason === "revoked" ? 403 : 401;
      const reply = NextResponse.json(
        { error: `API key ${verified.reason}` },
        { status },
      );
      const origin = request.headers.get("origin");
      if (origin && origin === ALLOWED_ORIGIN) applyCorsHeaders(reply, origin);
      return applySecurityHeaders(reply);
    }

    const rl = await consumeRateLimit(
      `api:key:${verified.record.id}`,
      verified.record.rate_limit,
      API_WINDOW_MS,
    );
    if (!rl.allowed) {
      const limited = NextResponse.json(
        { error: "Rate limit exceeded", retryAfter: rl.retryAfter },
        { status: 429 },
      );
      applyRateLimitHeaders(limited, rl);
      const origin = request.headers.get("origin");
      if (origin && origin === ALLOWED_ORIGIN) applyCorsHeaders(limited, origin);
      return applySecurityHeaders(limited);
    }

    request.headers.set("x-api-key-id", verified.record.id);
    request.headers.set("x-api-key-user-id", verified.record.user_id);
    request.headers.set(
      "x-api-key-permissions",
      verified.record.permissions.join(","),
    );

    // Fire-and-forget last_used_at touch.
    void touchApiKey(verified.record.id);

    const apiResponse = NextResponse.next({ request });
    applyRateLimitHeaders(apiResponse, rl);
    const origin = request.headers.get("origin");
    if (origin && origin === ALLOWED_ORIGIN) applyCorsHeaders(apiResponse, origin);
    return applySecurityHeaders(apiResponse);
  }

  const { response, userId } = await updateSession(request);

  if (isApi) {
    const rl = await applyApiRateLimit({ headers: request.headers, userId });
    if (!rl.allowed) {
      const limited = NextResponse.json(
        { error: "Rate limit exceeded", retryAfter: rl.retryAfter },
        { status: 429 },
      );
      applyRateLimitHeaders(limited, rl);
      const origin = request.headers.get("origin");
      if (origin && origin === ALLOWED_ORIGIN) applyCorsHeaders(limited, origin);
      return applySecurityHeaders(limited);
    }
    applyRateLimitHeaders(response, rl);
  }

  ensureCsrfCookie(request, response);
  const origin = request.headers.get("origin");
  if (origin && origin === ALLOWED_ORIGIN && isApi) {
    applyCorsHeaders(response, origin);
  }
  return applySecurityHeaders(response);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
