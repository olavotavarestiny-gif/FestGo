import { describe, expect, it } from "vitest";
import { buildWhatsAppReservationMessage, buildWhatsAppReservationUrl } from "@/lib/whatsapp";

const details = {
  reference: "FG-2026-ABC123",
  eventName: "Brunch Mangais",
  responsibleName: "Ana Manuel",
  phone: "923 000 000",
  email: "ana@example.com",
  quantity: 2,
  total: "70 000 Kz",
  pickup: "Cidade — 1.º de Maio",
  returnArea: "Talatona",
  seats: "4, 5",
  passengers: [
    { fullName: "Ana Manuel", birthDate: "1990-05-20" },
    { fullName: "José Manuel", birthDate: "2015-10-02" },
  ],
  guardianName: "Ana Manuel",
  guardianPhone: "923 000 000",
  playlistSuggestion: "Matias Damásio — Loucos",
  kidsInterest: true,
};

describe("WhatsApp reservation handoff", () => {
  it("builds a payment request with the reservation details", () => {
    const message = buildWhatsAppReservationMessage(details);

    expect(message).toContain("Já fiz a minha pré-reserva pelo site para o Brunch Mangais");
    expect(message).toContain("Referência: FG-2026-ABC123");
    expect(message).toContain("2. José Manuel — nascimento: 02/10/2015");
    expect(message).toContain("enviar-me os dados e as instruções de pagamento");
  });

  it("targets the FestGo WhatsApp number and encodes the message", () => {
    const url = buildWhatsAppReservationUrl(details);

    expect(url).toMatch(/^https:\/\/wa\.me\/244932511161\?text=/);
    expect(decodeURIComponent(url.split("?text=")[1])).toBe(buildWhatsAppReservationMessage(details));
  });
});
