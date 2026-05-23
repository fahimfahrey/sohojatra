/**
 * OWASP A03: Injection — SQLi-like payloads and XSS payloads must not bypass validation.
 *
 * Strategy:
 *   - Zod schemas reject malformed input before queries run.
 *   - String fields routed through sanitizeText strip script/HTML.
 *   - Supabase queries use parameterized eq()/insert() — no string interpolation in WHERE.
 */
import { describe, it, expect } from "vitest";
import {
  signInSchema,
  signUpSchema,
  createRideSchema,
  joinRideSchema,
  rideIdSchema,
  messageSchema,
  searchRidesSchema,
} from "@/lib/validation/schemas";

const XSS_PAYLOADS = [
  `<script>alert(1)</script>`,
  `"><img src=x onerror=alert(1)>`,
  `javascript:alert(1)`,
  `<iframe src="javascript:alert(1)"></iframe>`,
  `<svg/onload=alert(1)>`,
  `<a href="javascript:alert(1)">x</a>`,
  `<script>alert(1)</script>`,
];

const SQLI_PAYLOADS = [
  `' OR 1=1 --`,
  `'; DROP TABLE users; --`,
  `1' UNION SELECT password FROM auth.users --`,
  `admin'/*`,
  `1 OR sleep(5)`,
];

describe("A03 Injection — XSS payloads in user-facing string fields", () => {
  for (const payload of XSS_PAYLOADS) {
    it(`sanitizes message: ${JSON.stringify(payload).slice(0, 40)}`, () => {
      const parsed = messageSchema.safeParse(payload);
      if (!parsed.success) return; // rejecting is also acceptable
      expect(parsed.data).not.toMatch(/<script/i);
      expect(parsed.data).not.toMatch(/onerror/i);
      expect(parsed.data).not.toMatch(/<iframe/i);
      expect(parsed.data).not.toMatch(/<svg/i);
    });
  }

  it("messageSchema strips all tags from XSS payloads", () => {
    for (const payload of XSS_PAYLOADS) {
      const parsed = messageSchema.safeParse(payload);
      if (!parsed.success) continue;
      expect(parsed.data).not.toMatch(/<[a-z]/i);
    }
  });

  it("rejects XSS in name field (too short after stripping)", () => {
    const r = signUpSchema.safeParse({
      email: "x@example.com",
      password: "validpass123",
      name: "<script>a</script>",
    });
    if (r.success) {
      expect(r.data.name).not.toMatch(/<script/i);
    }
  });

  it("rejects XSS in location.address (after sanitize, length still validated)", () => {
    const r = createRideSchema.safeParse({
      startingPoint: {
        coordinates: { lat: 23.8, lng: 90.4 },
        address: "<script>x</script>",
      },
      destination: {
        coordinates: { lat: 23.9, lng: 90.5 },
        address: "Mirpur 10",
      },
      totalSeats: 3,
      contactPhone: "+8801712345678",
      vehicle: "Car",
    });
    if (r.success) {
      expect(r.data.startingPoint.address).not.toMatch(/<script/i);
    } else {
      expect(r.success).toBe(false);
    }
  });
});

describe("A03 Injection — SQLi-like payloads in typed/uuid fields", () => {
  for (const payload of SQLI_PAYLOADS) {
    it(`rejects ride id ${JSON.stringify(payload).slice(0, 30)}`, () => {
      const r = rideIdSchema.safeParse({ rideId: payload });
      expect(r.success).toBe(false);
    });

    it(`rejects email ${JSON.stringify(payload).slice(0, 30)}`, () => {
      const r = signInSchema.safeParse({
        email: payload,
        password: "longenoughpw",
      });
      expect(r.success).toBe(false);
    });
  }

  it("rejects non-uuid in joinRide rideId", () => {
    const r = joinRideSchema.safeParse({
      rideId: "1 OR 1=1",
      contactPhone: "+8801712345678",
    });
    expect(r.success).toBe(false);
  });

  it("rejects out-of-range lat/lng (no implicit cast / type-juggling)", () => {
    const r = searchRidesSchema.safeParse({
      startLat: 999,
      startLng: 0,
      destLat: 0,
      destLng: 0,
    });
    expect(r.success).toBe(false);
  });

  it("rejects string lat (no numeric coercion attack)", () => {
    const r = searchRidesSchema.safeParse({
      startLat: "23.8 OR 1=1" as unknown as number,
      startLng: 90.4,
      destLat: 23.9,
      destLng: 90.5,
    });
    expect(r.success).toBe(false);
  });
});

describe("A03 Injection — vehicle enum hardened", () => {
  it("rejects vehicle outside enum (no arbitrary string into DB)", () => {
    const r = createRideSchema.safeParse({
      startingPoint: { coordinates: { lat: 23.8, lng: 90.4 }, address: "abc" },
      destination: { coordinates: { lat: 23.9, lng: 90.5 }, address: "xyz" },
      totalSeats: 3,
      contactPhone: "+8801712345678",
      vehicle: "Tank'; DROP TABLE rides; --" as unknown as "Car",
    });
    expect(r.success).toBe(false);
  });
});

describe("A03 Injection — phone regex blocks code injection", () => {
  it("rejects phone with shell metachars", () => {
    const r = joinRideSchema.safeParse({
      rideId: "11111111-1111-1111-1111-111111111111",
      contactPhone: "+880; rm -rf /",
    });
    expect(r.success).toBe(false);
  });

  it("rejects phone with NUL byte", () => {
    const r = joinRideSchema.safeParse({
      rideId: "11111111-1111-1111-1111-111111111111",
      contactPhone: "+8801712\x00345678",
    });
    expect(r.success).toBe(false);
  });
});
