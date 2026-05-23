import type { Metadata } from "next";
import { redirect } from "next/navigation";
import QRCode from "qrcode";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import TotpEnrollForm from "@/components/auth/TotpEnrollForm";
import { getOptionalUser } from "@/lib/auth/require-user";
import { readCsrfCookie } from "@/lib/security/csrf";
import { startTotpEnrollmentAction } from "@/app/actions/totp";

export const metadata: Metadata = {
  title: "Enable two-factor authentication",
};

export const dynamic = "force-dynamic";

export default async function TotpEnrollPage() {
  const user = await getOptionalUser();
  if (!user) redirect("/login");
  if (user.app_metadata?.totp_enabled === true) redirect("/dashboard");

  const csrfToken = (await readCsrfCookie()) ?? "";

  const start = await startTotpEnrollmentAction(csrfToken);
  if (!start.success || !start.data) {
    return (
      <div className="min-h-screen flex flex-col bg-gray-50">
        <Header />
        <main className="flex-grow flex items-center py-8 px-4">
          <div className="w-full max-w-md mx-auto bg-white shadow-large rounded-3xl px-6 sm:px-8 py-8 border border-gray-100">
            <h1 className="text-2xl font-bold text-gray-900 mb-2 text-center">
              Could not start enrollment
            </h1>
            <p className="text-sm text-gray-600 text-center mb-4">
              {start.success ? "Unknown error" : start.error}
            </p>
            <a
              href="/dashboard"
              className="block w-full text-center py-3 rounded-xl bg-accent-500 text-white font-semibold"
            >
              Back to dashboard
            </a>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  const qrDataUri = await QRCode.toDataURL(start.data.otpauthUri, {
    width: 256,
    margin: 1,
    errorCorrectionLevel: "M",
  });

  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <Header />
      <main className="flex-grow flex items-center py-8 px-4">
        <TotpEnrollForm
          csrfToken={csrfToken}
          qrDataUri={qrDataUri}
          otpauthUri={start.data.otpauthUri}
          secretFormatted={start.data.secretFormatted}
        />
      </main>
      <Footer />
    </div>
  );
}
