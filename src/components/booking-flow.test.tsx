// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BookingFlow } from "@/components/booking-flow";
import type { PublicEvent } from "@/lib/public-event";

const push = vi.fn();
const rememberCheckout = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("next/link", () => ({ default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props}>{children}</a> }));
vi.mock("@/components/logo", () => ({ Logo: () => <span>FestGo</span> }));
vi.mock("@/lib/checkout-session", () => ({ readCheckout: () => null, rememberCheckout: (...args: unknown[]) => rememberCheckout(...args), forgetCheckout: vi.fn(), checkoutUrl: () => "/checkout/test" }));
vi.mock("@/lib/clarity", () => ({ trackClarityEvent: vi.fn() }));

const event: PublicEvent = {
  slug: "brunch-mangais", name: "FestGO — Brunch Mangais", venue: "Mangais Golf Resort",
  date: "2026-11-01T09:00:00.000Z", returnAt: null,
  prices: { individual: 25_000, duo: 47_500, group: 90_000 },
  ticketIncludesEntry: false, capacity: 6, salesOpen: true, travelDuration: null,
  pickups: [
    { id: "pickup-cidade", name: "Cidade — Primeiro de Maio", address: "Preferência; ponto exacto por confirmar", routeName: "Luanda", departureAt: null, available: 6 },
    { id: "pickup-talatona", name: "Talatona — Belas Shopping", address: "Talatona — Belas Shopping", routeName: "Luanda", departureAt: null, available: 6 },
  ],
};

describe("checkout público", () => {
  beforeEach(() => {
    push.mockClear(); rememberCheckout.mockClear();
    vi.stubGlobal("crypto", { randomUUID: () => "11111111-1111-4111-8111-111111111111" });
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      if (path.endsWith("/api/reservations/seats")) return new Response(JSON.stringify({ capacity: 6, seats: [{ number: 6, state: "unavailable" }] }), { status: 200 });
      if (path.endsWith("/api/otp/request")) return new Response(JSON.stringify({ challengeId: "challenge-1234" }), { status: 200 });
      if (path.endsWith("/api/otp/verify")) {
        const { code } = JSON.parse(String(init?.body));
        return new Response(JSON.stringify(code === "123456" ? { verified: true } : { verified: false, error: "Código inválido." }), { status: code === "123456" ? 200 : 400 });
      }
      if (path.endsWith("/api/reservations")) return new Response(JSON.stringify({ reservationId: "reservation-1", accessToken: "test-access" }), { status: 201 });
      throw new Error(`Unexpected request: ${path}`);
    }));
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("mantém embarque, lugares e passageiros ao voltar e verifica OTP antes do único resumo", async () => {
    render(<BookingFlow bookingEvent={event} requiresOtp />);
    expect(screen.getByRole("list", { name: "Progresso da reserva" }).textContent).toContain("Quem vai contigo");
    fireEvent.click(screen.getByRole("radio", { name: /Talatona/ }));
    fireEvent.change(screen.getByLabelText("Quantas pessoas vão viajar?"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: "Escolher lugares" }));
    await waitFor(() => expect((screen.getByRole("button", { name: "Lugar 1" }) as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByRole("button", { name: "Lugar 1" }));
    fireEvent.click(screen.getByRole("button", { name: "Lugar 2" }));
    expect(screen.getByText("Escolhidos: 1, 2")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Continuar/ }));
    expect(screen.getByRole("heading", { name: "Quem vai contigo?" })).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Nome completo"), { target: { value: "Olavo Mazanga" } });
    fireEvent.change(screen.getByLabelText("Telemóvel angolano"), { target: { value: "923000000" } });
    expect((screen.getByLabelText("Passageiro 1") as HTMLInputElement).value).toBe("Olavo Mazanga");
    fireEvent.change(screen.getByLabelText("Passageiro 2"), { target: { value: "Ana Mazanga" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar código" }));
    await screen.findByLabelText("Código recebido");
    fireEvent.change(screen.getByLabelText("Código recebido"), { target: { value: "111111" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(await screen.findByText("Código inválido.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Código recebido"), { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(await screen.findByText("Número confirmado")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Rever reserva/ }));
    expect(screen.getAllByRole("heading", { name: "A tua reserva" })).toHaveLength(1);
    expect(screen.getByText("2 · Olavo Mazanga, Ana Mazanga")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Alterar dados/ }));
    expect((screen.getByLabelText("Passageiro 2") as HTMLInputElement).value).toBe("Ana Mazanga");
    expect(screen.getByText("Número confirmado")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Voltar" }));
    expect((screen.getByRole("radio", { name: /Talatona/ }) as HTMLInputElement).checked).toBe(true);
    await waitFor(() => expect(screen.getByText("Escolhidos: 1, 2")).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /Continuar/ }));
    expect(screen.getByText("Número confirmado")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Rever reserva/ }));
    fireEvent.click(screen.getByRole("checkbox", { name: /Li e aceito/ }));
    fireEvent.click(screen.getByRole("button", { name: /Continuar para pagamento/ }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/checkout/test"));
    const call = vi.mocked(fetch).mock.calls.find(([url]) => String(url).endsWith("/api/reservations"));
    expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({
      pickupPointId: "pickup-talatona", passengers: ["Olavo Mazanga", "Ana Mazanga"],
      seats: [1, 2], verificationId: "challenge-1234", terms: true,
    });
  });
});
