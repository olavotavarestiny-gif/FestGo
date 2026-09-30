export type CheckoutAccess = { reservationId: string; accessToken: string };
const storageKey = "festgo.checkout.access";

export function rememberCheckout(access: CheckoutAccess) {
  try { sessionStorage.setItem(storageKey, JSON.stringify(access)); } catch { /* Storage may be disabled. The signed recovery URL remains usable. */ }
}

export function readCheckout(): CheckoutAccess | null {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(storageKey) ?? "null");
    if (value && typeof value === "object" && "reservationId" in value && "accessToken" in value && typeof value.reservationId === "string" && typeof value.accessToken === "string" && /^[a-zA-Z0-9_-]{8,40}$/.test(value.reservationId) && /^[a-zA-Z0-9_-]{32,100}$/.test(value.accessToken))
      return { reservationId: value.reservationId, accessToken: value.accessToken };
  } catch { /* Invalid or unavailable session storage is non-fatal. */ }
  return null;
}

export function forgetCheckout() {
  try { sessionStorage.removeItem(storageKey); } catch { /* Non-fatal. */ }
}

export function checkoutUrl(access: CheckoutAccess) {
  return `/checkout/${encodeURIComponent(access.reservationId)}?token=${encodeURIComponent(access.accessToken)}`;
}
