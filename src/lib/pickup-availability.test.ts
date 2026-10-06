import { describe, expect, it } from "vitest";
import { pickupAvailableForSale } from "./pickup-availability";

describe("pickup sale deadline", () => {
  const pending = { operationalConfirmed: true, departureAt: null, address: "Preferência; ponto exacto por confirmar" };
  it("allows the confirmed zone while details are still due", () => {
    expect(pickupAvailableForSale(pending, new Date("2026-10-06T12:00:00Z"))).toBe(true);
  });
  it("stops new sales at an incomplete pickup after 25 October", () => {
    expect(pickupAvailableForSale(pending, new Date("2026-10-25T23:00:00Z"))).toBe(false);
  });
  it("keeps a completed pickup available until departure", () => {
    const point = { ...pending, departureAt: new Date("2026-11-01T07:30:00Z"), address: "Entrada principal" };
    expect(pickupAvailableForSale(point, new Date("2026-10-26T00:00:00Z"))).toBe(true);
    expect(pickupAvailableForSale(point, new Date("2026-11-01T07:30:00Z"))).toBe(false);
  });
});
