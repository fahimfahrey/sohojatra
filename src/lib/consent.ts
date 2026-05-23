/**
 * Privacy consent helpers.
 *
 * Tracks two independent consent grants:
 *   - cookies  (analytics + non-essential storage)
 *   - location (browser geolocation API access)
 *
 * Stored in localStorage so server-rendered pages don't see the value and we
 * never set tracking cookies before the user opts in. A 1-year expiry mirrors
 * the GDPR guidance that cookie consent be re-confirmed annually.
 */

export type ConsentDecision = "granted" | "denied";

export interface ConsentRecord {
  decision: ConsentDecision;
  timestamp: number;
  version: number;
}

export const CONSENT_VERSION = 1;
export const CONSENT_TTL_MS = 365 * 24 * 60 * 60 * 1000;

const COOKIE_KEY = "sohojatra.consent.cookies";
const LOCATION_KEY = "sohojatra.consent.location";

function readKey(key: string): ConsentRecord | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ConsentRecord;
    if (parsed.version !== CONSENT_VERSION) return null;
    if (Date.now() - parsed.timestamp > CONSENT_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeKey(key: string, decision: ConsentDecision): void {
  if (typeof window === "undefined") return;
  const record: ConsentRecord = {
    decision,
    timestamp: Date.now(),
    version: CONSENT_VERSION,
  };
  window.localStorage.setItem(key, JSON.stringify(record));
  window.dispatchEvent(new CustomEvent("consent:change", { detail: { key, record } }));
}

function clearKey(key: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(key);
  window.dispatchEvent(new CustomEvent("consent:change", { detail: { key, record: null } }));
}

export const cookieConsent = {
  get: () => readKey(COOKIE_KEY),
  set: (d: ConsentDecision) => writeKey(COOKIE_KEY, d),
  clear: () => clearKey(COOKIE_KEY),
  granted: () => readKey(COOKIE_KEY)?.decision === "granted",
};

export const locationConsent = {
  get: () => readKey(LOCATION_KEY),
  set: (d: ConsentDecision) => writeKey(LOCATION_KEY, d),
  clear: () => clearKey(LOCATION_KEY),
  granted: () => readKey(LOCATION_KEY)?.decision === "granted",
  decided: () => readKey(LOCATION_KEY) !== null,
};

export function onConsentChange(handler: (e: CustomEvent) => void): () => void {
  if (typeof window === "undefined") return () => {};
  const wrapped = (ev: Event) => handler(ev as CustomEvent);
  window.addEventListener("consent:change", wrapped);
  return () => window.removeEventListener("consent:change", wrapped);
}

const PENDING_LOCATION_REQUESTS: Array<(d: ConsentDecision) => void> = [];

/**
 * Resolve the user's location-consent decision. If already decided, returns
 * immediately. Otherwise dispatches a `consent:request-location` event so the
 * LocationConsentPrompt modal can render, then resolves once the user picks.
 */
export function requestLocationConsent(): Promise<ConsentDecision> {
  if (typeof window === "undefined") return Promise.resolve("denied");
  const existing = locationConsent.get();
  if (existing) return Promise.resolve(existing.decision);

  return new Promise((resolve) => {
    PENDING_LOCATION_REQUESTS.push(resolve);
    window.dispatchEvent(new CustomEvent("consent:request-location"));
  });
}

export function resolvePendingLocationConsent(decision: ConsentDecision): void {
  locationConsent.set(decision);
  while (PENDING_LOCATION_REQUESTS.length > 0) {
    const resolve = PENDING_LOCATION_REQUESTS.shift();
    resolve?.(decision);
  }
}
