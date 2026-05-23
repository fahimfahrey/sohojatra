"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Mail, Send } from "lucide-react";
import { requestPasswordResetAction } from "@/app/actions/auth";
import type { ActionResult } from "@/lib/validation/schemas";

const initialState: ActionResult | null = null;

export default function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState(
    requestPasswordResetAction,
    initialState,
  );

  return (
    <div className="w-full max-w-md mx-auto">
      <div className="bg-white shadow-large rounded-3xl px-6 sm:px-8 pt-8 pb-8 border border-gray-100">
        <h2 className="text-2xl sm:text-3xl font-bold mb-2 text-center text-gray-900">
          Forgot your password?
        </h2>
        <p className="text-sm text-gray-600 text-center mb-6">
          Enter your email and we&apos;ll send a reset link.
        </p>

        {state?.success && (
          <p
            className="text-sm text-emerald-700 bg-emerald-50 rounded-xl px-4 py-3 mb-4"
            role="status"
          >
            If an account exists for that address, we&apos;ve sent a reset
            link. Check your inbox.
          </p>
        )}

        <form action={formAction} className="space-y-5">
          <div>
            <label
              className="block text-gray-700 text-sm font-semibold mb-2"
              htmlFor="email"
            >
              Email
            </label>
            <div className="relative">
              <Mail className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
              <input
                id="email"
                name="email"
                type="email"
                required
                className="w-full py-3.5 pl-12 pr-4 border border-gray-200 rounded-2xl bg-gray-50 focus:bg-white focus:ring-2 focus:ring-accent-400"
                placeholder="you@example.com"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={pending}
            className="w-full py-3.5 rounded-2xl text-white font-semibold bg-gradient-to-r from-accent-400 to-accent-500 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <Send className="h-5 w-5" />
            {pending ? "Sending…" : "Send reset link"}
          </button>
        </form>

        <p className="text-center mt-6 text-sm text-gray-600">
          Remembered it?{" "}
          <Link
            href="/login"
            className="font-semibold text-accent-600 hover:text-accent-500"
          >
            Back to sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
