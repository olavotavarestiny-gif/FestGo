export const PRIVATE_WIPAY_PROBE_SLUG = "private-wipay-callback-probe";
export const PRIVATE_WIPAY_PROBE_AMOUNT = 100;

export function isPrivateWiPayProbe(reservation: {
  reference: string;
  totalAmount: unknown;
  event: { slug: string };
}) {
  return reservation.event.slug === PRIVATE_WIPAY_PROBE_SLUG &&
    reservation.reference.startsWith("FG-TEST-") &&
    Number(reservation.totalAmount) === PRIVATE_WIPAY_PROBE_AMOUNT;
}
