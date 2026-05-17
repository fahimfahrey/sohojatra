"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/rate-limit/server";
import {
  signInSchema,
  signUpSchema,
  type ActionResult,
} from "@/lib/validation/schemas";

async function getClientIp(): Promise<string> {
  const headersList = await headers();
  return (
    headersList.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    headersList.get("x-real-ip") ??
    "unknown"
  );
}

async function ensureUserProfile(
  userId: string,
  email: string,
  name: string,
) {
  const supabase = await createClient();
  const { data: existingUser } = await supabase
    .from("users")
    .select("id")
    .eq("id", userId)
    .maybeSingle();

  if (!existingUser) {
    await supabase.from("users").upsert({
      id: userId,
      email,
      name,
    });
  }
}

export async function signInAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { success: false, error: "Invalid email or password" };
  }

  const ip = await getClientIp();
  const rateKey = `login:${ip}:${parsed.data.email.toLowerCase()}`;
  if (!checkRateLimit(rateKey, 5, 15 * 60 * 1000)) {
    return {
      success: false,
      error: "Too many login attempts. Please try again later.",
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error || !data.user) {
    return { success: false, error: "Invalid email or password" };
  }

  const userName =
    (data.user.user_metadata?.name as string | undefined) ??
    (data.user.user_metadata?.full_name as string | undefined) ??
    parsed.data.email.split("@")[0];

  await ensureUserProfile(data.user.id, parsed.data.email, userName);
  revalidatePath("/", "layout");
  redirect("/dashboard");
}

export async function signUpAction(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = signUpSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    name: formData.get("name"),
  });

  if (!parsed.success) {
    return { success: false, error: "Please check your registration details" };
  }

  const ip = await getClientIp();
  if (!checkRateLimit(`signup:${ip}`, 3, 60 * 60 * 1000)) {
    return {
      success: false,
      error: "Too many sign-up attempts. Please try again later.",
    };
  }

  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { name: parsed.data.name },
      emailRedirectTo: `${siteUrl}/auth/callback?next=/dashboard`,
    },
  });

  if (error) {
    return {
      success: false,
      error:
        "Unable to complete registration. If you already have an account, try signing in.",
    };
  }

  if (data.user) {
    await ensureUserProfile(data.user.id, parsed.data.email, parsed.data.name);
  }

  revalidatePath("/", "layout");
  redirect("/email-confirmation");
}

export async function signOutAction(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/");
}

export async function signInWithGoogleAction(): Promise<void> {
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  const redirectTo = `${siteUrl}/auth/callback?next=/dashboard`;

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo,
      queryParams: {
        access_type: "offline",
        prompt: "consent",
      },
    },
  });

  if (error || !data.url) {
    redirect("/login?error=oauth");
  }

  redirect(data.url);
}
