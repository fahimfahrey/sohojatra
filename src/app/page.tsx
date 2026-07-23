import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import HomePage from "@/components/pages/HomePage";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ code?: string; next?: string }>;
}) {
  // Supabase can deliver the OAuth code to the Site URL root instead of
  // /auth/callback (e.g. when the requested redirect isn't allowlisted).
  // Forward it to the callback route so the code is exchanged for a session.
  const { code, next } = await searchParams;
  if (code) {
    const params = new URLSearchParams({ code });
    if (next) params.set("next", next);
    redirect(`/auth/callback?${params.toString()}`);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return <HomePage isAuthenticated={!!user} />;
}
