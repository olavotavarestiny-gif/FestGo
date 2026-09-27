import {
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

export type SessionPayload = {
  userId: string;
  role: "ADMIN" | "OPERATOR";
  exp: number;
};

function secret() {
  const value = process.env.AUTH_SECRET;
  if (!value || value.length < 32)
    throw new Error("AUTH_SECRET must contain at least 32 characters.");
  return value;
}

export function hashPassword(password: string) {
  if (password.length < 12)
    throw new Error("A palavra-passe deve ter pelo menos 12 caracteres.");
  const salt = randomBytes(16).toString("base64url");
  return `scrypt$${salt}$${scryptSync(password, salt, 64).toString("base64url")}`;
}

export function verifyPassword(password: string, encoded: string) {
  const [algorithm, salt, stored] = encoded.split("$");
  if (algorithm !== "scrypt" || !salt || !stored) return false;
  const expected = Buffer.from(stored, "base64url");
  const supplied = scryptSync(password, salt, expected.length);
  return (
    expected.length === supplied.length && timingSafeEqual(expected, supplied)
  );
}

export function createSessionToken(payload: SessionPayload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", secret())
    .update(encoded)
    .digest("base64url");
  return `${encoded}.${signature}`;
}

export function verifySessionToken(token: string): SessionPayload | null {
  const [encoded, suppliedSignature] = token.split(".");
  if (!encoded || !suppliedSignature) return null;
  const expectedSignature = createHmac("sha256", secret())
    .update(encoded)
    .digest();
  const supplied = Buffer.from(suppliedSignature, "base64url");
  if (
    expectedSignature.length !== supplied.length ||
    !timingSafeEqual(expectedSignature, supplied)
  )
    return null;
  try {
    const payload = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as SessionPayload;
    if (
      !payload.userId ||
      !["ADMIN", "OPERATOR"].includes(payload.role) ||
      payload.exp <= Math.floor(Date.now() / 1000)
    )
      return null;
    return payload;
  } catch {
    return null;
  }
}
