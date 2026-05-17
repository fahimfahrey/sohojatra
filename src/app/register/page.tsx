import type { Metadata } from "next";
import Header from "@/components/layout/Header";
import Footer from "@/components/layout/Footer";
import RegisterForm from "@/components/auth/RegisterForm";

export const metadata: Metadata = {
  title: "Register",
};

export default function RegisterPage() {
  return (
    <div className="min-h-screen flex flex-col bg-gray-50">
      <Header />
      <main className="flex-grow">
        <RegisterForm />
      </main>
      <Footer />
    </div>
  );
}
