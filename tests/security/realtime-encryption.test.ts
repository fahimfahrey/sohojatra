/**
 * Realtime encryption: TweetNaCl secretbox envelope used by AblyContext.
 *
 * Verifies that payloads round-trip and that tampered/malformed envelopes
 * are rejected with an authentication failure, so subscribers never deliver
 * garbled or attacker-controlled data to consumers.
 */
import { describe, it, expect } from "vitest";
import {
  encryptRealTimeData,
  decryptRealTimeData,
  encryptRideSensitiveData,
  decryptRideSensitiveData,
} from "@/lib/encryption";

describe("realtime encryption envelope", () => {
  it("round-trips arbitrary JSON payloads", async () => {
    const payload = {
      rideId: "ride_123",
      action: "create" as const,
      seats: 3,
      nested: { lat: 23.81, lng: 90.41 },
    };
    const ct = await encryptRealTimeData(payload);
    expect(typeof ct).toBe("string");
    expect(ct).not.toContain("ride_123");

    const pt = await decryptRealTimeData(ct);
    expect(pt).toEqual(payload);
  });

  it("produces a fresh nonce per call (different ciphertexts for same plaintext)", async () => {
    const a = await encryptRealTimeData({ x: 1 });
    const b = await encryptRealTimeData({ x: 1 });
    expect(a).not.toEqual(b);
  });

  it("rejects truncated ciphertext", async () => {
    const ct = await encryptRealTimeData({ x: 1 });
    const truncated = ct.slice(0, 8);
    await expect(decryptRealTimeData(truncated)).rejects.toThrow(
      /decrypt|fail/i,
    );
  });

  it("rejects ciphertext with a flipped byte (MAC catches tamper)", async () => {
    const ct = await encryptRealTimeData({ msg: "hello" });
    const buf = Buffer.from(ct, "base64");
    buf[buf.length - 1] ^= 0x01;
    const tampered = buf.toString("base64");
    await expect(decryptRealTimeData(tampered)).rejects.toThrow(
      /decrypt|fail/i,
    );
  });

  it("encrypts ride addresses but leaves coordinates visible", async () => {
    const ride = {
      id: "r1",
      startingPoint: { address: "Dhanmondi 27", lat: 23.7, lng: 90.3 },
      destination: { address: "Banani", lat: 23.79, lng: 90.4 },
    };
    const enc = await encryptRideSensitiveData(ride);
    const sp = enc.startingPoint as { address: string; lat: number };
    expect(sp.address).not.toEqual("Dhanmondi 27");
    expect(sp.lat).toBe(23.7);

    const dec = await decryptRideSensitiveData(enc);
    expect(dec).toEqual(ride);
  });
});
