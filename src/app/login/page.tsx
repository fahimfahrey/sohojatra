import type { Metadata } from "next";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import LoginForm from "@/components/auth/LoginForm";

export const metadata: Metadata = {
  title: "Login",
};

export default function LoginPage() {
  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <Header />
      <main className="flex-grow flex items-center py-8 px-4">
        <LoginForm />
      </main>
      <Footer />
    </div>
  );
}
