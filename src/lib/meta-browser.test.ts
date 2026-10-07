// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from "vitest";
beforeEach(() => { vi.resetModules(); vi.stubEnv("NEXT_PUBLIC_META_PIXEL_ID", "1553576582241248"); window.fbq = vi.fn<(...args: unknown[]) => void>(); localStorage.clear(); vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true })); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it("uses the same ID in Pixel and CAPI mirror and suppresses repeats", async () => {
  const { trackMeta } = await import("./meta-browser");
  trackMeta("ViewContent", { content_name: "Brunch Mangais" }, "unique-event-1");
  trackMeta("ViewContent", {}, "unique-event-1");
  expect(window.fbq).toHaveBeenCalledTimes(1);
  expect(window.fbq).toHaveBeenCalledWith("track", "ViewContent", { content_name: "Brunch Mangais" }, { eventID: "unique-event-1" });
  expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string).eventId).toBe("unique-event-1");
});
it("never accepts Purchase for CAPI from the browser and remembers the browser receipt", async () => {
  const { trackMeta } = await import("./meta-browser");
  trackMeta("Purchase", { value: 25000, currency: "AOA" }, "purchase:reservation1");
  expect(fetch).not.toHaveBeenCalled(); expect(window.fbq).toHaveBeenCalledTimes(1);
  vi.resetModules(); const fresh = await import("./meta-browser");
  fresh.trackMeta("Purchase", { value: 25000, currency: "AOA" }, "purchase:reservation1");
  expect(window.fbq).toHaveBeenCalledTimes(1);
});
it("does not duplicate checkout when the customer returns to the previous step", async () => {
  const { trackMeta } = await import("./meta-browser");
  trackMeta("InitiateCheckout"); trackMeta("InitiateCheckout");
  expect(window.fbq).toHaveBeenCalledTimes(1); expect(fetch).toHaveBeenCalledTimes(1);
});
