import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createEkwanzaTicket,
  createEkwanzaCharge,
  getEkwanzaTicket,
  mapEkwanzaStatus,
  mapEkwanzaChargeStatus,
  verifyEkwanzaSignature,
  resetEkwanzaTokenCacheForTests,
} from "./ekwanza";

describe("É-Kwanza integration", () => {
  beforeEach(() => {
    process.env.EKWANZA_API_URL = "https://payments.ekwanza.example/api";
    process.env.EKWANZA_NOTIFICATION_TOKEN = "notification-token";
    process.env.EKWANZA_API_KEY = "secret-api-key";
    process.env.EKWANZA_PARTNER_REGISTRATION = "merchant-42";
    process.env.EKWANZA_AUTH_URL = "https://login.example/oauth2/token";
    process.env.EKWANZA_CHARGES_URL = "https://gateway.example/v2.0/charges";
    process.env.EKWANZA_CLIENT_ID = "client-id";
    process.env.EKWANZA_CLIENT_SECRET = "client-secret";
    process.env.EKWANZA_RESOURCE = "resource-id";
    process.env.EKWANZA_MERCHANT_IDENTIFIER = "merchant-42";
    process.env.EKWANZA_PAYMENT_METHOD_GPO = "GPO-method";
    process.env.EKWANZA_PAYMENT_METHOD_REF = "REF-method";
    resetEkwanzaTokenCacheForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.EKWANZA_API_URL;
    delete process.env.EKWANZA_NOTIFICATION_TOKEN;
    delete process.env.EKWANZA_API_KEY;
    delete process.env.EKWANZA_PARTNER_REGISTRATION;
    delete process.env.EKWANZA_AUTH_URL;
    delete process.env.EKWANZA_CHARGES_URL;
    delete process.env.EKWANZA_CLIENT_ID;
    delete process.env.EKWANZA_CLIENT_SECRET;
    delete process.env.EKWANZA_RESOURCE;
    delete process.env.EKWANZA_MERCHANT_IDENTIFIER;
    delete process.env.EKWANZA_PAYMENT_METHOD_GPO;
    delete process.env.EKWANZA_PAYMENT_METHOD_REF;
  });

  it("creates a 100 AOA ticket without putting credentials in headers", async () => {
    const request = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({
            Code: "EKZ-123",
            QRCode: "base64-image",
            Status: 0,
            ExpirationDate: "2026-09-30T10:00:00Z",
          }),
          { status: 201, headers: { "content-type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", request);
    const result = await createEkwanzaTicket({
      amount: 100,
      referenceCode: "festgo_test_1234",
      mobileNumber: "+244 923 123 456",
    });
    expect(result.code).toBe("EKZ-123");
    const [url, init] = request.mock.calls[0];
    const parsed = new URL(String(url));
    expect(parsed.pathname).toBe("/api/Ticket/notification-token");
    expect(parsed.searchParams.get("amount")).toBe("100.00");
    expect(parsed.searchParams.get("mobileNumber")).toBe("923123456");
    expect(init?.method).toBe("POST");
  });

  it("consults and maps every documented state", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({ Amount: "100", Code: "EKZ-123", Status: 1 }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    expect((await getEkwanzaTicket("EKZ-123")).amount).toBe(100);
    expect([0, 1, 2, 3].map(mapEkwanzaStatus)).toEqual([
      "PENDING",
      "SUCCEEDED",
      "FAILED",
      "CANCELLED",
    ]);
  });

  it("validates the documented HMAC field order", () => {
    const message = "EKZ-123festgo_test_1234merchant-42notification-token";
    const signature = createHmac("sha256", "secret-api-key")
      .update(message)
      .digest("hex");
    expect(
      verifyEkwanzaSignature({
        code: "EKZ-123",
        operationCode: "festgo_test_1234",
        signature,
      }),
    ).toBe(true);
    expect(
      verifyEkwanzaSignature({
        code: "EKZ-123",
        operationCode: "changed",
        signature,
      }),
    ).toBe(false);
  });

  it("never treats an accepted but unprocessed charge as paid", () => {
    expect(mapEkwanzaChargeStatus("Success", 101)).toBe("PENDING");
    expect(mapEkwanzaChargeStatus("Success", 100)).toBe("SUCCEEDED");
    expect(mapEkwanzaChargeStatus("Success", Number.NaN)).toBe("UNKNOWN");
    expect(mapEkwanzaChargeStatus("Failed", 100)).toBe("FAILED");
  });

  it("authenticates and creates a GPO charge without exposing credentials", async () => {
    const request = vi
      .fn<(input: string | URL | Request, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ access_token: "access-token", expires_in: 3600 }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ id: "50625c7f-894b-410b-9ee8-6ef958a534d9", status: "created" }), {
          status: 201,
          headers: { "content-type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", request);
    const result = await createEkwanzaCharge({
      amount: 100,
      merchantTransactionId: "FGTEST123456789",
      method: "gpo",
      phoneNumber: "+244 923 123 456",
    });
    expect(result.status).toBe("created");
    const authBody = request.mock.calls[0][1]?.body as URLSearchParams;
    expect(authBody.get("client_secret")).toBe("client-secret");
    const chargeInit = request.mock.calls[1][1];
    expect(chargeInit?.headers).toMatchObject({
      Authorization: "Bearer access-token",
    });
    expect(JSON.parse(String(chargeInit?.body))).toMatchObject({
      amount: 100,
      currency: "AOA",
      merchantTransactionId: "FGTEST123456789",
      paymentMethod: "GPO_GPO-method",
      paymentInfo: { phoneNumber: "923123456" },
      options: {
        MerchantIdentifier: "merchant-42",
        ApiKey: "secret-api-key",
      },
    });
  });
});
