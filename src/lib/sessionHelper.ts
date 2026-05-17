import type { Session } from "@supabase/supabase-js";

function getSupabaseProjectId(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const match = url.match(/https?:\/\/([^.]+)\.supabase\.co/);
  return match?.[1] ?? "";
}

export function getAuthTokenKey(): string {
  return `sb-${getSupabaseProjectId()}-auth-token`;
}

export function hasValidToken(): boolean {
  if (typeof window === "undefined") return false;

  try {
    const tokenStr = localStorage.getItem(getAuthTokenKey());
    if (!tokenStr) return false;

    const token = JSON.parse(tokenStr) as {
      expires_at?: number;
      user?: { id: string };
    };

    if (!token?.expires_at || !token.user) return false;

    return new Date() < new Date(token.expires_at * 1000);
  } catch {
    return false;
  }
}

export function saveLastRoute(path: string): void {
  if (typeof window === "undefined") return;
  if (path && !path.includes("/login") && !path.includes("/register")) {
    localStorage.setItem("lastRoute", path);
  }
}

export function getLastRoute(): string {
  if (typeof window === "undefined") return "/dashboard";
  return localStorage.getItem("lastRoute") ?? "/dashboard";
}

export function clearLastRoute(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem("lastRoute");
}

export function isSessionValid(session: Session | null): boolean {
  if (!session?.expires_at) return !!session;

  return new Date() < new Date(session.expires_at * 1000);
}
