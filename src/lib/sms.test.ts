import { describe, expect, it } from "vitest";
import { analyzeSms, smsTemplates } from "./sms";

describe("SMS cost estimation", () => {
  it("preserves the requested Portuguese OTP and measures its UCS-2 cost", () => {
    for (const content of [
      smsTemplates.otp("123456"),
      smsTemplates.otp("123456", 10),
    ]) {
      const result = analyzeSms(content);
      expect(content).toContain("O teu código de confirmação é 123456");
      expect(result.encoding).toBe("UCS-2");
      expect(result.segments).toBe(2);
      expect(result.characterCount).toBeLessThanOrEqual(160);
    }
  });

  it("counts GSM-7 extension characters as two units", () => {
    const result = analyzeSms("Valor {teste}");
    expect(result.characterCount).toBe(13);
    expect(result.units).toBe(15);
    expect(result.encoding).toBe("GSM-7");
  });

  it("detects UCS-2 when the final message contains unsupported characters", () => {
    const result = analyzeSms("Aprovação concluída");
    expect(result.encoding).toBe("UCS-2");
    expect(result.singleSegmentLimit).toBe(70);
  });

  it("estimates multiple segments after substituting a long real link", () => {
    const link = `https://festgo.mazanga.digital/pagamento?token=${"a".repeat(180)}`;
    const result = analyzeSms(smsTemplates.paymentLink(link));
    expect(result.encoding).toBe("GSM-7");
    expect(result.segments).toBeGreaterThan(1);
    expect(result.isSingleSegment).toBe(false);
  });

  it("prices the exact manual payment invitation after real substitutions", () => {
    const content = smsTemplates.paymentInvitation(
      "https://festgo.mazanga.digital/confirmar/token-seguro",
      "FGP-2026-ABC123",
    );
    expect(content).toContain("Conclui o pagamento no site:");
    const result = analyzeSms(content);
    expect(result.encoding).toBe("GSM-7");
    expect(result.segments).toBe(1);
  });

  it("keeps pickup details readable with an exact meeting point", () => {
    const content = smsTemplates.pickupDetails("Zango — Shopping Outlet", "Entrada principal, junto à paragem", "01/11", "08:30");
    expect(content).toContain("Entrada principal, junto a paragem, 01/11 as 08:30");
    expect(analyzeSms(content).encoding).toBe("GSM-7");
  });
});
