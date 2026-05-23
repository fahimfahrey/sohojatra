/**
 * Schema validation for TOTP and recovery codes.
 *
 * Both schemas live on the trust boundary — they're the only checks between
 * raw form input and a DB RPC, so an invalid value here means the RPC sees
 * malformed input.
 */
import { describe, it, expect } from "vitest";
import { totpCodeSchema, recoveryCodeSchema } from "@/lib/validation/schemas";

describe("totpCodeSchema", () => {
  it.each(["000000", "123456", "999999"])("accepts %s", (v) => {
    expect(totpCodeSchema.parse(v)).toBe(v);
  });

  it.each([
    ["empty", ""],
    ["five digits", "12345"],
    ["seven digits", "1234567"],
    ["letters", "12345a"],
    ["whitespace", "123 56"],
    ["unicode digit", "12345٠"],
  ])("rejects %s", (_label, v) => {
    expect(totpCodeSchema.safeParse(v).success).toBe(false);
  });

  it("trims surrounding whitespace before checking digits", () => {
    expect(totpCodeSchema.parse(" 123456 ")).toBe("123456");
  });
});

describe("recoveryCodeSchema", () => {
  it("normalises XXXX-XXXX format and lowercase input", () => {
    expect(recoveryCodeSchema.parse("ab12-cd34")).toBe("AB12CD34");
  });

  it("strips surrounding whitespace and embedded dashes", () => {
    expect(recoveryCodeSchema.parse("  ab12cd34  ")).toBe("AB12CD34");
  });

  it.each(["short", "TOOLONG12345", "AB12-CD3?", ""])("rejects %s", (v) => {
    expect(recoveryCodeSchema.safeParse(v).success).toBe(false);
  });
});
