/**
 * Edge-safe lookup against the verify_api_key RPC.
 *
 * Uses anon key (RPC is granted to anon/authenticated and is SECURITY DEFINER),
 * so we do not ship the SERVICE_ROLE_KEY to the Edge runtime. The RPC itself
 * is the only thing anon can do — no raw SELECT on api_keys.
 */
import { createClient } from "@supabase/supabase-js";
import type { ApiKeyRecord } from "./api-key";

let client: ReturnType<typeof createClient> | null = null;

function getClient() {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return client;
}

export async function lookupApiKeyByHash(
  keyHash: string,
): Promise<ApiKeyRecord | null> {
  const supabase = getClient();
  if (!supabase) return null;
  // Untyped Database means rpc() infers `args: undefined` — cast through `any`
  // so the call compiles. The runtime payload is validated by the RPC itself.
  const { data, error } = await (supabase as unknown as {
    rpc: (fn: string, args: Record<string, unknown>) => {
      maybeSingle: <T>() => Promise<{ data: T | null; error: unknown }>;
    };
  })
    .rpc("verify_api_key", { p_key_hash: keyHash })
    .maybeSingle<ApiKeyRecord>();
  if (error || !data) return null;
  return data;
}

export async function touchApiKey(id: string): Promise<void> {
  const supabase = getClient();
  if (!supabase) return;
  // Best-effort. A failed write must not block the request.
  try {
    await (supabase as unknown as {
      rpc: (fn: string, args: Record<string, unknown>) => Promise<unknown>;
    }).rpc("touch_api_key", { p_id: id });
  } catch {
    /* ignore */
  }
}
