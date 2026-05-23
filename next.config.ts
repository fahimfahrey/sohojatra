import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { withSerwist } from "@serwist/turbopack";
import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "www.gstatic.com", pathname: "/**" },
    ],
  },
  async headers() {
    const IMMUTABLE = "public, max-age=31536000, immutable";
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=31536000; includeSubDomains; preload",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(self)",
          },
          {
            key: "Content-Security-Policy",
            value:
              "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; connect-src 'self' https: https://*.sentry.io https://*.ingest.sentry.io; worker-src 'self' blob:",
          },
          { key: "Cache-Control", value: "no-cache" },
        ],
      },
      {
        source: "/_next/static/:path*",
        headers: [{ key: "Cache-Control", value: IMMUTABLE }],
      },
      {
        source: "/_next/image(.*)",
        headers: [{ key: "Cache-Control", value: IMMUTABLE }],
      },
    ];
  },
};

const sentryDisabled =
  !process.env.SENTRY_AUTH_TOKEN || process.env.SENTRY_DISABLE_BUILD === "true";

export default withSentryConfig(withSerwist(nextConfig), {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  widenClientFileUpload: true,
  tunnelRoute: "/monitoring/sentry",
  disableLogger: true,
  automaticVercelMonitors: false,
  sourcemaps: { disable: sentryDisabled },
  telemetry: false,
});
