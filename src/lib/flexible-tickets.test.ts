import { describe, expect, it } from "vitest";
import {
  ageOnDate,
  calculateTicketPricing,
  legacyPlanForQuantity,
  parseBirthDate,
} from "@/lib/pre-reservations";

describe("flexible ticket quantities", () => {
  it.each([
    [1, 25_000], [2, 47_500], [3, 72_500], [4, 90_000],
    [5, 115_000], [6, 137_500], [7, 162_500], [8, 180_000],
  ])("calculates the cheapest package composition for %i passengers", (quantity, total) => {
    expect(calculateTicketPricing(quantity).total).toBe(total);
  });

  it("keeps legacy plans only for their exact quantities", () => {
    expect(legacyPlanForQuantity(3)).toBe("DUO_INDIVIDUAL");
    expect(legacyPlanForQuantity(5)).toBeNull();
  });

  it("calculates age on the event date", () => {
    const event = new Date("2026-11-01T00:00:00.000Z");
    expect(ageOnDate(parseBirthDate("2008-11-01")!, event)).toBe(18);
    expect(ageOnDate(parseBirthDate("2008-11-02")!, event)).toBe(17);
  });
});
