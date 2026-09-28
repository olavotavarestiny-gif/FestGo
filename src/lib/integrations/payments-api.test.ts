import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createPayment,
  mapStatus,
  normalizeProductId,
  paymentMethodMatches,
  paymentPageUrl,
} from "./payments-api";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.PAYMENTS_API_KEY;
  delete process.env.PAYMENTS_API_URL;
});

describe("payment status mapping", () => {
  it.each([
    ["paid", "SUCCEEDED"],
    ["completed", "SUCCEEDED"],
    ["pending", "PENDING"],
    ["expired", "FAILED"],
    ["refunded", "REFUNDED"],
    ["unexpected", "PENDING"],
  ])("maps %s to %s", (remote, local) => {
    expect(mapStatus(remote)).toBe(local);
  });
});

describe("payment page URL", () => {
  it("accepts only an HTTPS checkout URL returned by the gateway", () => {
    const base = {
      success: true,
      payment_id: "d5d5165f-eb43-4aea-b2fd-90ec295430e6",
      status: "pending",
      payment_method: "multicaixa" as const,
      total_amount: 100,
      currency: "AOA",
      diagnostics: { source: "root", responseKeys: [] },
    };
    expect(paymentPageUrl({ ...base, checkout_url: "https://pay.example/test" }))
      .toBe("https://pay.example/test");
    expect(paymentPageUrl({ ...base, checkout_url: "javascript:alert(1)" }))
      .toBeNull();
  });
});

describe("payment creation response", () => {
  it("normalizes the real sale-shaped response and preserves its identifier", async () => {
    process.env.PAYMENTS_API_KEY = "simulated-key";
    process.env.PAYMENTS_API_URL =
      "https://rouxavcvorjiwhpjhsye.supabase.co/functions/v1/api-v1";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            id: "cdcbdaee-83a8-4b1c-855f-92e43f6c8a23",
            product_id: "20d032f3-e0c2-48d3-8ce1-c93bc682dd37",
            amount: 100,
            currency: "AOA",
            status: "pending",
            payment_method: "multicaixa_express",
          }),
          { status: 201, headers: { "content-type": "application/json" } },
        ),
      ),
    );
    const result = await createPayment({
      productId: "20d032f3-e0c2-48d3-8ce1-c93bc682dd37",
      quantity: 1,
      method: "multicaixa",
      customer: {
        name: "Passageiro Teste",
        email: "teste@example.test",
        phone: "+244923000000",
      },
    });
    expect(result).toMatchObject({
      payment_id: "cdcbdaee-83a8-4b1c-855f-92e43f6c8a23",
      total_amount: 100,
      currency: "AOA",
      payment_method: "multicaixa_express",
      diagnostics: { source: "root" },
    });
  });
});

describe("payment method normalization", () => {
  it("accepts the Multicaixa Express name returned by the gateway", () => {
    expect(paymentMethodMatches("multicaixa", "multicaixa_express")).toBe(true);
    expect(paymentMethodMatches("multicaixa", "express")).toBe(true);
    expect(paymentMethodMatches("reference", "multicaixa_reference")).toBe(true);
    expect(paymentMethodMatches("reference", "multicaixa_express")).toBe(false);
  });
});

describe("payment product configuration", () => {
  it("accepts a UUID or extracts it from a product link", () => {
    const id = "d5d5165f-eb43-4aea-b2fd-90ec295430e6";
    expect(normalizeProductId(id)).toBe(id);
    expect(normalizeProductId(`https://payments.example/products/${id}`)).toBe(id);
    expect(normalizeProductId("https://payments.example/products/missing")).toBeUndefined();
  });
});
