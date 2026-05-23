"use client";

import { useActionState } from "react";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import {
  submitTotpChallengeAction,
  submitTotpStepUpAction,
} from "@/app/actions/totp";
import type { ActionResult } from "@/lib/validation/schemas";

type Mode = "challenge" | "stepup";

const initialState: ActionResult | null = null;

export default function TotpChallengeForm({
  mode,
  next,
  csrfToken,
}: {
  mode: Mode;
  next?: string;
  csrfToken: string;
}) {
  const action =
    mode === "stepup" ? submitTotpStepUpAction : submitTotpChallengeAction;
  const [state, formAction, pending] = useActionState(action, initialState);

  const title =
    mode === "stepup"
      ? "Confirm with your authenticator"
      : "Two-factor authentication";
  const subtitle =
    mode === "stepup"
      ? "Re-enter a code from your authenticator app to continue this action."
      : "Enter the 6-digit code from your authenticator app to finish signing in.";

  return (
    <div className="w-full max-w-md mx-auto bg-white shadow-large rounded-3xl px-6 sm:px-8 py-8 border border-gray-100">
      <div className="flex flex-col items-center mb-6">
        <div className="h-12 w-12 rounded-2xl bg-accent-100 flex items-center justify-center mb-3">
          <ShieldCheck className="h-6 w-6 text-accent-600" aria-hidden />
        </div>
        <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
        <p className="text-sm text-gray-600 mt-2 text-center">{subtitle}</p>
      </div>

      <form action={formAction} className="space-y-5">
        <input type="hidden" name="csrfToken" value={csrfToken} />
        {next ? <input type="hidden" name="next" value={next} /> : null}

        {state && !state.success ? (
          <p
            className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-3"
            role="alert"
          >
            {state.error}
          </p>
        ) : null}

        <div>
          <label
            htmlFor="totp-code"
            className="block text-gray-700 text-sm font-semibold mb-2"
          >
            6-digit code
          </label>
          <input
            id="totp-code"
            name="code"
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            required
            autoFocus
            className="w-full py-3.5 px-4 border border-gray-200 rounded-2xl bg-gray-50 focus:bg-white focus:ring-2 focus:ring-accent-400 tracking-[0.5em] text-center text-xl font-mono"
            placeholder="123456"
          />
        </div>

        <button
          type="submit"
          disabled={pending}
          className="w-full py-3.5 rounded-2xl text-white font-semibold bg-gradient-to-r from-accent-400 to-accent-500 disabled:opacity-50"
        >
          {pending ? "Verifying…" : "Verify"}
        </button>
      </form>

      {mode === "challenge" ? (
        <p className="text-center mt-6 text-sm text-gray-600">
          Lost your authenticator?{" "}
          <Link
            href={`/2fa/recovery${next ? `?next=${encodeURIComponent(next)}` : ""}`}
            className="font-semibold text-accent-600 hover:text-accent-500"
          >
            Use a recovery code
          </Link>
        </p>
      ) : null}
    </div>
  );
}
