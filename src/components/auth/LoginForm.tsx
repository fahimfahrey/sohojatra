"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { Mail, Lock, LogIn, Eye, EyeOff } from "lucide-react";
import { signInAction, signInWithGoogleAction } from "@/app/actions/auth";
import type { ActionResult } from "@/lib/validation/schemas";

const initialState: ActionResult | null = null;

export default function LoginForm() {
  const [state, formAction, pending] = useActionState(signInAction, initialState);
  const [showPassword, setShowPassword] = useState(false);

  return (
    <div className="w-full max-w-md mx-auto">
      <div className="bg-white shadow-large rounded-3xl px-6 sm:px-8 pt-8 pb-8 border border-gray-100">
        <h2 className="text-2xl sm:text-3xl font-bold mb-6 text-center text-gray-900">
          Welcome back
        </h2>

        <form action={signInWithGoogleAction} className="mb-6">
          <button
            type="submit"
            className="w-full flex items-center justify-center gap-3 py-3 px-4 border border-gray-200 rounded-2xl bg-white hover:bg-gray-50 text-gray-700 font-semibold"
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

        <form action={formAction} className="space-y-5">
          {state && !state.success && (
            <p
              className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-3"
              role="alert"
            >
              {state && !state.success ? state.error : ""}
            </p>
          )}

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

          <div>
            <label
              className="block text-gray-700 text-sm font-semibold mb-2"
              htmlFor="password"
            >
              Password
            </label>
            <div className="relative">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
              <input
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                required
                minLength={8}
                className="w-full py-3.5 pl-12 pr-12 border border-gray-200 rounded-2xl bg-gray-50 focus:bg-white focus:ring-2 focus:ring-accent-400"
                placeholder="••••••••"
              />
              <button
                type="button"
                className="absolute right-4 top-1/2 -translate-y-1/2"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? (
                  <EyeOff className="h-5 w-5 text-gray-400" />
                ) : (
                  <Eye className="h-5 w-5 text-gray-400" />
                )}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={pending}
            className="w-full py-3.5 rounded-2xl text-white font-semibold bg-gradient-to-r from-accent-400 to-accent-500 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <LogIn className="h-5 w-5" />
            {pending ? "Signing in…" : "Sign in"}
          </button>
        </form>

        <p className="text-center mt-6 text-sm text-gray-600">
          Don&apos;t have an account?{" "}
          <Link
            href="/register"
            className="font-semibold text-accent-600 hover:text-accent-500"
          >
            Sign up
          </Link>
        </p>
      </div>
    </div>
  );
}
