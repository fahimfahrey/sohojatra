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
  webpack: (config, { isServer }) => {
    // Prevent node:crypto from being bundled in client code
    if (!isServer) {
      config.resolve.alias = {
        ...config.resolve.alias,
        "node:crypto": false,
      };
    }
    return config;
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
  sourcemaps: { disable: sentryDisabled },
  telemetry: false,
});
