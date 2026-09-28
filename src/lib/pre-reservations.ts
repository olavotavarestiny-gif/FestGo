export const PRE_RESERVATION_MODE = "PRE_RESERVATION";

export const commercialPlans = {
  INDIVIDUAL: {
    code: "INDIVIDUAL",
    name: "Individual",
    description: "1 pessoa",
    quantity: 1,
    total: 25_000,
    listTotal: 25_000,
  },
  DUO: {
    code: "DUO",
    name: "Dupla",
    description: "2 pessoas",
    quantity: 2,
    total: 47_500,
    listTotal: 50_000,
  },
  DUO_INDIVIDUAL: {
    code: "DUO_INDIVIDUAL",
    name: "Dupla + Individual",
    description: "3 pessoas",
    quantity: 3,
    total: 72_500,
    listTotal: 75_000,
  },
  GROUP: {
    code: "GROUP",
    name: "Grupo",
    description: "4 pessoas",
    quantity: 4,
    total: 90_000,
    listTotal: 100_000,
  },
} as const;

export type CommercialPlanCode = keyof typeof commercialPlans;

export const pickupPreferences = [
  { code: "CIDADE_PRIMEIRO_MAIO", label: "Cidade — Primeiro de Maio" },
  { code: "TALATONA_BELAS", label: "Talatona — Belas Shopping" },
  { code: "11_NOVEMBRO", label: "11 de Novembro" },
  { code: "BENFICA_GIRAFA", label: "Benfica — Girafa" },
  { code: "OUTRO", label: "Outro" },
] as const;

export type PickupPreferenceCode = (typeof pickupPreferences)[number]["code"];

export function isPreReservationMode() {
  return (
    process.env.BOOKING_MODE === PRE_RESERVATION_MODE &&
    process.env.PRE_RESERVATIONS_ENABLED === "true"
  );
}

export function arePaymentsEnabled() {
  return (
    process.env.SALES_ENABLED === "true" &&
    process.env.PAYMENTS_ENABLED === "true"
  );
}

export function normalizeAngolanPhone(value: string): string | null {
  const digits = value.replace(/\D/g, "");
  const national = digits.startsWith("244") ? digits.slice(3) : digits;
  return /^9\d{8}$/.test(national) ? `+244${national}` : null;
}
