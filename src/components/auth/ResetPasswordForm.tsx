"use client";

import { useActionState, useState } from "react";
import { Lock, Eye, EyeOff, Check } from "lucide-react";
import { confirmPasswordResetAction } from "@/app/actions/auth";
import type { ActionResult } from "@/lib/validation/schemas";

const initialState: ActionResult | null = null;

export default function ResetPasswordForm() {
  const [state, formAction, pending] = useActionState(
    confirmPasswordResetAction,
    initialState,
  );
  const [showPassword, setShowPassword] = useState(false);

  return (
    <div className="w-full max-w-md mx-auto">
      <div className="bg-white shadow-large rounded-3xl px-6 sm:px-8 pt-8 pb-8 border border-gray-100">
        <h2 className="text-2xl sm:text-3xl font-bold mb-2 text-center text-gray-900">
          Set a new password
        </h2>
        <p className="text-sm text-gray-600 text-center mb-6">
          Must be at least 8 characters.
        </p>

        <form action={formAction} className="space-y-5">
          {state && !state.success && (
            <p
              className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-3"
              role="alert"
            >
              {state.error}
            </p>
          )}

          <div>
            <label
              className="block text-gray-700 text-sm font-semibold mb-2"
              htmlFor="password"
            >
              New password
            </label>
            <div className="relative">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
              <input
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                required
                minLength={8}
                maxLength={128}
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
            <Check className="h-5 w-5" />
            {pending ? "Updating…" : "Update password"}
          </button>
        </form>
      </div>
    </div>
  );
}
