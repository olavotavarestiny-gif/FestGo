"use client";
export type MetaEventName = "PageView" | "ViewContent" | "InitiateCheckout" | "AddPaymentInfo" | "Purchase";
type Pixel = ((...args: unknown[]) => void) & { queue?: unknown[][]; loaded?: boolean; version?: string; callMethod?: (...args: unknown[]) => void; push?: Pixel };
declare global { interface Window { fbq?: Pixel; _fbq?: Pixel } }
const sent = new Set<string>();
let checkoutEventId: string | undefined;
export function trackMeta(name: MetaEventName, data: Record<string, unknown> = {}, eventId = crypto.randomUUID(), access?: { reservationId: string; accessToken: string }) {
  if (name === "InitiateCheckout") { checkoutEventId ??= eventId; eventId = checkoutEventId; }
  const pixelId = process.env.NEXT_PUBLIC_META_PIXEL_ID;
  if (!pixelId || sent.has(eventId)) return;
  try { if (name === "Purchase" && localStorage.getItem(`meta:${eventId}`)) return; } catch {}
  if (!window.fbq) {
    const pixel: Pixel = (...args) => { if (pixel.callMethod) pixel.callMethod(...args); else pixel.queue!.push(args); };
    pixel.queue = []; pixel.loaded = true; pixel.version = "2.0"; pixel.push = pixel;
    window.fbq = pixel; window._fbq = pixel;
    pixel("init", pixelId);
    const script = document.createElement("script"); script.async = true;
    script.src = "https://connect.facebook.net/en_US/fbevents.js"; document.head.appendChild(script);
  }
  sent.add(eventId);
  window.fbq("track", name, data, { eventID: eventId });
  try { if (name === "Purchase") localStorage.setItem(`meta:${eventId}`, "1"); } catch {}
  // Purchase CAPI is exclusively queued by verified gateway finalization.
  if (name === "Purchase") return;
  void fetch("/api/meta/events", { method: "POST", headers: { "Content-Type": "application/json" }, keepalive: true,
    body: JSON.stringify({ name, eventId, path: location.pathname, data, ...access }) }).catch(() => {});
}
