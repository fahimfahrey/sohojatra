"use client";

import { useActionState } from "react";
import Link from "next/link";
import { KeyRound } from "lucide-react";
import { submitTotpRecoveryAction } from "@/app/actions/totp";
import type { ActionResult } from "@/lib/validation/schemas";

const initialState: ActionResult | null = null;

export default function TotpRecoveryForm({
  next,
  csrfToken,
}: {
  next?: string;
  csrfToken: string;
}) {
  const [state, formAction, pending] = useActionState(
    submitTotpRecoveryAction,
    initialState,
  );

  return (
    <div className="w-full max-w-md mx-auto bg-white shadow-large rounded-3xl px-6 sm:px-8 py-8 border border-gray-100">
      <div className="flex flex-col items-center mb-6">
        <div className="h-12 w-12 rounded-2xl bg-accent-100 flex items-center justify-center mb-3">
          <KeyRound className="h-6 w-6 text-accent-600" aria-hidden />
        </div>
        <h1 className="text-2xl font-bold text-gray-900">
          Use a recovery code
        </h1>
        <p className="text-sm text-gray-600 mt-2 text-center">
          Enter one of the 8-character recovery codes you saved when you
          enabled two-factor authentication. Each code works once.
        </p>
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
            htmlFor="recovery-code"
            className="block text-gray-700 text-sm font-semibold mb-2"
          >
            Recovery code
          </label>
          <input
            id="recovery-code"
            name="code"
            type="text"
            autoComplete="off"
            maxLength={12}
            required
            autoFocus
            className="w-full py-3.5 px-4 border border-gray-200 rounded-2xl bg-gray-50 focus:bg-white focus:ring-2 focus:ring-accent-400 tracking-widest text-center font-mono"
            placeholder="XXXX-XXXX"
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

      <p className="text-center mt-6 text-sm text-gray-600">
        <Link
          href={`/2fa/challenge${next ? `?next=${encodeURIComponent(next)}` : ""}`}
          className="font-semibold text-accent-600 hover:text-accent-500"
        >
          Back to authenticator code
        </Link>
      </p>
    </div>
  );
}
