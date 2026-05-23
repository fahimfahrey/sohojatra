"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { MapPin } from "lucide-react";
import { resolvePendingLocationConsent } from "@/lib/consent";

export function LocationConsentPrompt() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener("consent:request-location", handler);
    return () => window.removeEventListener("consent:request-location", handler);
  }, []);

  if (!open) return null;

  const decide = (granted: boolean) => {
    resolvePendingLocationConsent(granted ? "granted" : "denied");
    setOpen(false);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="location-consent-title"
      className="fixed inset-0 z-[70] bg-black/50 flex items-center justify-center p-4"
    >
      <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl max-w-md w-full p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center">
            <MapPin className="w-5 h-5 text-blue-600" aria-hidden="true" />
          </div>
          <h2
            id="location-consent-title"
            className="text-lg font-semibold text-gray-900 dark:text-gray-100"
          >
            Use your location?
          </h2>
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
          Sohojatra would like to access your device location to suggest nearby
          pickup points and improve route matching. We never share precise
          location with other riders until you join a ride. You can revoke
          consent anytime from your browser settings. See our{" "}
          <Link href="/privacy" className="underline font-medium">
            Privacy Policy
          </Link>
          .
        </p>
        <div className="mt-6 flex flex-col-reverse sm:flex-row sm:justify-end gap-2 sm:gap-3">
          <button
            type="button"
            onClick={() => decide(false)}
            className="px-4 py-2 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-200 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700"
          >
            Not now
          </button>
          <button
            type="button"
            onClick={() => decide(true)}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700"
          >
            Allow location
          </button>
        </div>
      </div>
    </div>
  );
}
