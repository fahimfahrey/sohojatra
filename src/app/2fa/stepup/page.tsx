import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import TotpChallengeForm from "@/components/auth/TotpChallengeForm";
import { getOptionalUser } from "@/lib/auth/require-user";
import { readCsrfCookie } from "@/lib/security/csrf";

export const metadata: Metadata = {
  title: "Confirm action",
};

export default async function TotpStepupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const user = await getOptionalUser();
  if (!user) redirect("/login");
  if (user.app_metadata?.totp_enabled !== true) {
    const { next } = await searchParams;
    redirect(next && next.startsWith("/") ? next : "/dashboard");
  }

  const { next } = await searchParams;
  const csrfToken = (await readCsrfCookie()) ?? "";

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <Header />
      <main className="flex-grow flex items-center py-8 px-4">
        <TotpChallengeForm mode="stepup" next={next} csrfToken={csrfToken} />
      </main>
      <Footer />
    </div>
  );
}
