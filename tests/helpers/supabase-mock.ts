import { vi } from "vitest";

type UserShape = {
  id: string;
  email: string;
  email_confirmed_at?: string | null;
  user_metadata?: Record<string, unknown>;
  created_at?: string;
  last_sign_in_at?: string;
};

export type SupabaseMock = ReturnType<typeof buildSupabaseMock>;

export function buildSupabaseMock(opts: {
  user?: UserShape | null;
  authError?: { message: string } | null;
  rpcResult?: { data: unknown; error: { message: string } | null };
  tableData?: Record<string, { data: unknown; error: { message: string } | null }>;
} = {}) {
  const tableMock = (name: string) => {
    const result = opts.tableData?.[name] ?? { data: [], error: null };
    const chain: Record<string, unknown> = {};
    const passthrough = () => chain;
    for (const m of [
      "select",
      "insert",
      "update",
      "delete",
      "upsert",
      "eq",
      "neq",
      "in",
      "is",
      "order",
      "limit",
    ]) {
      chain[m] = vi.fn(passthrough);
    }
    chain.single = vi.fn(async () => result);
    chain.maybeSingle = vi.fn(async () => result);
    chain.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve);
    return chain;
  };

  return {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: opts.user ?? null },
        error: opts.authError ?? null,
      })),
      signOut: vi.fn(async () => ({ error: null })),
      signInWithPassword: vi.fn(async () => ({
        data: { user: opts.user ?? null },
        error: opts.authError ?? null,
      })),
    },
    from: vi.fn(tableMock),
    rpc: vi.fn(async () =>
      opts.rpcResult ?? { data: null, error: null },
    ),
  };
}
