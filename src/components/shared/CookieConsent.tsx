"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Cookie, X } from "lucide-react";
import { cookieConsent } from "@/lib/consent";

export function CookieConsent() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (cookieConsent.get() === null) {
      setVisible(true);
    }
  }, []);

  if (!visible) return null;

  const accept = () => {
    cookieConsent.set("granted");
    setVisible(false);
  };

  const reject = () => {
    cookieConsent.set("denied");
    setVisible(false);
  };

  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label="Cookie consent"
      className="fixed bottom-0 inset-x-0 z-[60] p-4 sm:p-6"
    >
      <div className="mx-auto max-w-3xl bg-white dark:bg-gray-900 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 p-5 sm:p-6">
        <div className="flex items-start gap-4">
          <div className="hidden sm:flex shrink-0 w-10 h-10 rounded-full bg-amber-100 items-center justify-center">
            <Cookie className="w-5 h-5 text-amber-600" aria-hidden="true" />
          </div>
          <div className="flex-1">
            <h2 className="text-base sm:text-lg font-semibold text-gray-900 dark:text-gray-100">
              We value your privacy
            </h2>
            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
              Sohojatra uses essential cookies to keep you signed in. With your
              consent we also use optional analytics cookies to understand how
              the service is used. You can change this anytime in your browser.
              See our{" "}
              <Link href="/privacy" className="underline font-medium">
                Privacy Policy
              </Link>{" "}
              and{" "}
              <Link href="/terms" className="underline font-medium">
                Terms
              </Link>
              .
            </p>
            <div className="mt-4 flex flex-col-reverse sm:flex-row sm:items-center gap-2 sm:gap-3">
              <button
                type="button"
                onClick={reject}
                className="px-4 py-2 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700"
              >
                Reject non-essential
              </button>
              <button
                type="button"
                onClick={accept}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700"
              >
                Accept all
              </button>
            </div>
          </div>
          <button
            type="button"
            onClick={reject}
            aria-label="Dismiss and reject non-essential cookies"
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
}
