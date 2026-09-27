import { describe, expect, it } from "vitest";
import { mapStatus } from "./payments-api";

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
