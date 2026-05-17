"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { Mail, Lock, User, UserPlus } from "lucide-react";
import { signUpAction, signInWithGoogleAction } from "@/app/actions/auth";
import type { ActionResult } from "@/lib/validation/schemas";

const initialState: ActionResult | null = null;

export default function RegisterForm() {
  const [state, formAction, pending] = useActionState(signUpAction, initialState);
  const [confirmPassword, setConfirmPassword] = useState("");
  const [clientError, setClientError] = useState<string | null>(null);

  const onSubmit = (formData: FormData) => {
    const password = String(formData.get("password") ?? "");
    if (password !== confirmPassword) {
      setClientError("Passwords do not match");
      return;
    }
    setClientError(null);
    formAction(formData);
  };

  return (
    <div className="flex w-full items-center justify-center py-10 sm:py-12 px-4">
      <div className="max-w-md w-full">
        <div className="text-center mb-6">
          <h2 className="text-3xl sm:text-4xl font-bold text-gray-900 mb-2">
            Create Account
          </h2>
          <p className="text-gray-600">Join our community today</p>
        </div>

        <div className="bg-white shadow-xl rounded-2xl p-6 sm:p-8 border border-gray-100">
          <form action={signInWithGoogleAction} className="mb-6">
            <button
              type="submit"
              className="w-full flex items-center justify-center gap-3 py-3 border border-gray-200 rounded-2xl hover:bg-gray-50 font-semibold"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                alt=""
                src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg"
                className="h-5 w-5"
              />
              Continue with Google
            </button>
          </form>

          <div className="flex items-center my-6">
            <div className="flex-1 h-px bg-gray-200" />
            <span className="px-3 text-xs text-gray-400 uppercase">or</span>
            <div className="flex-1 h-px bg-gray-200" />
          </div>

          <form action={onSubmit} className="space-y-5">
            {(clientError || (state && !state.success)) && (
              <p
                className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-3"
                role="alert"
              >
                {clientError ??
                  (state && !state.success ? state.error : undefined)}
              </p>
            )}

            <div>
              <label
                htmlFor="name"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Full Name
              </label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                <input
                  id="name"
                  name="name"
                  required
                  minLength={2}
                  className="w-full pl-10 py-3 border border-gray-200 rounded-xl"
                  placeholder="Your name"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="email"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Email
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                <input
                  id="email"
                  name="email"
                  type="email"
                  required
                  className="w-full pl-10 py-3 border border-gray-200 rounded-xl"
                  placeholder="you@example.com"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                <input
                  id="password"
                  name="password"
                  type="password"
                  required
                  minLength={8}
                  className="w-full pl-10 py-3 border border-gray-200 rounded-xl"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="confirmPassword"
                className="block text-sm font-medium text-gray-700 mb-1"
              >
                Confirm Password
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                <input
                  id="confirmPassword"
                  type="password"
                  required
                  minLength={8}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full pl-10 py-3 border border-gray-200 rounded-xl"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={pending}
              className="w-full py-3 rounded-xl text-white font-semibold bg-gradient-to-r from-accent-400 to-accent-500 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <UserPlus className="h-5 w-5" />
              {pending ? "Creating account…" : "Sign up"}
            </button>
          </form>

          <p className="text-center mt-6 text-sm text-gray-600">
            Already have an account?{" "}
            <Link href="/login" className="font-semibold text-accent-600">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
