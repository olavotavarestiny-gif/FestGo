import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import { processCRMJobs } from "@/lib/integrations/crm-jobs";

export type PaymentsApiMethod = "multicaixa" | "reference";

export type PaymentsApiCreateResult = {
  success: boolean;
  payment_id: string;
  status: string;
  payment_method: PaymentsApiMethod;
  total_amount: number;
  currency: string;
  message?: string;
  thank_you_url?: string;
  status_check_url?: string;
  reference?: { entity?: string; reference_number?: string; expiration_date?: string };
  instructions?: string;
  [key: string]: unknown;
};

type PaymentsApiStatusResult = {
  payment: {
    id: string;
    product_id?: string;
    amount: number;
    currency: string;
    status: string;
    payment_method: PaymentsApiMethod;
    customer?: { name?: string; email?: string; phone?: string };
    merchant_transaction_id?: string;
    paid_at?: string | null;
  };
};

export class PaymentsApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "PaymentsApiError";
  }
}

function config() {
  const apiKey = process.env.PAYMENTS_API_KEY ?? process.env.ApiKeyGo;
  const baseUrl = process.env.PAYMENTS_API_URL;
  if (!apiKey || !baseUrl) throw new PaymentsApiError("Falta configurar PAYMENTS_API_KEY e PAYMENTS_API_URL.");
  const url = new URL(baseUrl);
  if (url.protocol !== "https:" || url.hostname !== "rouxavcvorjiwhpjhsye.supabase.co") {
    throw new PaymentsApiError("PAYMENTS_API_URL não corresponde ao endpoint autorizado.");
  }
  return { apiKey, baseUrl: baseUrl.replace(/\/$/, "") };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const { apiKey, baseUrl } = config();
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { "x-api-key": apiKey, ...(init?.body ? { "Content-Type": "application/json" } : {}), ...init?.headers },
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new PaymentsApiError(data.error ?? "A API de pagamentos rejeitou o pedido.", response.status);
  return data;
}

export async function createPayment(input: {
  productId: string;
  quantity: number;
  method: PaymentsApiMethod;
  customer: { name: string; email: string; phone: string };
}) {
  if (!/^[0-9a-f-]{36}$/i.test(input.productId) || !Number.isInteger(input.quantity) || input.quantity < 1 || input.quantity > 6) {
    throw new PaymentsApiError("Produto ou quantidade inválida.");
  }
  const result = await request<PaymentsApiCreateResult>("/payments", {
    method: "POST",
    body: JSON.stringify({
      items: [{ product_id: input.productId, quantity: input.quantity }],
      payment_method: input.method,
      customer_name: input.customer.name,
      customer_email: input.customer.email,
      customer_phone: input.customer.phone,
    }),
  });
  if (!result.success || !result.payment_id || !Number.isFinite(result.total_amount)
    || result.currency !== "AOA" || result.payment_method !== input.method) {
    throw new PaymentsApiError("A API devolveu uma resposta de pagamento inválida.");
  }
  return result;
}

export async function getPayment(providerPaymentId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(providerPaymentId)) throw new PaymentsApiError("Identificador de pagamento inválido.");
  const result = await request<PaymentsApiStatusResult>(`/payment-status/${encodeURIComponent(providerPaymentId)}`);
  if (!result.payment || result.payment.id !== providerPaymentId) throw new PaymentsApiError("A API devolveu um pagamento inválido.");
  return result.payment;
}

function mapStatus(status: string) {
  switch (status.toLowerCase()) {
    case "paid":
    case "completed":
    case "succeeded": return "SUCCEEDED" as const;
    case "failed":
    case "expired": return "FAILED" as const;
    case "cancelled":
    case "canceled": return "CANCELLED" as const;
    case "refunded": return "REFUNDED" as const;
    case "unknown": return "UNKNOWN" as const;
    default: return "PENDING" as const;
  }
}

export async function reconcilePayment(localPaymentId: string) {
  const local = await prisma.payment.findUnique({
    where: { id: localPaymentId },
    include: { reservation: { include: { passengers: true, customer: true } } },
  });
  if (!local?.providerPaymentId) throw new PaymentsApiError("Pagamento não encontrado.", 404);
  const remote = await getPayment(local.providerPaymentId);
  const details = local.providerDetails && typeof local.providerDetails === "object" && !Array.isArray(local.providerDetails)
    ? local.providerDetails as Record<string, unknown> : {};
  if (remote.amount !== Number(local.amount) || remote.currency !== local.currency
    || remote.payment_method !== local.method || (remote.product_id && remote.product_id !== details.productId)
    || (remote.customer?.email && remote.customer.email.toLowerCase() !== local.reservation.customer.email?.toLowerCase())) {
    throw new PaymentsApiError("O pagamento remoto não corresponde à reserva guardada.");
  }

  const status = mapStatus(remote.status);
  await prisma.$transaction(async (tx) => {
    await tx.payment.update({ where: { id: local.id }, data: { status, rawStatus: remote.status, providerReference: remote.merchant_transaction_id ?? local.providerReference, reconciledAt: new Date() } });
    if (status === "SUCCEEDED") {
      await tx.reservation.update({ where: { id: local.reservationId }, data: { status: "PAID", paidAt: local.reservation.paidAt ?? new Date() } });
      await tx.ticket.createMany({ data: local.reservation.passengers.map((passenger) => ({ passengerId: passenger.id })), skipDuplicates: true });
      await tx.referralRedemption.updateMany({ where: { reservationId: local.reservationId, confirmedAt: null }, data: { confirmedAt: new Date() } });

      const existingCode = await tx.referralCode.findFirst({ where: { customerId: local.reservation.customerId } });
      if (!existingCode) {
        await tx.referralCode.create({
          data: { customerId: local.reservation.customerId, code: `FG${randomBytes(4).toString("hex").toUpperCase()}` },
        });
      }
      const crmJob = await tx.cRMIntegrationJob.findFirst({ where: { reservationId: local.reservationId } });
      if (!crmJob) await tx.cRMIntegrationJob.create({ data: { reservationId: local.reservationId } });
      const notification = await tx.notification.findFirst({
        where: { reservationId: local.reservationId, channel: "SMS", template: "BOOKING_PAID" },
      });
      if (!notification) {
        await tx.notification.create({
          data: { reservationId: local.reservationId, channel: "SMS", recipient: local.reservation.customer.phone, template: "BOOKING_PAID" },
        });
      }
    } else if (status === "REFUNDED") {
      await tx.reservation.update({ where: { id: local.reservationId }, data: { status: "REFUNDED" } });
      await tx.ticket.updateMany({ where: { passengerId: { in: local.reservation.passengers.map((passenger) => passenger.id) } }, data: { status: "REVOKED", revokedAt: new Date() } });
    } else if (status === "UNKNOWN") {
      await tx.reservation.update({ where: { id: local.reservationId }, data: { status: "PAYMENT_UNCERTAIN" } });
    } else if (status === "PENDING" && local.reservation.status !== "PAID") {
      await tx.reservation.update({ where: { id: local.reservationId }, data: { status: "AWAITING_PAYMENT" } });
    }
  });
  if (status === "SUCCEEDED") {
    await processCRMJobs({ reservationId: local.reservationId, limit: 1 });
  }
  return { status, rawStatus: remote.status, reservationReference: local.reservation.reference };
}
