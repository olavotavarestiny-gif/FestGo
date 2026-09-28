import { afterEach, describe, expect, it } from "vitest";
import { POST } from "./route";

describe("official payment methods", () => {
  afterEach(() => {
    delete process.env.SALES_ENABLED;
    delete process.env.PAYMENTS_ENABLED;
    delete process.env.AUTH_SECRET;
  });

  it("rejects Multicaixa Reference while keeping Express available", async () => {
    process.env.SALES_ENABLED = "true";
    process.env.PAYMENTS_ENABLED = "true";
    process.env.AUTH_SECRET = "test-secret-with-at-least-thirty-two-characters";
    const reference = await POST(
      new Request("http://localhost/api/payments/intent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          reservationId: "reservation-test-id",
          accessToken: "a".repeat(43),
          method: "reference",
        }),
      }),
    );
    expect(reference.status).toBe(400);

    const express = await POST(
      new Request("http://localhost/api/payments/intent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          reservationId: "reservation-test-id",
          accessToken: "a".repeat(43),
          method: "multicaixa",
        }),
      }),
    );
    expect(express.status).toBe(403);
  });
});
