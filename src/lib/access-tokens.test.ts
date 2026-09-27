import { beforeEach, describe, expect, it } from "vitest";
import {
  createReservationToken,
  verifyReservationToken,
} from "./reservation-access";
import {
  createTicketBundleToken,
  verifyTicketBundleToken,
} from "./ticket-access";

beforeEach(() => {
  process.env.AUTH_SECRET = "test-secret-with-at-least-thirty-two-characters";
});

describe("customer access tokens", () => {
  it("binds reservation access to one reservation", () => {
    const token = createReservationToken("reservation-one");
    expect(verifyReservationToken("reservation-one", token)).toBe(true);
    expect(verifyReservationToken("reservation-two", token)).toBe(false);
  });
  it("rejects expired and modified ticket bundle links", () => {
    const valid = createTicketBundleToken(
      "FG-2026-ABCDEF12",
      new Date(Date.now() + 60_000),
    );
    expect(verifyTicketBundleToken("FG-2026-ABCDEF12", valid)).toBe(true);
    expect(verifyTicketBundleToken("FG-2026-ABCDEF13", valid)).toBe(false);
    const expired = createTicketBundleToken(
      "FG-2026-ABCDEF12",
      new Date(Date.now() - 60_000),
    );
    expect(verifyTicketBundleToken("FG-2026-ABCDEF12", expired)).toBe(false);
  });
});
