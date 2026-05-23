import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-static";

const SITE_URL =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? "https://sohojatra.app";

const ErrorSchema = {
  type: "object",
  required: ["error"],
  properties: {
    error: { type: "string", description: "Human-readable error message." },
    retryAfter: {
      type: "integer",
      description: "Seconds until the client may retry. Present on 429 responses.",
    },
    maxBytes: {
      type: "integer",
      description: "Maximum allowed request body size. Present on 413 responses.",
    },
  },
  additionalProperties: true,
} as const;

const RateLimitedSchema = {
  allOf: [
    { $ref: "#/components/schemas/Error" },
    {
      type: "object",
      description:
        "Returned when a rate limit is exceeded. The response includes `Retry-After` and `X-RateLimit-*` headers. Clients should back off and retry after the indicated delay.",
    },
  ],
} as const;

const RateLimitHeaders = {
  "X-RateLimit-Limit": {
    description: "Maximum requests permitted in the current window.",
    schema: { type: "integer" },
  },
  "X-RateLimit-Remaining": {
    description: "Requests remaining in the current window.",
    schema: { type: "integer" },
  },
  "X-RateLimit-Reset": {
    description: "Unix timestamp (ms) when the current window resets.",
    schema: { type: "integer", format: "int64" },
  },
} as const;

const RateLimitedHeaders = {
  ...RateLimitHeaders,
  "Retry-After": {
    description: "Seconds the client should wait before retrying.",
    schema: { type: "integer" },
  },
} as const;

const errorResponse = (description: string) => ({
  description,
  content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
});

const rateLimitedResponse = (description: string) => ({
  description,
  headers: RateLimitedHeaders,
  content: { "application/json": { schema: { $ref: "#/components/schemas/RateLimited" } } },
});

const commonErrorResponses = {
  "400": errorResponse("Invalid Content-Length header on a body-bearing request."),
  "403": errorResponse(
    "Origin not allowed. Cross-origin requests from non-allowlisted origins are rejected.",
  ),
  "411": errorResponse(
    "Body-bearing requests (POST/PUT/PATCH/DELETE) must include a `Content-Length` header.",
  ),
  "413": errorResponse("Payload exceeds the 1 MB request body cap."),
  "415": errorResponse("`Content-Type` must be `application/json` for body-bearing requests."),
} as const;

