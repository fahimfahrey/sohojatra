import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

const MAX_BODY_BYTES = 1_048_576; // 1 MB
const BODY_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

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
  const rejection = validateApiRequest(request);
  if (rejection) return rejection;

  return updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
