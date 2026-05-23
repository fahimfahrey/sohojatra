"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    Sentry.captureException(error, {
      tags: { severity: "critical", scope: "global-error" },
    });
  }, [error]);

  return (
    <html lang="en">
      <body>
        <div style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>
          <h1 style={{ fontSize: 20, marginBottom: 8 }}>Something went wrong</h1>
          <p style={{ color: "#555", marginBottom: 16 }}>
            We logged the issue. Please refresh or try again shortly.
          </p>
          {error.digest ? (
            <code style={{ fontSize: 12, color: "#888" }}>
              Reference: {error.digest}
            </code>
          ) : null}
        </div>
      </body>
    </html>
  );
}
