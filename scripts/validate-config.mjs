#!/usr/bin/env node
// Validate runtime configuration before starting the server.
// Exits 1 if any required env var is missing, the deployment domain
// mismatches NEXT_PUBLIC_SITE_URL, or Supabase is unreachable.
//
//   node scripts/validate-config.mjs              # full check
//   node scripts/validate-config.mjs --offline    # skip network checks

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function loadEnvFile(path) {
  if (!existsSync(path)) return;
  for (const rawLine of readFileSync(path, "utf8").split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

// Only load local env files when not running on a managed platform that
// already injects them (Vercel sets VERCEL=1).
if (!process.env.VERCEL) {
  loadEnvFile(resolve(repoRoot, ".env.local"));
  loadEnvFile(resolve(repoRoot, ".env"));
}

const { validateConfig, formatReport } = await import(
  resolve(repoRoot, "src/lib/config-validation.mjs")
);

const offline = process.argv.includes("--offline");
const report = await validateConfig({ checkConnections: !offline });

console.log("Config validation:");
console.log(formatReport(report));

if (!report.ok) {
  console.error("\nConfiguration invalid. Refusing to start.");
  process.exit(1);
}
console.log("\nAll checks passed.");
