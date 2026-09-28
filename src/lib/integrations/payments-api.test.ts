import { describe, expect, it } from "vitest";
import { mapStatus, normalizeProductId } from "./payments-api";

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

describe("payment product configuration", () => {
  it("accepts a UUID or extracts it from a product link", () => {
    const id = "d5d5165f-eb43-4aea-b2fd-90ec295430e6";
    expect(normalizeProductId(id)).toBe(id);
    expect(normalizeProductId(`https://payments.example/products/${id}`)).toBe(id);
    expect(normalizeProductId("https://payments.example/products/missing")).toBeUndefined();
  });
});
