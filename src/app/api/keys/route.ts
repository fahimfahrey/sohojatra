import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { validateCsrfToken } from "@/lib/security/csrf";
import { checkRateLimit } from "@/lib/rate-limit/server";
import { logDataAccess } from "@/lib/audit";
import { captureError } from "@/lib/observability/sentry";
import {
  API_KEY_DEFAULT_RATE_LIMIT,
  API_KEY_PERMISSIONS,
  defaultExpiry,
  generateApiKey,
  type ApiKeyPermission,
} from "@/lib/security/api-key";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PERMISSION_SET = new Set<string>(API_KEY_PERMISSIONS);
const MAX_KEYS_PER_USER = 10;

interface CreateBody {
  name?: unknown;
  permissions?: unknown;
  rate_limit?: unknown;
  expires_at?: unknown;
}

function parseCreateBody(raw: unknown): {
  name: string;
  permissions: ApiKeyPermission[];
  rate_limit: number;
  expires_at: string;
} | { error: string } {
  if (!raw || typeof raw !== "object") return { error: "Invalid body" };
  const body = raw as CreateBody;

  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (name.length < 1 || name.length > 100) {
    return { error: "name must be 1-100 chars" };
  }

  if (!Array.isArray(body.permissions) || body.permissions.length === 0) {
    return { error: "permissions must be a non-empty array" };
  }
  const perms: ApiKeyPermission[] = [];
  for (const p of body.permissions) {
    if (typeof p !== "string" || !PERMISSION_SET.has(p)) {
      return { error: `Unknown permission: ${String(p)}` };
    }
    perms.push(p as ApiKeyPermission);
  }

  let rateLimit = API_KEY_DEFAULT_RATE_LIMIT;
  if (body.rate_limit !== undefined) {
    if (typeof body.rate_limit !== "number" || !Number.isInteger(body.rate_limit)) {
      return { error: "rate_limit must be an integer" };
    }
    if (body.rate_limit < 1 || body.rate_limit > 100_000) {
      return { error: "rate_limit must be 1-100000" };
    }
    rateLimit = body.rate_limit;
  }

  let expiresAt = defaultExpiry().toISOString();
  if (body.expires_at !== undefined) {
    if (typeof body.expires_at !== "string") {
      return { error: "expires_at must be an ISO timestamp" };
    }
    const t = Date.parse(body.expires_at);
    if (!Number.isFinite(t) || t <= Date.now()) {
      return { error: "expires_at must be in the future" };
    }
    expiresAt = new Date(t).toISOString();
  }

  return { name, permissions: perms, rate_limit: rateLimit, expires_at: expiresAt };
}

export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("api_keys")
    .select("id, name, key_prefix, permissions, rate_limit, expires_at, last_used_at, revoked_at, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    captureError(error, { action: "api_keys.list", userId: user.id, route: "/api/keys" });
    return NextResponse.json({ error: "Failed to list keys" }, { status: 500 });
  }

  const ip = req.headers.get("x-client-ip");
  const ua = req.headers.get("user-agent");
  logDataAccess({ event: "data.read", userId: user.id, ip, userAgent: ua, resource: "api_keys", outcome: "success" });
  return NextResponse.json({ keys: data ?? [] });
}

export async function POST(req: Request) {
  if (!(await validateCsrfToken(req.headers.get("x-csrf-token")))) {
    return NextResponse.json({ error: "Invalid CSRF token" }, { status: 403 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!(await checkRateLimit(`api_keys:create:${user.id}`, 5, 60 * 60 * 1000))) {
    return NextResponse.json({ error: "Too many key creations" }, { status: 429 });
  }

  // Cap keys per user; cheap insert-time guard against runaway provisioning.
  const { count } = await supabase
    .from("api_keys")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .is("revoked_at", null);
  if ((count ?? 0) >= MAX_KEYS_PER_USER) {
    return NextResponse.json(
      { error: `Limit of ${MAX_KEYS_PER_USER} active keys reached` },
      { status: 409 },
    );
  }

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const parsed = parseCreateBody(body);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const generated = await generateApiKey();

  const { data: inserted, error } = await supabase
    .from("api_keys")
    .insert({
      user_id: user.id,
      name: parsed.name,
      key_prefix: generated.keyPrefix,
      key_hash: generated.keyHash,
      permissions: parsed.permissions,
      rate_limit: parsed.rate_limit,
      expires_at: parsed.expires_at,
    })
    .select("id, name, key_prefix, permissions, rate_limit, expires_at, created_at")
    .single();

  if (error || !inserted) {
    captureError(error ?? new Error("insert returned no row"), {
      action: "api_keys.create", userId: user.id, route: "/api/keys",
    });
    return NextResponse.json({ error: "Failed to create key" }, { status: 500 });
  }

  const ip = req.headers.get("x-client-ip");
  const ua = req.headers.get("user-agent");
  logDataAccess({
    event: "data.modify",
    userId: user.id,
    ip,
    userAgent: ua,
    resource: "api_keys",
    outcome: "success",
    detail: { key_id: inserted.id, key_prefix: inserted.key_prefix },
  });

  return NextResponse.json(
    {
      ...inserted,
      // Plaintext appears in the response exactly once. Caller must copy it now.
      plaintext: generated.plaintext,
    },
    { status: 201 },
  );
}
