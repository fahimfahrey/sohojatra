import { createClient } from "@/lib/supabase/server";
import type { UserType } from "@/types";

export async function getProfileForUser(
  userId: string,
  email: string,
  metadata?: Record<string, unknown>,
): Promise<UserType> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("users")
    .select("name, email")
    .eq("id", userId)
    .maybeSingle();

  const metaName =
    (metadata?.name as string | undefined) ??
    (metadata?.full_name as string | undefined);

  return {
    id: userId,
    email: data?.email ?? email,
    name: data?.name ?? metaName ?? email.split("@")[0] ?? "User",
  };
}
