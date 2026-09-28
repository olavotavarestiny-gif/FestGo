import { beforeEach, describe, expect, it } from "vitest";
import {
  createPaymentInvitationToken,
  parsePaymentInvitationToken,
  paymentInvitationLink,
} from "./payment-invitations";

beforeEach(() => {
  process.env.AUTH_SECRET = "test-secret-with-at-least-thirty-two-characters";
});

describe("payment invitation tokens", () => {
  it("creates an opaque signed link without reservation or customer data", () => {
    const invitation = {
      id: "invite-one",
      nonce: "85d129a7-40be-4120-a5c1-334aaebfb392",
      expiresAt: new Date(Date.now() + 60_000),
    };
    const token = createPaymentInvitationToken(invitation);
    const link = paymentInvitationLink(invitation);
    expect(link).toBe(`https://festgo.mazanga.digital/confirmar/${token}`);
    expect(link).not.toContain("FGP-");
    expect(parsePaymentInvitationToken(token)?.id).toBe(invitation.id);
    expect(parsePaymentInvitationToken(`${token}x`)).toBeNull();
  });

  it("rejects expired links", () => {
    const token = createPaymentInvitationToken({
      id: "invite-expired",
      nonce: "752c3f77-849b-4e85-ac72-5b339f83197f",
      expiresAt: new Date(Date.now() - 60_000),
    });
    expect(parsePaymentInvitationToken(token)).toBeNull();
  });
});
