import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/db", () => ({ prisma: {} }));
import { metaCustomer, metaHash, purchaseEventId, sendMetaEvent } from "./meta-server";
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe("Meta CAPI", () => {
  it("normalizes and hashes contact fields with SHA-256", () => {
    const data = metaCustomer({ id: "customer1", fullName: " Maria Silva ", phone: "+244 923 456 789", email: " MARIA@example.com " });
    expect(data.em).toEqual([metaHash("maria@example.com")]);
    expect(data.ph).toEqual([metaHash("244923456789")]);
    expect(data.fn).toEqual([metaHash("maria")]);
    expect(data.ln).toEqual([metaHash("silva")]);
    expect(data.ph).toEqual(metaCustomer({ id: "customer1", fullName: "Maria Silva", phone: "923456789", email: null }).ph);
    expect(data.external_id[0]).toMatch(/^[a-f0-9]{64}$/);
  });
  it("uses a stable purchase ID for browser, server and retries", () => {
    expect(purchaseEventId("reservation1")).toBe("purchase:reservation1");
  });
  it("does not send without a manually configured token", async () => {
    vi.stubEnv("META_CONVERSIONS_API_TOKEN", "");
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    expect(await sendMetaEvent(event())).toBe(false); expect(fetch).not.toHaveBeenCalled();
  });
  it("sends test code, real amount and the matching ID without token in URL", async () => {
    vi.stubEnv("META_CONVERSIONS_API_TOKEN", "test-token");
    vi.stubEnv("NEXT_PUBLIC_META_PIXEL_ID", "1553576582241248");
    vi.stubEnv("META_TEST_EVENT_CODE", "TEST93825");
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ events_received: 1 }) }); vi.stubGlobal("fetch", fetch);
    expect(await sendMetaEvent(event())).toBe(true);
    const [url, init] = fetch.mock.calls[0]; expect(url).not.toContain("test-token");
    expect(JSON.parse(init.body)).toEqual({ data: [event()], test_event_code: "TEST93825" });
  });
  it("rejects failed receipts so purchases remain queued", async () => {
    vi.stubEnv("META_CONVERSIONS_API_TOKEN", "test-token"); vi.stubEnv("NEXT_PUBLIC_META_PIXEL_ID", "123");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({ error: {} }) }));
    await expect(sendMetaEvent(event())).rejects.toThrow("Meta rejected event");
  });
});
function event() { return { event_name: "Purchase", event_id: purchaseEventId("reservation1"), event_time: 1791320000, action_source: "website" as const, event_source_url: "https://festgo.mazanga.digital", user_data: { ph: [metaHash("244923456789")] }, custom_data: { value: 25000, currency: "AOA" } }; }
