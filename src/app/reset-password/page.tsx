import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import ResetPasswordForm from "@/components/auth/ResetPasswordForm";
import { getOptionalUser } from "@/lib/auth/require-user";

export const metadata: Metadata = {
  title: "Reset password",
};

export default async function ResetPasswordPage() {
  const user = await getOptionalUser();
  if (!user) {
    redirect("/forgot-password?expired=1");
  }

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <Header />
      <main className="flex-grow flex items-center py-8 px-4">
        <ResetPasswordForm />
      </main>
      <Footer />
    </div>
  );
}
