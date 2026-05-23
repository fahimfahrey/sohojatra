"use client";

import { useActionState, useState } from "react";
import { ShieldOff } from "lucide-react";
import { disableTotpAction } from "@/app/actions/totp";
import type { ActionResult } from "@/lib/validation/schemas";

const initialState: ActionResult | null = null;

export default function TotpDisableForm({ csrfToken }: { csrfToken: string }) {
  const [state, formAction, pending] = useActionState(
    disableTotpAction,
    initialState,
  );
  const [confirming, setConfirming] = useState(false);

  if (state?.success) {
    return (
      <p className="text-sm text-gray-700 bg-green-50 rounded-xl px-4 py-3">
        Two-factor authentication is now disabled.
      </p>
    );
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-red-200 text-red-700 hover:bg-red-50 text-sm font-semibold"
      >
        <ShieldOff className="h-4 w-4" />
        Disable two-factor authentication
      </button>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="csrfToken" value={csrfToken} />
      <p className="text-sm text-gray-700">
        Confirm with your password and an authenticator code to disable 2FA.
      </p>

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
          htmlFor="disable-password"
          className="block text-gray-700 text-sm font-semibold mb-2"
        >
          Password
        </label>
        <input
          id="disable-password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="w-full py-3 px-4 border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:ring-2 focus:ring-accent-400"
        />
      </div>

      <div>
        <label
          htmlFor="disable-code"
          className="block text-gray-700 text-sm font-semibold mb-2"
        >
          6-digit code
        </label>
        <input
          id="disable-code"
          name="code"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          required
          className="w-full py-3 px-4 border border-gray-200 rounded-xl bg-gray-50 focus:bg-white focus:ring-2 focus:ring-accent-400 tracking-widest font-mono text-center"
          placeholder="123456"
        />
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="px-4 py-2.5 rounded-xl border border-gray-200 hover:bg-gray-50 text-sm font-semibold"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={pending}
          className="flex-1 px-4 py-2.5 rounded-xl bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 text-sm font-semibold"
        >
          {pending ? "Disabling…" : "Disable two-factor authentication"}
        </button>
      </div>
    </form>
  );
}
