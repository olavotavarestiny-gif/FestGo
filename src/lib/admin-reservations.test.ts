import { describe, expect, it } from "vitest";
import {
  filtersQuery,
  parseAdminReservationFilters,
  reservationWhere,
} from "./admin-reservations";

describe("admin reservation filters", () => {
  it("accepts known filters and discards unsupported values", () => {
    expect(
      parseAdminReservationFilters({
        q: "  FGP-2026  ",
        event: "brunch-mangais",
        plan: "DUO",
        pickup: "Talatona — Belas Shopping",
        status: "PRE_RESERVED",
      }),
    ).toEqual({
      q: "FGP-2026",
      event: "brunch-mangais",
      plan: "DUO",
      pickup: "Talatona — Belas Shopping",
      status: "PRE_RESERVED",
      minors: false,
    });
    expect(
      parseAdminReservationFilters({ plan: "INVALID", status: "INVALID" }),
    ).toEqual({
      q: "",
      event: "brunch-mangais",
      plan: undefined,
      pickup: undefined,
      status: undefined,
      minors: false,
    });
  });

  it("searches references, contacts, phone numbers and passenger names", () => {
    const where = reservationWhere(
      parseAdminReservationFilters({ q: "Josué" }),
    );
    expect(where.OR).toHaveLength(4);
    expect(where.event).toEqual({ slug: "brunch-mangais" });
  });

  it("preserves active filters in export and pagination links", () => {
    const filters = parseAdminReservationFilters({
      q: "923",
      plan: "INDIVIDUAL",
      status: "PAID",
    });
    const query = new URLSearchParams(filtersQuery(filters, { page: "2" }));
    expect(Object.fromEntries(query)).toEqual({
      page: "2",
      q: "923",
      plan: "INDIVIDUAL",
      status: "PAID",
    });
  });

  it("filters reservations that include minors", () => {
    const filters = parseAdminReservationFilters({ minors: "1" });
    expect(reservationWhere(filters).minorCount).toEqual({ gt: 0 });
    expect(new URLSearchParams(filtersQuery(filters)).get("minors")).toBe("1");
  });
});
