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

export type TicketPrices = {
  individual: number;
  duo: number;
  group: number;
};

export const defaultTicketPrices: TicketPrices = {
  individual: 25_000,
  duo: 47_500,
  group: 90_000,
};

export function calculateTicketPricing(
  quantity: number,
  prices: TicketPrices = defaultTicketPrices,
) {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100)
    throw new Error("Quantidade de bilhetes inválida.");
  const packages = [
    { key: "group", size: 4, price: prices.group },
    { key: "duo", size: 2, price: prices.duo },
    { key: "individual", size: 1, price: prices.individual },
  ] as const;
  const best: Array<
    | { total: number; individual: number; duo: number; group: number }
    | undefined
  > = [{ total: 0, individual: 0, duo: 0, group: 0 }];
  for (let count = 1; count <= quantity; count += 1) {
    for (const item of packages) {
      const previous = best[count - item.size];
      if (!previous) continue;
      const candidate = {
        ...previous,
        total: previous.total + item.price,
        [item.key]: previous[item.key] + 1,
      };
      if (!best[count] || candidate.total < best[count]!.total)
        best[count] = candidate;
    }
  }
  const result = best[quantity]!;
  return {
    quantity,
    total: result.total,
    listTotal: quantity * prices.individual,
    discount: quantity * prices.individual - result.total,
    composition: {
      individual: result.individual,
      duo: result.duo,
      group: result.group,
    },
  };
}

export function legacyPlanForQuantity(quantity: number): CommercialPlanCode | null {
  return quantity === 1
    ? "INDIVIDUAL"
    : quantity === 2
      ? "DUO"
      : quantity === 3
        ? "DUO_INDIVIDUAL"
        : quantity === 4
          ? "GROUP"
          : null;
}

export function pricingLabel(composition: {
  individual: number;
  duo: number;
  group: number;
}) {
  return [
    composition.group && `${composition.group} Grupo`,
    composition.duo && `${composition.duo} Dupla`,
    composition.individual && `${composition.individual} Individual`,
  ]
    .filter(Boolean)
    .join(" + ");
}

export function ageOnDate(birthDate: Date, eventDate: Date) {
  let age = eventDate.getUTCFullYear() - birthDate.getUTCFullYear();
  const beforeBirthday =
    eventDate.getUTCMonth() < birthDate.getUTCMonth() ||
    (eventDate.getUTCMonth() === birthDate.getUTCMonth() &&
      eventDate.getUTCDate() < birthDate.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age;
}

export function parseBirthDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value
    ? null
    : date;
}

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
