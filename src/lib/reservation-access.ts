import { createHmac, timingSafeEqual } from "node:crypto";

function signature(reservationId: string) {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32)
    throw new Error("AUTH_SECRET is not configured.");
  return createHmac("sha256", secret)
    .update(`reservation:${reservationId}`)
    .digest();
}

export function createReservationToken(reservationId: string) {
  return signature(reservationId).toString("base64url");
}

export function verifyReservationToken(reservationId: string, token: string) {
  const expected = signature(reservationId);
  const supplied = Buffer.from(token || "", "base64url");
  return (
    expected.length === supplied.length && timingSafeEqual(expected, supplied)
  );
}
