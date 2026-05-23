import { headers } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { redact } from "@/lib/observability/redact";

export type AuditAction =
  | "auth.signin"
  | "auth.signin.oauth"
  | "auth.signup"
  | "auth.signout"
  | "auth.callback"
<<<<<<< HEAD
  | "auth.totp.enroll_start"
  | "auth.totp.enroll_complete"
  | "auth.totp.enroll_abandoned"
  | "auth.totp.disable"
  | "auth.totp.verify"
  | "auth.totp.recovery_use"
  | "auth.totp.stepup"
=======
  | "auth.reset.request"
  | "auth.reset.confirm"
  | "auth.reset.rate_limited"
>>>>>>> 8a2a26d91f5f1b6da4ad2d3d4a9c45f062001928
  | "ride.create"
  | "ride.join"
  | "ride.cancel"
  | "ride.complete"
  | "phone.access"
  | "user.data.export"
  | "user.account.delete"
  | "data.read"
  | "data.modify"
  | "data.delete";

export type AuditOutcome = "success" | "failure";

export type AuditChanges = {
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
};

export type AuditEvent = {
  action: AuditAction;
  outcome?: AuditOutcome;
  userId?: string | null;
  resourceId?: string | null;
  detail?: Record<string, unknown>;
  changes?: AuditChanges;
  ip?: string | null;
  userAgent?: string | null;
};

/**
 * Computes a minimal before/after diff for the columns listed in `fields`.
 * Only fields whose value differs are returned, so the audit row stays small
 * and forensics can scan `changes` without wading through unchanged columns.
 */
export function diffChanges<T extends Record<string, unknown>>(
  before: T | null | undefined,
  after: T | null | undefined,
  fields: ReadonlyArray<keyof T>,
): AuditChanges {
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const f of fields) {
    const bv = before ? before[f] : undefined;
    const av = after ? after[f] : undefined;
    if (bv !== av) {
      b[f as string] = bv ?? null;
      a[f as string] = av ?? null;
    }
  }
  return { before: b, after: a };
}

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

  const changes = evt.changes ?? {};

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
    changes,
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
      p_changes: changes,
    });

    if (error) {
      console.warn(
        JSON.stringify(
          redact({ ...consoleRecord, audit_rpc_error: error.message }),
        ),
      );
    }
  } catch (err) {
    console.warn(
      JSON.stringify(
        redact({
          ...consoleRecord,
          audit_rpc_error: err instanceof Error ? err.message : "unknown",
        }),
      ),
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
