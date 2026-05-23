"use client";

import { useActionState, useState } from "react";
import { Loader2, ShieldCheck, Copy, Check } from "lucide-react";
import { confirmTotpEnrollmentAction } from "@/app/actions/totp";
import type { ActionResult } from "@/lib/validation/schemas";

const confirmInitial: ActionResult<{ recoveryCodes: string[] }> | null = null;

export default function TotpEnrollForm({
  csrfToken,
  qrDataUri,
  otpauthUri,
  secretFormatted,
}: {
  csrfToken: string;
  qrDataUri: string;
  otpauthUri: string;
  secretFormatted: string;
}) {
  const [confirmState, confirmAction, pending] = useActionState(
    confirmTotpEnrollmentAction,
    confirmInitial,
  );
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(secretFormatted.replace(/\s/g, ""));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard may be unavailable; user can copy manually */
    }
  };

  if (confirmState?.success && confirmState.data?.recoveryCodes) {
    return <RecoveryCodes codes={confirmState.data.recoveryCodes} />;
  }

  return (
    <div className="w-full max-w-md mx-auto bg-white shadow-large rounded-3xl px-6 sm:px-8 py-8 border border-gray-100">
      <div className="flex flex-col items-center mb-6">
        <div className="h-12 w-12 rounded-2xl bg-accent-100 flex items-center justify-center mb-3">
          <ShieldCheck className="h-6 w-6 text-accent-600" aria-hidden />
        </div>
        <h1 className="text-2xl font-bold text-gray-900 text-center">
          Enable two-factor authentication
        </h1>
        <p className="text-sm text-gray-600 mt-2 text-center">
          Scan the QR code with your authenticator app, then enter the 6-digit
          code it generates to finish setup.
        </p>
      </div>

      <div className="flex justify-center mb-4">
        <img
          alt="Two-factor authentication QR code"
          src={qrDataUri}
          width={208}
          height={208}
          className="rounded-xl border border-gray-200"
        />
      </div>

      <details className="mb-6 text-sm text-gray-600">
        <summary className="cursor-pointer font-medium text-gray-700">
          Can&apos;t scan? Enter this code manually
        </summary>
        <div className="mt-2 flex items-center gap-2">
          <code className="flex-1 break-all rounded-lg bg-gray-50 border border-gray-200 px-3 py-2 font-mono text-xs">
            {secretFormatted}
          </code>
          <button
            type="button"
            onClick={onCopy}
            className="px-3 py-2 rounded-lg border border-gray-200 hover:bg-gray-50 inline-flex items-center gap-1 text-xs"
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5" />
                Copied
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" />
                Copy
              </>
            )}
          </button>
        </div>
        <a
          href={otpauthUri}
          className="mt-2 inline-block text-accent-600 hover:text-accent-500 text-xs"
        >
          Open in authenticator app
        </a>
      </details>

      <form action={confirmAction} className="space-y-5">
        <input type="hidden" name="csrfToken" value={csrfToken} />

        {confirmState && !confirmState.success ? (
          <p
            className="text-sm text-red-600 bg-red-50 rounded-xl px-4 py-3"
            role="alert"
          >
            {confirmState.error}
          </p>
        ) : null}

        <div>
          <label
            htmlFor="enroll-code"
            className="block text-gray-700 text-sm font-semibold mb-2"
          >
            Enter the 6-digit code from your app
          </label>
          <input
            id="enroll-code"
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
          className="w-full py-3.5 rounded-2xl text-white font-semibold bg-gradient-to-r from-accent-400 to-accent-500 disabled:opacity-50 inline-flex items-center justify-center gap-2"
        >
          {pending ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Confirming…
            </>
          ) : (
            "Confirm and enable"
          )}
        </button>
      </form>
    </div>
  );
}

function RecoveryCodes({ codes }: { codes: string[] }) {
  const [copied, setCopied] = useState(false);
  const text = codes.join("\n");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  const download = () => {
    const blob = new Blob(
      [
        `Sohojatra recovery codes\n\nEach code works once. Keep them somewhere safe.\n\n${text}\n`,
      ],
      { type: "text/plain" },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "sohojatra-recovery-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="w-full max-w-md mx-auto bg-white shadow-large rounded-3xl px-6 sm:px-8 py-8 border border-gray-100">
      <h1 className="text-2xl font-bold text-gray-900 text-center mb-2">
        Save your recovery codes
      </h1>
      <p className="text-sm text-gray-600 text-center mb-6">
        We won&apos;t show these again. Each code lets you sign in once if you
        lose your authenticator. Store them somewhere safe.
      </p>

      <ul className="grid grid-cols-2 gap-2 mb-6 font-mono text-sm">
        {codes.map((c) => (
          <li
            key={c}
            className="rounded-lg bg-gray-50 border border-gray-200 px-3 py-2 text-center"
          >
            {c}
          </li>
        ))}
      </ul>

      <div className="flex gap-2 mb-4">
        <button
          type="button"
          onClick={copy}
          className="flex-1 py-2.5 px-4 rounded-xl border border-gray-200 hover:bg-gray-50 text-sm font-semibold inline-flex items-center justify-center gap-2"
        >
          {copied ? (
            <>
              <Check className="h-4 w-4" />
              Copied
            </>
          ) : (
            <>
              <Copy className="h-4 w-4" />
              Copy
            </>
          )}
        </button>
        <button
          type="button"
          onClick={download}
          className="flex-1 py-2.5 px-4 rounded-xl border border-gray-200 hover:bg-gray-50 text-sm font-semibold"
        >
          Download .txt
        </button>
      </div>

      <a
        href="/dashboard"
        className="block w-full text-center py-3 rounded-xl bg-gradient-to-r from-accent-400 to-accent-500 text-white font-semibold"
      >
        Continue to dashboard
      </a>
    </div>
  );
}
