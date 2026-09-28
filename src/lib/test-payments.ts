import { prisma } from "@/lib/db";
import {
  getPayment,
  listPaymentsSales,
  mapStatus,
  paymentMethodMatches,
  PaymentsApiError,
} from "@/lib/integrations/payments-api";

export const TEST_PRODUCT_ID = "20d032f3-e0c2-48d3-8ce1-c93bc682dd37";
export const TEST_AMOUNT = 100;
export const TEST_CURRENCY = "AOA";

function phoneDigits(value: string | undefined) {
  return value?.replace(/\D/g, "") ?? "";
}

export async function reconcileTestPayment(testPaymentId: string) {
  const local = await prisma.testPayment.findUnique({
    where: { id: testPaymentId },
    include: { testReservation: true },
  });
  if (!local?.providerPaymentId)
    throw new PaymentsApiError("Pagamento de teste não encontrado.", 404);
  const remote = await getPayment(local.providerPaymentId);
  if (
    remote.amount !== TEST_AMOUNT ||
    remote.currency !== TEST_CURRENCY ||
    !paymentMethodMatches(local.method, remote.payment_method) ||
    (remote.product_id && remote.product_id !== TEST_PRODUCT_ID) ||
    (remote.customer?.email &&
      remote.customer.email.toLowerCase() !==
        local.testReservation.customerEmail.toLowerCase()) ||
    (remote.customer?.phone &&
      phoneDigits(remote.customer.phone) !==
        phoneDigits(local.testReservation.customerPhone))
  )
    throw new PaymentsApiError(
      "O pagamento remoto não corresponde à reserva de teste.",
    );

  const status = mapStatus(remote.status);
  const result = await prisma.$transaction(async (tx) => {
    await tx.testPayment.update({
      where: { id: local.id },
      data: {
        status,
        rawStatus: remote.status,
        reconciledAt: new Date(),
      },
    });
    let ticket = await tx.testTicket.findUnique({
      where: { testReservationId: local.testReservationId },
    });
    if (status === "SUCCEEDED") {
      await tx.testReservation.update({
        where: { id: local.testReservationId },
        data: { status: "PAID" },
      });
      ticket = await tx.testTicket.upsert({
        where: { testReservationId: local.testReservationId },
        create: { testReservationId: local.testReservationId },
        update: {},
      });
    } else if (["FAILED", "CANCELLED"].includes(status)) {
      await tx.testReservation.update({
        where: { id: local.testReservationId },
        data: { status },
      });
    } else if (status === "PENDING") {
      await tx.testReservation.update({
        where: { id: local.testReservationId },
        data: { status: "AWAITING_PAYMENT" },
      });
    }
    return ticket;
  });
  return {
    status,
    rawStatus: remote.status,
    reference: local.testReservation.reference,
    amount: remote.amount,
    currency: remote.currency,
    providerPaymentId: local.providerPaymentId,
    ticketToken: result?.publicToken ?? null,
  };
}

export async function recoverTestPayment(testPaymentId: string) {
  const local = await prisma.testPayment.findUnique({
    where: { id: testPaymentId },
    include: { testReservation: true },
  });
  if (!local)
    throw new PaymentsApiError("Pagamento de teste não encontrado.", 404);
  if (local.providerPaymentId) return reconcileTestPayment(local.id);
  if (!['CREATED', 'PENDING', 'UNKNOWN'].includes(local.status)) return null;

  const sales = await listPaymentsSales();
  const alreadyLinked = new Set(
    (
      await prisma.testPayment.findMany({
        where: { providerPaymentId: { not: null } },
        select: { providerPaymentId: true },
      })
    )
      .map((payment) => payment.providerPaymentId)
      .filter((id): id is string => Boolean(id)),
  );
  const candidates = sales.filter((sale) => {
    const createdAt = new Date(sale.created_at).getTime();
    const elapsed = createdAt - local.createdAt.getTime();
    return (
      !alreadyLinked.has(sale.id) &&
      sale.product_id === TEST_PRODUCT_ID &&
      sale.amount === TEST_AMOUNT &&
      sale.currency === TEST_CURRENCY &&
      paymentMethodMatches(local.method, sale.payment_method) &&
      sale.customer_email?.toLowerCase() ===
        local.testReservation.customerEmail.toLowerCase() &&
      phoneDigits(sale.customer_phone) ===
        phoneDigits(local.testReservation.customerPhone) &&
      elapsed >= -30_000 &&
      elapsed <= 30 * 60_000
    );
  });
  if (candidates.length === 0) return null;
  if (candidates.length > 1)
    throw new PaymentsApiError(
      "Mais de uma transacção corresponde ao pagamento de teste.",
      409,
      "AMBIGUOUS_SALE_MATCH",
    );

  const candidate = candidates[0];
  const attached = await prisma.testPayment.updateMany({
    where: { id: local.id, providerPaymentId: null },
    data: {
      providerPaymentId: candidate.id,
      rawStatus: candidate.status,
      providerDetails: {
        recoveredAutomatically: true,
        saleCreatedAt: candidate.created_at,
      },
    },
  });
  if (!attached.count) {
    const current = await prisma.testPayment.findUniqueOrThrow({
      where: { id: local.id },
      select: { providerPaymentId: true },
    });
    if (current.providerPaymentId !== candidate.id)
      throw new PaymentsApiError(
        "O pagamento foi associado concorrentemente a outra transacção.",
        409,
        "CONCURRENT_SALE_MATCH",
      );
  }
  await prisma.auditLog.create({
    data: {
      action: "INTEGRATED_TEST_PAYMENT_ID_RECOVERED",
      entityType: "TestReservation",
      entityId: local.testReservationId,
      metadata: {
        providerPaymentId: candidate.id,
        match: "product+amount+currency+method+email+phone+time",
      },
    },
  });
  return reconcileTestPayment(local.id);
}

export function jsonObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
