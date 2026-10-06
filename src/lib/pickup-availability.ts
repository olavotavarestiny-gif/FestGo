// The Brunch Mangais operator will confirm exact pickup details by 25 October.
// Stop offering an incomplete pickup when that entire local day has passed.
const detailsDeadline = new Date("2026-10-26T00:00:00+01:00");

export function pickupAvailableForSale(
  point: { operationalConfirmed: boolean; departureAt: Date | null; address: string },
  now = new Date(),
) {
  if (!point.operationalConfirmed || (point.departureAt && point.departureAt <= now)) return false;
  if (now >= detailsDeadline && (!point.departureAt || /por confirmar/i.test(point.address))) return false;
  return true;
}
