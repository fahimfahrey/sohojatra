import type { Metadata } from "next";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Confirm Email",
};

export default function EmailConfirmationPage() {
  return (
    <div className="min-h-screen flex flex-col">
      <Header />
      <main className="flex-grow flex items-center justify-center px-4 py-12">
        <div className="max-w-md w-full bg-white rounded-3xl shadow-large p-8 text-center border border-gray-100">
          <h1 className="text-2xl font-bold text-gray-900 mb-3">
            Check your email
          </h1>
          <p className="text-gray-600 mb-6 text-sm sm:text-base">
            We sent a confirmation link to your inbox. Please verify your email
            before using protected features.
          </p>
          <Link
            href="/login"
            className="inline-block px-6 py-3 bg-accent-500 text-white rounded-xl font-semibold hover:bg-accent-600"
          >
            Back to login
          </Link>
        </div>
      </main>
      <Footer />
    </div>
  );
}
