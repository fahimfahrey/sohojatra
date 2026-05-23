import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { validateCsrfToken } from "@/lib/security/csrf";
import { logDataAccess } from "@/lib/audit";
import { captureError } from "@/lib/observability/sentry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  if (!(await validateCsrfToken(req.headers.get("x-csrf-token")))) {
    return NextResponse.json({ error: "Invalid CSRF token" }, { status: 403 });
  }

  const { id } = await ctx.params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // RLS guarantees user_id = auth.uid(); UPDATE WITH CHECK matches. Soft-revoke
  // (revoked_at) instead of DELETE so the audit trail survives.
  const { data, error } = await supabase
    .from("api_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user.id)
    .is("revoked_at", null)
    .select("id")
    .maybeSingle();

  if (error) {
    captureError(error, { action: "api_keys.revoke", userId: user.id, route: `/api/keys/${id}` });
    return NextResponse.json({ error: "Failed to revoke key" }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Not found or already revoked" }, { status: 404 });
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
    detail: { key_id: id, op: "revoke" },
  });

  return NextResponse.json({ id, revoked: true });
}
