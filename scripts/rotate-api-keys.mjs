#!/usr/bin/env node
/**
 * Quarterly API key rotation reminder.
 *
 * For each row in api_keys_due_rotation (created > 90 days ago, not revoked):
 *   - logs key id, prefix, owner, age in days
 *   - in --notify mode, writes a notifications row for the owner
 *   - in --revoke mode, sets revoked_at = now() (hard cutoff)
 *
 * Default mode is dry-run.
 *
 *   node scripts/rotate-api-keys.mjs
 *   node scripts/rotate-api-keys.mjs --notify
 *   node scripts/rotate-api-keys.mjs --revoke
 *
 * Requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in env.
 */

import { createClient } from "@supabase/supabase-js";

const args = new Set(process.argv.slice(2));
const NOTIFY = args.has("--notify");
const REVOKE = args.has("--revoke");

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(2);
}

const supabase = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data, error } = await supabase
  .from("api_keys_due_rotation")
  .select("id, user_id, name, key_prefix, created_at, expires_at");

if (error) {
  console.error("Query failed:", error.message);
  process.exit(1);
}

if (!data || data.length === 0) {
  console.log("No keys due for rotation.");
  process.exit(0);
}

const now = Date.now();
console.log(`Found ${data.length} key(s) older than 90 days:`);
for (const row of data) {
  const ageDays = Math.floor((now - Date.parse(row.created_at)) / 86_400_000);
  console.log(`  ${row.key_prefix}…  user=${row.user_id}  name="${row.name}"  age=${ageDays}d`);
}

if (NOTIFY) {
  const rows = data.map((row) => ({
    user_id: row.user_id,
    type: "api_key_rotation",
    title: "Rotate your API key",
    body: `Key "${row.name}" (${row.key_prefix}…) is over 90 days old. Create a new one and revoke this.`,
  }));
  const { error: notifyErr } = await supabase.from("notifications").insert(rows);
  if (notifyErr) {
    console.error("Failed to insert notifications:", notifyErr.message);
    process.exit(1);
  }
  console.log(`Notified ${rows.length} owner(s).`);
}

if (REVOKE) {
  const ids = data.map((r) => r.id);
  const { error: revErr } = await supabase
    .from("api_keys")
    .update({ revoked_at: new Date().toISOString() })
    .in("id", ids);
  if (revErr) {
    console.error("Failed to revoke:", revErr.message);
    process.exit(1);
  }
  console.log(`Revoked ${ids.length} key(s).`);
}

if (!NOTIFY && !REVOKE) {
  console.log("Dry-run. Pass --notify or --revoke to act.");
}
