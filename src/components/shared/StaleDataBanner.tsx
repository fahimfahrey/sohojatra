"use client";

import React from "react";
import { AlertTriangle } from "lucide-react";
import { useRide } from "@/contexts/RideContext";
import { useNotification } from "@/contexts/NotificationContext";
import { useAbly } from "@/contexts/AblyContext";

/**
 * Renders a warning banner when the app is serving cached data because an
 * upstream (Supabase) is failing, or when realtime sync is degraded to
 * polling because Ably is unreachable.
 */
export function StaleDataBanner() {
  const { stale: ridesStale } = useRide();
  const { stale: notifsStale } = useNotification();
  const { connectionMode } = useAbly();

  const dataStale = ridesStale || notifsStale;
  const polling = connectionMode === "polling";

  if (!dataStale && !polling) return null;

  const message = dataStale
    ? "Connection issues — showing cached data. Some actions may be unavailable."
    : "Live sync unavailable — updates may be delayed.";

  return (
    <div
      role="status"
      aria-live="polite"
      className="bg-amber-50 border-b border-amber-200 text-amber-900 text-sm px-4 py-2 flex items-center gap-2"
    >
      <AlertTriangle className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}
