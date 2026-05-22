type AuditEvent = {
  event: string;
  userId: string;
  ip?: string | null;
  userAgent?: string | null;
  resource?: string;
  outcome: "success" | "failure";
  detail?: Record<string, unknown>;
};

export function logDataAccess(evt: AuditEvent): void {
  const record = {
    ts: new Date().toISOString(),
    kind: "data_access",
    ...evt,
  };
  console.log(JSON.stringify(record));
}
