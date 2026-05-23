import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { validateConfig, formatReport } = await import(
      "./src/lib/config-validation.mjs"
    );
    // Skip network checks during `next build` — keys may not be live yet and
    // the build environment shouldn't depend on Supabase reachability.
    const isBuild = process.env.NEXT_PHASE === "phase-production-build";
    const report = await validateConfig({ checkConnections: !isBuild });
    console.log("Config validation:\n" + formatReport(report));
    if (!report.ok) {
      console.error("Configuration invalid. Aborting startup.");
      process.exit(1);
    }

    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
