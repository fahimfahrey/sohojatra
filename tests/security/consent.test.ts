/**
 * Privacy consent gates. Location reads must refuse to fire unless an in-app
 * decision is recorded; cookie consent must persist across reads and respect
 * the schema version + TTL.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

class MemoryStorage implements Storage {
  private store = new Map<string, string>();
  get length() {
    return this.store.size;
  }
  clear() {
    this.store.clear();
  }
  getItem(key: string) {
    return this.store.get(key) ?? null;
  }
  key(i: number) {
    return Array.from(this.store.keys())[i] ?? null;
  }
  removeItem(key: string) {
    this.store.delete(key);
  }
  setItem(key: string, value: string) {
    this.store.set(key, value);
  }
}

const storage = new MemoryStorage();

vi.stubGlobal("window", {
  localStorage: storage,
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => true,
});
vi.stubGlobal("CustomEvent", class {
  constructor(_t: string, _i?: unknown) {}
});

beforeEach(() => storage.clear());

describe("cookieConsent", () => {
  it("returns null when no decision recorded", async () => {
    const { cookieConsent } = await import("@/lib/consent");
    expect(cookieConsent.get()).toBeNull();
    expect(cookieConsent.granted()).toBe(false);
  });

  it("persists granted decision", async () => {
    const { cookieConsent } = await import("@/lib/consent");
    cookieConsent.set("granted");
    expect(cookieConsent.granted()).toBe(true);
    expect(cookieConsent.get()?.decision).toBe("granted");
  });

  it("treats denied as not granted but decided", async () => {
    const { cookieConsent } = await import("@/lib/consent");
    cookieConsent.set("denied");
    expect(cookieConsent.granted()).toBe(false);
    expect(cookieConsent.get()?.decision).toBe("denied");
  });

  it("ignores expired records", async () => {
    const { cookieConsent, CONSENT_VERSION, CONSENT_TTL_MS } = await import(
      "@/lib/consent"
    );
    storage.setItem(
      "sohojatra.consent.cookies",
      JSON.stringify({
        decision: "granted",
        timestamp: Date.now() - CONSENT_TTL_MS - 1000,
        version: CONSENT_VERSION,
      }),
    );
    expect(cookieConsent.get()).toBeNull();
  });

  it("ignores records from a different schema version", async () => {
    const { cookieConsent, CONSENT_VERSION } = await import("@/lib/consent");
    storage.setItem(
      "sohojatra.consent.cookies",
      JSON.stringify({
        decision: "granted",
        timestamp: Date.now(),
        version: CONSENT_VERSION + 99,
      }),
    );
    expect(cookieConsent.get()).toBeNull();
  });
});

describe("locationConsent", () => {
  it("starts undecided", async () => {
    const { locationConsent } = await import("@/lib/consent");
    expect(locationConsent.decided()).toBe(false);
    expect(locationConsent.granted()).toBe(false);
  });

  it("decided() reflects denied", async () => {
    const { locationConsent } = await import("@/lib/consent");
    locationConsent.set("denied");
    expect(locationConsent.decided()).toBe(true);
    expect(locationConsent.granted()).toBe(false);
  });
});
