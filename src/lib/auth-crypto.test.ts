import { beforeEach, describe, expect, it } from "vitest";
import {
  createSessionToken,
  hashPassword,
  verifyPassword,
  verifySessionToken,
} from "./auth-crypto";

beforeEach(() => {
  process.env.AUTH_SECRET = "test-secret-with-at-least-thirty-two-characters";
});

describe("staff credentials", () => {
  it("hashes passwords and rejects a different password", () => {
    const hash = hashPassword("uma-palavra-passe-segura");
    expect(verifyPassword("uma-palavra-passe-segura", hash)).toBe(true);
    expect(verifyPassword("palavra-passe-errada", hash)).toBe(false);
  });
  it("accepts a valid session and rejects tampering and expiry", () => {
    const valid = createSessionToken({
      userId: "user-1",
      role: "ADMIN",
      sessionVersion: 1,
      exp: Math.floor(Date.now() / 1000) + 60,
    });
    expect(verifySessionToken(valid)?.userId).toBe("user-1");
    expect(verifySessionToken(valid)?.sessionVersion).toBe(1);
    expect(verifySessionToken(`${valid}x`)).toBeNull();
    const expired = createSessionToken({
      userId: "user-1",
      role: "ADMIN",
      sessionVersion: 1,
      exp: Math.floor(Date.now() / 1000) - 1,
    });
    expect(verifySessionToken(expired)).toBeNull();
    const legacyPayload = Buffer.from(
      JSON.stringify({
        userId: "user-1",
        role: "ADMIN",
        exp: Math.floor(Date.now() / 1000) + 60,
      }),
    ).toString("base64url");
    expect(verifySessionToken(`${legacyPayload}.invalid`)).toBeNull();
  });
});
