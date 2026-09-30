import { createHmac, timingSafeEqual } from "node:crypto";

function secret() {
  const value = process.env.AUTH_SECRET;
  if (!value || value.length < 32)
    throw new Error("AUTH_SECRET is not configured.");
  return value;
}

export function createTicketBundleToken(reference: string, expiresAt: Date) {
  const expiry = Math.floor(expiresAt.getTime() / 1000);
  const signature = createHmac("sha256", secret())
    .update(`${reference}:${expiry}`)
    .digest("base64url");
  return `${expiry}.${signature}`;
}

export function verifyTicketBundleToken(reference: string, token: string) {
  const [rawExpiry, suppliedSignature, extra] = token.split(".");
  const expiry = Number(rawExpiry);
  if (
    extra || !Number.isSafeInteger(expiry) ||
    expiry <= Math.floor(Date.now() / 1000) ||
    !suppliedSignature
  )
    return false;
  const expected = createHmac("sha256", secret())
    .update(`${reference}:${expiry}`)
    .digest();
  const supplied = Buffer.from(suppliedSignature, "base64url");
  return (
    expected.length === supplied.length && timingSafeEqual(expected, supplied)
  );
}
