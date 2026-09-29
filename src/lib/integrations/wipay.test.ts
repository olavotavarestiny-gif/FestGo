import { createHmac, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createWiPayPayment,
  resetWiPayTokenCacheForTests,
  verifyWiPaySignature,
} from "./wipay";

describe("WiPay Angola integration", () => {
  beforeEach(() => {
    process.env.WIPAY_API_URL = "https://api.wipay.ao";
    process.env.WIPAY_CLIENT_ID = "wp_sandbox_client";
    process.env.WIPAY_CLIENT_SECRET = "WPS_sandbox_secret";
    process.env.WIPAY_ENVIRONMENT = "sandbox";
    resetWiPayTokenCacheForTests();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetWiPayTokenCacheForTests();
  });

  it("exchanges sandbox credentials and preserves the server-calculated amount", async () => {
    const paymentId = randomUUID();
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          access_token: "payment-token-with-more-than-thirty-two-characters",
          token_type: "Bearer",
          expires_in: 3600,
          scope: "payment",
        }),
      )
      .mockResolvedValueOnce(
        new Response(null, {
          status: 303,
          headers: {
            location: `https://hosted.wipay.ao/?id=${paymentId}&nonce=secure-nonce`,
          },
        }),
      );
    vi.stubGlobal("fetch", request);
    const result = await createWiPayPayment({
      amount: 162_500,
      currency: "AOA",
      customerPhone: "923000000",
      referenceId: "festgo_test_reference_1",
      successUrl: "https://festgo.mazanga.digital/pagamento?ok=1",
      failureUrl: "https://festgo.mazanga.digital/pagamento?cancelled=1",
      callbackUrl: "https://festgo.mazanga.digital/api/webhooks/wipay",
    });
    expect(result.paymentId).toBe(paymentId);
    const payload = JSON.parse(request.mock.calls[1][1].body);
    expect(payload).toMatchObject({
      amount: "162500.00",
      currency: "aoa",
      customer: "923000000",
      reference_id: "festgo_test_reference_1",
      callback_url: "https://festgo.mazanga.digital/api/webhooks/wipay",
    });
    expect(request.mock.calls[1][1].redirect).toBe("manual");
  });

  it("rejects a checkout outside the official hosted domain", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          access_token: "payment-token-with-more-than-thirty-two-characters",
          expires_in: 3600,
          scope: "payment",
        }),
      )
      .mockResolvedValueOnce(
        new Response(null, {
          status: 303,
          headers: {
            location: `https://example.test/?id=${randomUUID()}&nonce=x`,
          },
        }),
      );
    vi.stubGlobal("fetch", request);
    await expect(
      createWiPayPayment({
        amount: 100,
        currency: "AOA",
        customerPhone: "923000000",
        referenceId: "festgo_test_reference_2",
        successUrl: "https://festgo.mazanga.digital/pagamento",
        failureUrl: "https://festgo.mazanga.digital/pagamento?cancelled=1",
        callbackUrl: "https://festgo.mazanga.digital/api/webhooks/wipay",
      }),
    ).rejects.toThrow("não documentado");
  });

  it("accepts an HTTPS checkout on another official WiPay subdomain", async () => {
    const paymentId = randomUUID();
    vi.stubGlobal(
      "fetch",
      vi.fn()
        .mockResolvedValueOnce(
          Response.json({
            access_token: "payment-token-with-more-than-thirty-two-characters",
            expires_in: 3600,
            scope: "payment",
          }),
        )
        .mockResolvedValueOnce(
          new Response(null, {
            status: 303,
            headers: {
              location: `https://checkout.wipay.ao/?id=${paymentId}&nonce=secure-nonce`,
            },
          }),
        ),
    );
    await expect(
      createWiPayPayment({
        amount: 100,
        currency: "AOA",
        customerPhone: "900000000",
        referenceId: "festgo_test_reference_3",
        successUrl: "https://festgo.mazanga.digital/pagamento",
        failureUrl: "https://festgo.mazanga.digital/pagamento?cancelled=1",
        callbackUrl: "https://festgo.mazanga.digital/api/webhooks/wipay-test",
      }),
    ).resolves.toMatchObject({ paymentId });
  });

  it("verifies the documented hex HMAC over the raw callback body", async () => {
    const token = "signature-token-with-more-than-thirty-two-characters";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          access_token: token,
          expires_in: 86_400,
          scope: "signature",
        }),
      ),
    );
    const raw = '{"status":"accepted","amount":"100.00"}';
    const signature = createHmac("sha256", token).update(raw).digest("hex");
    await expect(verifyWiPaySignature(raw, signature)).resolves.toBe(true);
    await expect(verifyWiPaySignature(`${raw} `, signature)).resolves.toBe(false);
  });
});
