import React from "react";
import { useLocation, Navigate } from "react-router-dom";
import Header from "../components/layout/Header";
import Footer from "../components/layout/Footer";
import { Mail } from "lucide-react";

const EmailConfirmationPage: React.FC = () => {
  const location = useLocation();
  const email = location.state?.email;

  if (!email) {
    return <Navigate to="/register" />;
  }

  return (
    <div className="min-h-screen flex flex-col">
      <Header />

      <main className="flex-grow flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8 bg-gray-50">
        <div className="w-full max-w-md">
          <div className="bg-white shadow-md rounded-lg px-8 pt-6 pb-8 mb-4 text-center">
            <div className="flex justify-center mb-6">
              <Mail className="h-16 w-16 text-emerald-500" />
            </div>

            <h2 className="text-2xl font-bold mb-4 text-gray-800">
              Check Your Email
            </h2>

            <p className="text-gray-600 mb-6">
              We've sent a confirmation link to{" "}
              <span className="font-semibold">{email}</span>. Please check your
              inbox and click the link to confirm your account.
            </p>

            <div className="text-sm text-gray-500">
              <p>Didn't receive the email?</p>
              <ul className="mt-2 space-y-1">
                <li>• Check your spam folder</li>
                <li>• Make sure the email address is correct</li>
                <li>• Wait a few minutes and try again</li>
              </ul>
            </div>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
};

export default EmailConfirmationPage;
