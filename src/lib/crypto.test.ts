import { randomBytes, scryptSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./crypto";

describe("password hashing", () => {
  it("round-trips and contains nothing .env loaders would expand", () => {
    const hash = hashPassword("070809");
    expect(hash).not.toMatch(/[$"'`\s]/);
    expect(verifyPassword("070809", hash)).toBe(true);
    expect(verifyPassword("070810", hash)).toBe(false);
  });
  it("still accepts the older scrypt$salt$hash format", () => {
    const salt = randomBytes(16);
    const legacy = `scrypt$${salt.toString("base64")}$${scryptSync("pw", salt, 32).toString("base64")}`;
    expect(verifyPassword("pw", legacy)).toBe(true);
    expect(verifyPassword("nope", legacy)).toBe(false);
  });
  it("rejects malformed values", () => {
    expect(verifyPassword("pw", "")).toBe(false);
    expect(verifyPassword("pw", "scrypt.only")).toBe(false);
  });
});
