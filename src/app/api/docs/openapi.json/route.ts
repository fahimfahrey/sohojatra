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
  },
  additionalProperties: true,
} as const;

const RateLimitedSchema = {
  allOf: [
    { $ref: "#/components/schemas/Error" },
    {
      type: "object",
      description:
        "Returned when the per-user rate limit has been exceeded. Clients should back off and retry later.",
    },
  ],
} as const;

const spec = {
  openapi: "3.1.0",
  info: {
    title: "Sohojatra API",
    version: "0.2.0",
    summary: "Ride-sharing platform HTTP API",
    description: [
      "Internal HTTP API for the Sohojatra ride-sharing platform.",
      "",
      "## Authentication",
      "All endpoints require a valid Supabase session. The session is delivered as an HTTP-only",
      "cookie set during sign-in via `/login`. Direct API access from third-party origins is",
      "blocked by the same-origin CORS policy enforced in `middleware.ts`.",
      "",
      "## Rate limits",
      "User-data and account-deletion endpoints are limited to **3 requests per hour per user**.",
      "Exceeding the limit returns `429 Too Many Requests`. Limits are tracked server-side by user id.",
      "",
      "## Request size",
      "Request bodies are capped at **1 MB**. Larger payloads return `413 Payload Too Large`.",
      "Body-bearing methods (POST/PUT/PATCH/DELETE) must send `Content-Type: application/json`.",
      "",
      "## Error format",
      "All errors return JSON of the form `{ \"error\": \"<message>\" }` with the appropriate HTTP status.",
      "",
      "## Security guidance for integrators",
      "- **Never embed Supabase service-role keys** in client code or relay them through this API.",
      "- **Always use HTTPS.** HSTS is enforced via `Strict-Transport-Security`.",
      "- **Respect rate limits.** Implement exponential backoff on `429` responses.",
      "- **Treat exported data as sensitive.** `/api/user/data` returns PII; store responses encrypted at rest and never log them.",
      "- **Ably tokens are short-lived.** Re-request via `/api/ably/token` rather than caching capability tokens.",
      "- **Account deletion is reversible during the recovery window.** Re-authenticating cancels the scheduled purge.",
      "- **Do not bypass CSRF protection.** The API relies on the same-origin policy plus the `SameSite` cookie attribute; mutating requests from foreign origins are rejected with `403`.",
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
  ],
  security: [{ supabaseSession: [] }],
  paths: {
    "/api/user/account": {
      delete: {
        tags: ["User"],
        summary: "Schedule account deletion",
        description:
          "Schedules the authenticated user's account for permanent deletion. Signs the user out. The account remains in a recoverable state for `recoveryWindowDays` — signing in again before purge cancels the deletion. Rate-limited to 3 requests per hour per user.",
        operationId: "deleteAccount",
        security: [{ supabaseSession: [] }],
        responses: {
          "200": {
            description: "Deletion scheduled.",
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
          "401": {
            description: "Missing or invalid session.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
          "429": {
            description: "Rate limit exceeded (3 per hour per user).",
            content: { "application/json": { schema: { $ref: "#/components/schemas/RateLimited" } } },
          },
          "500": {
            description: "Server failed to schedule deletion.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
        },
      },
    },
    "/api/user/data": {
      get: {
        tags: ["User"],
        summary: "Export user data (GDPR / data portability)",
        description:
          "Returns a JSON archive containing the authenticated user's profile, created rides, joined rides, and notifications. Response is delivered with `Content-Disposition: attachment` and `Cache-Control: no-store`. Rate-limited to 3 requests per hour per user.",
        operationId: "exportUserData",
        security: [{ supabaseSession: [] }],
        responses: {
          "200": {
            description: "Export bundle.",
            headers: {
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
          "401": {
            description: "Missing or invalid session.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
          "429": {
            description: "Rate limit exceeded (3 per hour per user).",
            content: { "application/json": { schema: { $ref: "#/components/schemas/RateLimited" } } },
          },
          "500": {
            description: "Database read failed.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
        },
      },
    },
    "/api/ably/token": {
      get: {
        tags: ["Realtime"],
        summary: "Issue an Ably realtime token",
        description:
          "Returns a short-lived Ably `TokenRequest` for the authenticated user. The token grants `subscribe` and `publish` capability on the `rides` channel and is scoped to the user's id as `clientId`. Tokens are short-lived; do not cache.",
        operationId: "ablyToken",
        security: [{ supabaseSession: [] }],
        responses: {
          "200": {
            description: "Signed Ably TokenRequest. Pass directly to the Ably client SDK.",
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
          "401": {
            description: "Missing or invalid session.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
          "500": {
            description: "Token request creation failed.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
          },
          "503": {
            description: "Ably is not configured on this deployment.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
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
        name: "sb-access-token",
        description:
          "Supabase session cookie set by `/login`. HTTP-only, Secure, SameSite=Lax. Cannot be set by JavaScript.",
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
