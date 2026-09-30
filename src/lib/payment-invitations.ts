import { createHmac, timingSafeEqual } from "node:crypto";
import { publicBaseUrl } from "@/lib/config";
import { createReservationToken } from "@/lib/reservation-access";

type InvitationTokenInput = {
  id: string;
  nonce: string;
  expiresAt: Date;
};

function secret() {
  const value = process.env.AUTH_SECRET;
  if (!value || value.length < 32)
    throw new Error("AUTH_SECRET is not configured.");
  return value;
}

function signature(payload: string) {
  return createHmac("sha256", secret())
    .update(`payment-invitation:${payload}`)
    .digest();
}

export function createPaymentInvitationToken(invitation: InvitationTokenInput) {
  const expires = Math.floor(invitation.expiresAt.getTime() / 1000);
  const payload = Buffer.from(
    `${invitation.id}.${invitation.nonce}.${expires}`,
  ).toString("base64url");
  return `${payload}.${signature(payload).toString("base64url")}`;
}

export function parsePaymentInvitationToken(token: string) {
  const [payload, suppliedSignature, extra] = token.split(".");
  if (!payload || !suppliedSignature || extra) return null;
  const expected = signature(payload);
  const supplied = Buffer.from(suppliedSignature, "base64url");
  if (
    expected.length !== supplied.length ||
    !timingSafeEqual(expected, supplied)
  )
    return null;
  const [id, nonce, rawExpiry, unexpected] = Buffer.from(
    payload,
    "base64url",
  )
    .toString("utf8")
    .split(".");
  const expires = Number(rawExpiry);
  if (!id || !nonce || unexpected || !Number.isSafeInteger(expires)) return null;
  const expiresAt = new Date(expires * 1000);
  if (expiresAt <= new Date()) return null;
  return { id, nonce, expiresAt };
}

export function paymentInvitationTtlHours() {
  const configured = Number(process.env.PAYMENT_INVITE_TTL_HOURS ?? "72");
  return Number.isInteger(configured) && configured >= 1 && configured <= 168
    ? configured
    : 72;
}

export function paymentInvitationLink(invitation: InvitationTokenInput) {
  const token = createPaymentInvitationToken(invitation);
  return `${publicBaseUrl()}/confirmar/${encodeURIComponent(token)}`;
}

export function checkoutRecoveryLink(reservationId: string) {
  return `${publicBaseUrl()}/checkout/${encodeURIComponent(reservationId)}?token=${encodeURIComponent(createReservationToken(reservationId))}`;
}

export function canRecoverCheckout(reservation: {
  status: string;
  holdExpiresAt: Date | null;
  event: { status: string; eventDate: Date };
  payments: { status: string }[];
}, now = new Date()) {
  return ["HELD", "AWAITING_PAYMENT", "PAYMENT_PENDING"].includes(reservation.status)
    && (!reservation.holdExpiresAt || reservation.holdExpiresAt > now)
    && !["CANCELLED", "CLOSED"].includes(reservation.event.status)
    && reservation.event.eventDate > now
    && !reservation.payments.some((payment) => ["SUCCEEDED", "UNKNOWN", "REFUND_PENDING", "REFUNDED"].includes(payment.status));
}

export function invitationState(invitation: {
  revokedAt: Date | null;
  confirmedAt: Date | null;
  expiresAt: Date;
}) {
  if (invitation.revokedAt) return "REVOKED";
  if (invitation.expiresAt <= new Date()) return "EXPIRED";
  if (invitation.confirmedAt) return "CONFIRMED";
  return "ACTIVE";
}
