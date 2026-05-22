import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

const MAX_BODY_BYTES = 1_048_576; // 1 MB
const BODY_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

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

export async function middleware(request: NextRequest) {
  const corsResponse = handleCors(request);
  if (corsResponse) return applySecurityHeaders(corsResponse);

  const rejection = validateApiRequest(request);
  if (rejection) {
    const origin = request.headers.get("origin");
    if (origin && origin === ALLOWED_ORIGIN) applyCorsHeaders(rejection, origin);
    return applySecurityHeaders(rejection);
  }

  const response = await updateSession(request);
  const origin = request.headers.get("origin");
  if (origin && origin === ALLOWED_ORIGIN && request.nextUrl.pathname.startsWith("/api/")) {
    applyCorsHeaders(response, origin);
  }
  return applySecurityHeaders(response);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
