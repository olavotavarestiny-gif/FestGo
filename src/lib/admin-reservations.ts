import { Prisma, ReservationStatus } from "@prisma/client";
import { commercialPlans, pickupPreferences } from "@/lib/pre-reservations";

export const reservationStatusLabels: Record<ReservationStatus, string> = {
  LEAD: "Inscrição incompleta",
  PRE_RESERVED: "Por analisar",
  PAYMENT_PENDING: "Pré-reserva aprovada",
  WAITLIST: "Lista de espera",
  HELD: "Lugar reservado",
  AWAITING_PAYMENT: "A aguardar pagamento",
  PAYMENT_UNCERTAIN: "Pagamento por confirmar",
  PAID: "Pagamento confirmado",
  CANCELLED: "Cancelada",
  EXPIRED: "Expirada",
  REFUNDED: "Reembolsada",
};

export const planLabels = Object.fromEntries(
  Object.entries(commercialPlans).map(([code, plan]) => [code, plan.name]),
) as Record<string, string>;

export const pickupLabels = pickupPreferences.map((pickup) => pickup.label);

export type AdminReservationFilters = {
  q: string;
  event: string;
  plan?: keyof typeof commercialPlans;
  pickup?: string;
  status?: ReservationStatus;
};

export function parseAdminReservationFilters(input: {
  q?: string;
  event?: string;
  plan?: string;
  pickup?: string;
  status?: string;
}): AdminReservationFilters {
  const plan = Object.hasOwn(commercialPlans, input.plan ?? "")
    ? (input.plan as keyof typeof commercialPlans)
    : undefined;
  const status = Object.hasOwn(reservationStatusLabels, input.status ?? "")
    ? (input.status as ReservationStatus)
    : undefined;
  const pickup = pickupLabels.some((label) => label === input.pickup)
    ? input.pickup
    : undefined;
  return {
    q: input.q?.trim().slice(0, 100) ?? "",
    event: input.event?.trim().slice(0, 100) || "brunch-mangais",
    plan,
    pickup,
    status,
  };
}

export function reservationWhere(
  filters: AdminReservationFilters,
): Prisma.ReservationWhereInput {
  return {
    event: { slug: filters.event },
    ...(filters.plan ? { plan: filters.plan } : {}),
    ...(filters.pickup ? { pickupPreference: filters.pickup } : {}),
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.q
      ? {
          OR: [
            {
              reference: {
                contains: filters.q,
                mode: Prisma.QueryMode.insensitive,
              },
            },
            {
              customer: {
                fullName: {
                  contains: filters.q,
                  mode: Prisma.QueryMode.insensitive,
                },
              },
            },
            { customer: { phone: { contains: filters.q } } },
            {
              passengers: {
                some: {
                  fullName: {
                    contains: filters.q,
                    mode: Prisma.QueryMode.insensitive,
                  },
                },
              },
            },
          ],
        }
      : {}),
  };
}

export function filtersQuery(
  filters: AdminReservationFilters,
  extra: Record<string, string> = {},
) {
  const query = new URLSearchParams(extra);
  if (filters.q) query.set("q", filters.q);
  if (filters.event !== "brunch-mangais") query.set("event", filters.event);
  if (filters.plan) query.set("plan", filters.plan);
  if (filters.pickup) query.set("pickup", filters.pickup);
  if (filters.status) query.set("status", filters.status);
  return query.toString();
}
