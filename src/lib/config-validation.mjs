// Runtime configuration validator. Plain ESM so both the CLI
// (scripts/validate-config.mjs) and Next.js instrumentation can consume it
// without a TS loader.

const REQUIRED_ALWAYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "NEXT_PUBLIC_SITE_URL",
  "NEXT_PUBLIC_REALTIME_ENCRYPTION_SECRET",
  "ABLY_API_KEY",
];

const REQUIRED_PRODUCTION = [
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "NEXT_PUBLIC_SENTRY_DSN",
  "SENTRY_DSN",
];

const JWT_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

function isProduction() {
  return (
    process.env.NODE_ENV === "production" ||
    process.env.VERCEL_ENV === "production"
  );
}

function ok(name, message) {
  return { name, ok: true, ...(message ? { message } : {}) };
}
function fail(name, message) {
  return { name, ok: false, message };
}

function checkRequiredVars() {
  const required = isProduction()
    ? [...REQUIRED_ALWAYS, ...REQUIRED_PRODUCTION]
    : REQUIRED_ALWAYS;
  const missing = required.filter((k) => {
    const v = process.env[k];
    return v === undefined || v === "";
  });
  if (missing.length === 0) return ok("required-env-vars");
  return fail("required-env-vars", `missing: ${missing.join(", ")}`);
}

function checkUrlShapes() {
  const urls = {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
  };
  const bad = [];
  for (const [name, val] of Object.entries(urls)) {
    if (!val) continue;
    try {
      const u = new URL(val);
      if (u.protocol !== "https:" && u.protocol !== "http:") {
        bad.push(`${name}: unsupported protocol ${u.protocol}`);
      }
      if (
        name === "NEXT_PUBLIC_SUPABASE_URL" &&
        isProduction() &&
        u.protocol !== "https:"
      ) {
        bad.push(`${name}: must be https in production`);
      }
    } catch {
      bad.push(`${name}: not a valid URL`);
    }
  }
  if (bad.length) return fail("url-shapes", bad.join("; "));
  return ok("url-shapes");
}

function checkAnonKeyShape() {
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!key) return fail("anon-key-shape", "missing");
  if (!JWT_RE.test(key)) return fail("anon-key-shape", "not a JWT");
  try {
    const payload = JSON.parse(
      Buffer.from(key.split(".")[1], "base64url").toString("utf8"),
    );
    if (payload.role !== "anon") {
      return fail(
        "anon-key-shape",
        `JWT role is '${payload.role}', expected 'anon' — wrong key in this slot`,
      );
    }
    if (payload.exp && payload.exp * 1000 < Date.now()) {
      return fail("anon-key-shape", "JWT expired");
    }
  } catch (err) {
    return fail("anon-key-shape", `cannot decode JWT payload: ${err.message}`);
  }
  return ok("anon-key-shape");
}

function checkSiteUrlMatchesDeployment() {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (!siteUrl) return fail("site-url-match", "NEXT_PUBLIC_SITE_URL unset");
  if (process.env.VERCEL_ENV !== "production") {
    return ok("site-url-match", "skipped (non-prod)");
  }
  const expected =
    process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  if (!expected) return ok("site-url-match", "no Vercel domain hint");
  let host;
  try {
    host = new URL(siteUrl).host;
  } catch {
    return fail("site-url-match", "NEXT_PUBLIC_SITE_URL malformed");
  }
  if (host === expected) return ok("site-url-match");
  return fail(
    "site-url-match",
    `host '${host}' != deployment host '${expected}'`,
  );
}

async function fetchWithTimeout(url, init, ms = 5000) {
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(t);
  }
}

async function checkSupabaseReachable() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return fail("supabase-reachable", "missing URL or key");
  try {
    const res = await fetchWithTimeout(`${url}/auth/v1/health`, {
      headers: { apikey: key },
    });
    if (!res.ok) {
      return fail(
        "supabase-reachable",
        `auth health returned ${res.status}`,
      );
    }
    return ok("supabase-reachable");
  } catch (err) {
    return fail("supabase-reachable", err.message || String(err));
  }
}

async function checkSupabaseKeyAuthorized() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return fail("supabase-key-authorized", "missing URL or key");
  // PostgREST `/rest/v1/` root is service_role-only, so it 401s even for valid
  // anon keys. Probe a nonexistent RPC instead: a valid anon key gets a 404
  // PGRST202 from the schema lookup, an invalid key gets 401 from auth.
  try {
    const res = await fetchWithTimeout(
      `${url}/rest/v1/rpc/__validator_probe_nonexistent__`,
      {
        method: "POST",
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
        },
        body: "{}",
      },
    );
    if (res.status === 401 || res.status === 403) {
      return fail(
        "supabase-key-authorized",
        `PostgREST rejected key (${res.status}) — wrong project or revoked`,
      );
    }
    if (res.status !== 404 && !res.ok) {
      return fail(
        "supabase-key-authorized",
        `unexpected status ${res.status}`,
      );
    }
    return ok("supabase-key-authorized");
  } catch (err) {
    return fail("supabase-key-authorized", err.message || String(err));
  }
}

export async function validateConfig({ checkConnections = true } = {}) {
  const checks = [];
  checks.push(checkRequiredVars());
  checks.push(checkUrlShapes());
  checks.push(checkAnonKeyShape());
  checks.push(checkSiteUrlMatchesDeployment());

  const presenceOk = checks.every((c) => c.ok);
  if (presenceOk && checkConnections) {
    checks.push(await checkSupabaseReachable());
    checks.push(await checkSupabaseKeyAuthorized());
  }

  return { ok: checks.every((c) => c.ok), checks };
}

export function formatReport(report) {
  return report.checks
    .map((c) => {
      const mark = c.ok ? "[ok]" : "[FAIL]";
      const msg = c.message ? ` — ${c.message}` : "";
      return `  ${mark} ${c.name}${msg}`;
    })
    .join("\n");
}