const spec = {
  openapi: "3.1.0",
  info: {
    title: "Sohojatra API",
    version: "0.3.0",
    summary: "Ride-sharing platform HTTP API",
    description: [
      "Internal HTTP API for the Sohojatra ride-sharing platform.",
      "",
      "## Authentication",
      "All endpoints require a valid Supabase session delivered via HTTP-only cookies set during",
      "sign-in at `/login`. Cookies are named `sb-<project-ref>-auth-token` (and companion cookies)",
      "and are managed by `@supabase/ssr`. They are `HttpOnly`, `Secure`, and `SameSite=Lax`, so",
      "they cannot be read or set by JavaScript.",
      "",
      "Direct API access from third-party origins is blocked by an allowlist enforced in",
      "`middleware.ts`. Only the origin matching `NEXT_PUBLIC_SITE_URL` may make cross-origin",
      "requests; all others receive `403 Origin not allowed`.",
      "",
      "## Rate limits",
      "",
      "### Global API limit (enforced in middleware)",
      "- **Authenticated users:** 1000 requests per minute per user id.",
      "- **Anonymous / unauthenticated:** 100 requests per minute per client IP.",
      "",
      "Every API response includes `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and",
      "`X-RateLimit-Reset` headers. When the limit is exceeded the response is `429 Too Many",
      "Requests` with a `Retry-After` header.",
      "",
      "### Per-endpoint limits",
      "- `/api/user/data` (GET): **3 per hour per user.**",
      "- `/api/user/account` (DELETE): **3 per hour per user.**",
      "",
      "Exceeding either limit returns `429`.",
      "",
      "## Request constraints",
      "- Body-bearing methods (POST/PUT/PATCH/DELETE) must send `Content-Type: application/json`.",
      "- A `Content-Length` header is required on body-bearing requests.",
      "- Request bodies are capped at **1 MB**. Larger payloads return `413 Payload Too Large`.",
      "",
      "## Security headers",
      "All responses include `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`,",
      "`X-Frame-Options: DENY`, and `X-XSS-Protection: 1; mode=block`. A CSRF cookie",
      "(`csrf-token`, HttpOnly) is set on first contact for defence-in-depth.",
      "",
      "## Error format",
      "All errors return JSON of the form `{ \"error\": \"<message>\" }` (plus optional",
      "`retryAfter` / `maxBytes` fields) with the appropriate HTTP status.",
      "",
      "## Security guidance for integrators",
      "- **Never embed Supabase service-role keys** in client code or relay them through this API.",
      "- **Always use HTTPS.** HSTS is enforced; HTTP requests are upgraded.",
      "- **Honour `Retry-After`.** Implement exponential backoff on `429` responses; do not retry tighter than the indicated delay.",
      "- **Treat exported data as sensitive.** `/api/user/data` returns PII; store responses encrypted at rest and never log them.",
      "- **Do not cache realtime tokens.** Ably `TokenRequest` values are short-lived; re-request via `/api/ably/token` instead.",
      "- **Account deletion is reversible during the recovery window.** Re-authenticating before `scheduledPurgeAt` cancels the scheduled purge.",
      "- **Do not bypass CSRF protection.** Mutating requests must originate from the same site; foreign origins are rejected with `403`.",
      "- **Validate `Content-Type` and `Content-Length`.** Missing or oversized payloads are rejected at the edge with `411`/`413`/`415`.",
      "- **Do not depend on the Supabase cookie name.** Cookie names are project-scoped (`sb-<ref>-auth-token`) and may change; let the Supabase client manage them.",
      "- **Report vulnerabilities** per `/.well-known/security.txt`.",
    ].join("\n"),
    contact: {
      name: "Sohojatra security",
      url: `${SITE_URL}/.well-known/security.txt`,
    },
    license: { name: "Proprietary", identifier: "LicenseRef-Proprietary" },
  },
  servers: [{ url: SITE_URL, description: "Production" }],
  tags: [
    { name: "User", description: "User account and data export" },
    { name: "Realtime", description: "Ably realtime token issuance" },
    { name: "Docs", description: "API reference and OpenAPI specification" },
  ],
  security: [{ supabaseSession: [] }],
  paths: {
    "/api/user/account": {
      delete: {
        tags: ["User"],
        summary: "Schedule account deletion",
        description:
          "Schedules the authenticated user's account for permanent deletion and signs the user out. The account remains in a recoverable state for `recoveryWindowDays`; signing in again before `scheduledPurgeAt` cancels the deletion. Rate-limited to 3 requests per hour per user (in addition to the global API limit).",
        operationId: "deleteAccount",
        security: [{ supabaseSession: [] }],
        responses: {
          "200": {
            description: "Deletion scheduled.",
            headers: RateLimitHeaders,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: [
                    "status",
                    "requestedAt",
                    "scheduledPurgeAt",
                    "recoveryWindowDays",
                    "message",
                  ],
                  properties: {
                    status: { type: "string", enum: ["scheduled"] },
                    requestedAt: { type: "string", format: "date-time" },
                    scheduledPurgeAt: { type: "string", format: "date-time" },
                    recoveryWindowDays: { type: "integer", minimum: 1 },
                    message: { type: "string" },
                  },
                },
              },
            },
          },
          "401": errorResponse("Missing or invalid session."),
          ...commonErrorResponses,
          "429": rateLimitedResponse(
            "Rate limit exceeded. Either the per-endpoint limit (3/hour/user) or the global API limit was hit.",
          ),
          "500": errorResponse("Server failed to schedule deletion."),
        },
      },
    },
    "/api/user/data": {
      get: {
        tags: ["User"],
        summary: "Export user data (GDPR / data portability)",
        description:
          "Returns a JSON archive containing the authenticated user's profile, created rides, joined rides, and notifications. The response is delivered as an attachment with `Cache-Control: no-store`. Rate-limited to 3 requests per hour per user (in addition to the global API limit).",
        operationId: "exportUserData",
        security: [{ supabaseSession: [] }],
        responses: {
          "200": {
            description: "Export bundle.",
            headers: {
              ...RateLimitHeaders,
              "Content-Disposition": {
                description: "Attachment with per-user filename.",
                schema: { type: "string" },
              },
              "Cache-Control": {
                description: "Always `no-store` — response contains PII.",
                schema: { type: "string" },
              },
            },
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: [
                    "exportedAt",
                    "schemaVersion",
                    "user",
                    "ridesCreated",
                    "ridesJoined",
                    "notifications",
                  ],
                  properties: {
                    exportedAt: { type: "string", format: "date-time" },
                    schemaVersion: { type: "integer", const: 1 },
                    user: {
                      type: "object",
                      properties: {
                        id: { type: "string", format: "uuid" },
                        email: { type: "string", format: "email", nullable: true },
                        created_at: { type: "string", format: "date-time" },
                        last_sign_in_at: {
                          type: "string",
                          format: "date-time",
                          nullable: true,
                        },
                        metadata: { type: "object", additionalProperties: true },
                      },
                    },
                    profile: { type: "object", nullable: true, additionalProperties: true },
                    ridesCreated: {
                      type: "array",
                      items: { type: "object", additionalProperties: true },
                    },
                    ridesJoined: {
                      type: "array",
                      items: { type: "object", additionalProperties: true },
                    },
                    notifications: {
                      type: "array",
                      items: { type: "object", additionalProperties: true },
                    },
                  },
                },
              },
            },
          },
          "401": errorResponse("Missing or invalid session."),
          "403": errorResponse(
            "Origin not allowed. Cross-origin requests from non-allowlisted origins are rejected.",
          ),
          "429": rateLimitedResponse(
            "Rate limit exceeded. Either the per-endpoint limit (3/hour/user) or the global API limit was hit.",
          ),
          "500": errorResponse("Database read failed."),
        },
      },
    },
    "/api/ably/token": {
      get: {
        tags: ["Realtime"],
        summary: "Issue an Ably realtime token",
        description:
          "Returns a short-lived Ably `TokenRequest` for the authenticated user. The token grants `subscribe` and `publish` capability on the `rides` channel and is scoped to the user's id as `clientId`. Tokens are short-lived and must not be cached; re-request on demand.",
        operationId: "ablyToken",
        security: [{ supabaseSession: [] }],
        responses: {
          "200": {
            description: "Signed Ably TokenRequest. Pass directly to the Ably client SDK.",
            headers: RateLimitHeaders,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  description: "Ably TokenRequest (see Ably SDK docs).",
                  additionalProperties: true,
                },
              },
            },
          },
          "401": errorResponse("Missing or invalid session."),
          "403": errorResponse(
            "Origin not allowed. Cross-origin requests from non-allowlisted origins are rejected.",
          ),
          "429": rateLimitedResponse(
            "Global API rate limit exceeded for this user or IP.",
          ),
          "500": errorResponse("Token request creation failed."),
          "503": errorResponse("Ably is not configured on this deployment."),
        },
      },
    },
    "/api/docs": {
      get: {
        tags: ["Docs"],
        summary: "Swagger UI for this API",
        description:
          "Renders the Swagger UI for the OpenAPI specification at `/api/docs/openapi.json`. Public; no authentication required. Served with `X-Robots-Tag: noindex, nofollow`.",
        operationId: "swaggerUi",
        security: [],
        responses: {
          "200": {
            description: "HTML page hosting Swagger UI.",
            content: { "text/html": { schema: { type: "string" } } },
          },
        },
      },
    },
    "/api/docs/openapi.json": {
      get: {
        tags: ["Docs"],
        summary: "OpenAPI 3.1 specification",
        description:
          "Returns this OpenAPI document. Public; no authentication required. Cached for 5 minutes.",
        operationId: "openapiSpec",
        security: [],
        responses: {
          "200": {
            description: "OpenAPI 3.1 JSON document.",
            content: {
              "application/json": {
                schema: { type: "object", additionalProperties: true },
              },
            },
          },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      supabaseSession: {
        type: "apiKey",
        in: "cookie",
        name: "sb-<project-ref>-auth-token",
        description:
          "Supabase session cookie set by `/login` via `@supabase/ssr`. The actual cookie name is `sb-<project-ref>-auth-token` where `<project-ref>` is the Supabase project reference. HttpOnly, Secure, SameSite=Lax — cannot be read or set by JavaScript.",
      },
    },
    schemas: {
      Error: ErrorSchema,
      RateLimited: RateLimitedSchema,
    },
  },
} as const;

export function GET() {
  return NextResponse.json(spec, {
    headers: {
      "Cache-Control": "public, max-age=300, must-revalidate",
    },
  });
}
