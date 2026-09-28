type KukuGestSaleResponse = {
  success: boolean;
  saleId: string;
  contactId?: number | null;
  existing?: boolean;
};

type KukuGestStatusResponse = {
  success: boolean;
  account: string;
  scopes: string[];
};

type KukuGestContactResponse = {
  success: boolean;
  contactId: number;
  existing?: boolean;
};

export class KukuGestError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "KukuGestError";
  }
}

function config() {
  const apiKey = process.env.KUKUGEST_API_KEY;
  const rawUrl = process.env.KUKUGEST_API_URL;
  if (!apiKey || !rawUrl)
    throw new KukuGestError("Falta configurar a integração KukuGest.");
  const url = new URL(rawUrl);
  if (url.protocol !== "https:")
    throw new KukuGestError("KUKUGEST_API_URL deve utilizar HTTPS.");
  return { apiKey, baseUrl: rawUrl.replace(/\/$/, "") };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const { apiKey, baseUrl } = config();
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "X-API-Key": apiKey,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
    cache: "no-store",
    signal: AbortSignal.timeout(5_000),
  });
  const data = (await response.json().catch(() => ({}))) as T & {
    error?: string;
  };
  if (!response.ok)
    throw new KukuGestError(
      data.error ?? "O KukuGest rejeitou o pedido.",
      response.status,
    );
  return data;
}

export async function checkKukuGestConnection() {
  const result = await request<KukuGestStatusResponse>("/status");
  if (!result.success || !result.scopes.includes("sales:write")) {
    throw new KukuGestError("A chave KukuGest não permite registar vendas.");
  }
  return result;
}

export async function registerKukuGestSale(input: {
  reservationId: string;
  reference: string;
  eventName: string;
  amount: number;
  paidAt: Date;
  pickupPoint: string;
  quantity: number;
  customer: { name: string; phone: string; email?: string | null };
}) {
  const result = await request<KukuGestSaleResponse>("/sales", {
    method: "POST",
    body: JSON.stringify({
      externalId: `festgo:${input.reservationId}`,
      title: `${input.eventName} · ${input.reference}`,
      valueKz: input.amount,
      companyName: "Consumidor Final",
      source: "FestGO",
      closedAt: input.paidAt.toISOString(),
      contact: {
        name: input.customer.name,
        phone: input.customer.phone,
        email: input.customer.email || undefined,
        tags: ["FestGO", "Brunch Mangais"],
        customFields: {
          festgoReservation: input.reference,
          pickupPoint: input.pickupPoint,
          passengers: input.quantity,
        },
      },
    }),
  });
  if (!result.success || !result.saleId)
    throw new KukuGestError("O KukuGest devolveu uma resposta inválida.");
  return result;
}

export async function upsertKukuGestPreReservation(input: {
  reference: string;
  eventName: string;
  plan: string;
  commercialStatus: string;
  pickupPreference: string;
  seats: number[];
  customer: { name: string; phone: string; email?: string | null };
}) {
  const result = await request<KukuGestContactResponse>("/contacts", {
    method: "POST",
    body: JSON.stringify({
      name: input.customer.name,
      phone: input.customer.phone,
      email: input.customer.email || undefined,
      company: "Consumidor Final",
      tags: ["FestGO", "Brunch Mangais", "Pré-reserva"],
      customFields: {
        origem: "FestGO",
        evento: input.eventName,
        referencia: input.reference,
        plano: input.plan,
        estadoComercial: input.commercialStatus,
        recolhaPretendida: input.pickupPreference,
        lugaresPretendidos: input.seats.join(", "),
      },
    }),
  });
  if (!result.success || !result.contactId)
    throw new KukuGestError("O KukuGest devolveu uma resposta inválida.");
  return result;
}
