import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendSms, ZiettError } from "./ziett";

beforeEach(() => {
  process.env.ZIETT_API_KEY = "test-key";
  process.env.ZIETT_SMS_REMITTER_ID = "00000000-0000-0000-0000-000000000001";
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.ZIETT_API_KEY;
  delete process.env.ZIETT_SMS_REMITTER_ID;
});

describe("Ziett transactional SMS", () => {
  it("returns the accepted message id and provider status", async () => {
    const request = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ message_id: "message-1", status: "QUEUED" }),
        { status: 202, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", request);
    await expect(
      sendSms({
        phone: "+244923000001",
        content: "FestGo: Teste",
        idempotencyKey: "notification-1",
      }),
    ).resolves.toEqual({ messageId: "message-1", providerStatus: "QUEUED" });
    expect(request).toHaveBeenCalledOnce();
    expect(request.mock.calls[0][1].headers["Idempotency-Key"]).toBe(
      "notification-1",
    );
  });

  it("surfaces a provider failure with its trace id", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ trace_id: "trace-1" }), {
          status: 503,
          headers: { "content-type": "application/json" },
        }),
      ),
    );
    await expect(
      sendSms({
        phone: "+244923000001",
        content: "FestGo: Teste",
        idempotencyKey: "notification-2",
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<ZiettError>>({
        status: 503,
        traceId: "trace-1",
      }),
    );
  });
});
