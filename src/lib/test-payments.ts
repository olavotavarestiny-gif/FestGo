import { prisma } from "@/lib/db";
import {
  getPayment,
  mapStatus,
  paymentMethodMatches,
  PaymentsApiError,
} from "@/lib/integrations/payments-api";

export const TEST_PRODUCT_ID = "20d032f3-e0c2-48d3-8ce1-c93bc682dd37";
export const TEST_AMOUNT = 100;
export const TEST_CURRENCY = "AOA";

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
        local.testReservation.customerEmail.toLowerCase())
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

export function jsonObject(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
