"use client";

import { useEffect, useState } from "react";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { cookieConsent, onConsentChange } from "@/lib/consent";

export function ConsentGatedAnalytics() {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    setEnabled(cookieConsent.granted());
    const off = onConsentChange(() => setEnabled(cookieConsent.granted()));
    return off;
  }, []);

  if (!enabled) return null;
  return (
    <>
      <Analytics />
      <SpeedInsights />
    </>
  );
}
