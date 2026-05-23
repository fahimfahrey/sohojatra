import { headers } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

export type AuditAction =
  | "auth.signin"
  | "auth.signin.oauth"
  | "auth.signup"
  | "auth.signout"
  | "auth.callback"
  | "auth.totp.enroll_start"
  | "auth.totp.enroll_complete"
  | "auth.totp.enroll_abandoned"
  | "auth.totp.disable"
  | "auth.totp.verify"
  | "auth.totp.recovery_use"
  | "auth.totp.stepup"
  | "ride.create"
  | "ride.join"
  | "ride.cancel"
  | "ride.complete"
  | "phone.access"
  | "user.data.export"
  | "user.account.delete";

export type AuditOutcome = "success" | "failure";

export type AuditEvent = {
  action: AuditAction;
  outcome?: AuditOutcome;
  userId?: string | null;
  resourceId?: string | null;
  detail?: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
};

const FORWARDED_HEADERS = [
  "x-client-ip",
  "x-forwarded-for",
  "x-real-ip",
  "cf-connecting-ip",
];

export async function getRequestContext(): Promise<{
  ip: string | null;
  userAgent: string | null;
}> {
  try {
    const h = await headers();
    let ip: string | null = null;
    for (const name of FORWARDED_HEADERS) {
      const v = h.get(name);
      if (v) {
        ip = v.split(",")[0]?.trim() ?? null;
        if (ip && ip !== "unknown") break;
      }
    }
    if (ip === "unknown") ip = null;
    const ua = h.get("user-agent");
    return { ip, userAgent: ua === "unknown" ? null : ua };
  } catch {
    return { ip: null, userAgent: null };
  }
}

/**
 * Writes an entry to public.audit_log via the log_audit_event RPC.
 *
 * Never throws — audit failures must not break the calling action. Falls back
 * to a structured console.log so events still land in platform logs.
 */
export async function logAuditEvent(evt: AuditEvent): Promise<void> {
  const outcome = evt.outcome ?? "success";
  const { ip: ctxIp, userAgent: ctxUa } = await getRequestContext();
  const ip = evt.ip ?? ctxIp;
  const userAgent = evt.userAgent ?? ctxUa;

  const consoleRecord = {
    ts: new Date().toISOString(),
    kind: "audit",
    action: evt.action,
    outcome,
    user_id: evt.userId ?? null,
    resource_id: evt.resourceId ?? null,
    ip,
    user_agent: userAgent,
    detail: evt.detail ?? {},
  };

  try {
    const supabase: SupabaseClient = await createClient();
    const { error } = await supabase.rpc("log_audit_event", {
      p_action: evt.action,
      p_resource_id: evt.resourceId ?? null,
      p_outcome: outcome,
      p_ip_address: ip,
      p_user_agent: userAgent,
      p_detail: evt.detail ?? {},
      p_user_id: evt.userId ?? null,
    });

    if (error) {
      console.warn(JSON.stringify({ ...consoleRecord, audit_rpc_error: error.message }));
    }
  } catch (err) {
    console.warn(
      JSON.stringify({
        ...consoleRecord,
        audit_rpc_error: err instanceof Error ? err.message : "unknown",
      }),
    );
  }
}

/**
 * Legacy shim for callers that predate the audit_log table. Maps the old
 * `{event, resource}` shape onto logAuditEvent.
 */
export function logDataAccess(evt: {
  event: AuditAction | string;
  userId: string;
  outcome: AuditOutcome;
  ip?: string | null;
  userAgent?: string | null;
  resource?: string;
  detail?: Record<string, unknown>;
}): void {
  void logAuditEvent({
    action: evt.event as AuditAction,
    userId: evt.userId === "anonymous" ? null : evt.userId,
    outcome: evt.outcome,
    ip: evt.ip,
    userAgent: evt.userAgent,
    resourceId: evt.resource ?? null,
    detail: evt.detail,
  });
}
