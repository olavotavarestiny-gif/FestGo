import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  createPayment,
  normalizeProductId,
  paymentMethodMatches,
  paymentPageUrl,
  paymentProductMatches,
  PaymentsApiError,
  type PaymentsApiMethod,
} from "@/lib/integrations/payments-api";
import { prisma } from "@/lib/db";
import { verifyReservationToken } from "@/lib/reservation-access";
import { arePaymentsEnabled } from "@/lib/pre-reservations";

export const runtime = "nodejs";
const schema = z.object({
  reservationId: z.string().min(8).max(40),
  accessToken: z.string().min(32).max(100),
  method: z.literal("multicaixa"),
});

function detailsOf(value: Prisma.JsonValue | null) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function clientResult(
  reference: string,
  payment: {
    providerPaymentId: string | null;
    status: string;
    rawStatus: string | null;
    providerDetails: Prisma.JsonValue | null;
  },
) {
  return {
    reservationReference: reference,
    paymentId: payment.providerPaymentId,
    status: payment.rawStatus ?? payment.status,
    details: detailsOf(payment.providerDetails),
  };
}

export async function POST(request: Request) {
  if (!arePaymentsEnabled())
    return NextResponse.json(
      { error: "Os pagamentos estão desactivados durante as pré-reservas." },
      { status: 409 },
    );
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: "Pedido de pagamento inválido." },
      { status: 400 },
    );
  if (
    !verifyReservationToken(parsed.data.reservationId, parsed.data.accessToken)
  )
    return NextResponse.json(
      { error: "Reserva não autorizada." },
      { status: 403 },
    );
  try {
    const reservation = await prisma.reservation.findUnique({
      where: { id: parsed.data.reservationId },
      include: {
        customer: true,
        payments: { orderBy: { createdAt: "desc" }, take: 1 },
      },
    });
    if (!reservation)
      return NextResponse.json(
        { error: "Reserva não encontrada." },
        { status: 404 },
      );
    if (
      ["PAID", "CANCELLED", "EXPIRED", "REFUNDED"].includes(reservation.status)
    )
      return NextResponse.json(
        { error: "Esta reserva já não pode receber um pagamento." },
        { status: 409 },
      );
    if (
      ![
        "HELD",
        "PAYMENT_PENDING",
        "AWAITING_PAYMENT",
        "PAYMENT_UNCERTAIN",
      ].includes(reservation.status)
    )
      return NextResponse.json(
        {
          error:
            "A equipa FestGO ainda não enviou o convite de pagamento para esta pré-reserva.",
        },
        { status: 409 },
      );
    if (
      reservation.status !== "PAYMENT_UNCERTAIN" &&
      (!reservation.holdExpiresAt || reservation.holdExpiresAt <= new Date())
    ) {
      await prisma.reservation.update({
        where: { id: reservation.id },
        data: { status: "EXPIRED" },
      });
      return NextResponse.json(
        { error: "O prazo desta reserva expirou. Inicia uma nova reserva." },
        { status: 409 },
      );
    }

    const method = parsed.data.method as PaymentsApiMethod;
    let payment = reservation.payments[0];
    if (payment && ["CREATED", "PENDING", "UNKNOWN"].includes(payment.status)) {
      if (payment.provider !== "paygo" || payment.method !== method)
        return NextResponse.json(
          { error: "Já existe um pagamento em curso para esta reserva." },
          { status: 409 },
        );
      if (payment.providerPaymentId)
        return NextResponse.json(clientResult(reservation.reference, payment));
      return NextResponse.json(
        { ...clientResult(reservation.reference, payment), status: "UNKNOWN" },
        { status: 202 },
      );
    }

    const total = Number(reservation.totalAmount);
    const productVariables = {
      INDIVIDUAL: "PAYMENTS_PRODUCT_INDIVIDUAL_ID",
      DUO: "PAYMENTS_PRODUCT_DUO_ID",
      DUO_INDIVIDUAL: "PAYMENTS_PRODUCT_DUO_INDIVIDUAL_ID",
      GROUP: "PAYMENTS_PRODUCT_GROUP_ID",
    } as const;
    const productVariable = reservation.plan
      ? productVariables[reservation.plan]
      : undefined;
    const productId = productVariable
      ? normalizeProductId(process.env[productVariable])
      : undefined;
    if (!productId)
      return NextResponse.json(
        {
          error: "O produto deste plano ainda não está configurado.",
        },
        { status: 409 },
      );
    if (!(await paymentProductMatches(productId, total)))
      return NextResponse.json(
        { error: "O produto do plano não corresponde ao preço oficial." },
        { status: 409 },
      );

    payment = await prisma.payment.create({
      data: {
        reservationId: reservation.id,
        provider: "paygo",
        idempotencyKey: `festgo-${reservation.reference}-${crypto.randomUUID()}`,
        method,
        status: "CREATED",
        amount: reservation.totalAmount,
        currency: reservation.currency,
        providerDetails: { productId },
      },
    });

    try {
      const remote = await createPayment({
        productId,
        quantity: 1,
        method,
        customer: {
          name: reservation.customer.fullName,
          email: reservation.customer.email ?? "",
          phone: reservation.customer.phone,
        },
      });
      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          providerPaymentId: remote.payment_id,
          rawStatus: remote.status,
          status: "UNKNOWN",
          providerDetails: {
            productId,
            responseSource: remote.diagnostics.source,
            responseKeys: remote.diagnostics.responseKeys,
          },
        },
      });
      if (
        remote.total_amount !== total ||
        remote.currency !== reservation.currency ||
        !paymentMethodMatches(method, remote.payment_method)
      )
        throw new PaymentsApiError(
          "A resposta da API não corresponde ao total da reserva.",
        );
      const details = {
        productId,
        responseSource: remote.diagnostics.source,
        responseKeys: remote.diagnostics.responseKeys,
        entity: remote.reference?.entity ?? null,
        reference: remote.reference?.reference_number ?? null,
        expiresAt: remote.reference?.expiration_date ?? null,
        instructions: remote.instructions ?? remote.message ?? null,
        paymentUrl: paymentPageUrl(remote),
      };
      await prisma.$transaction([
        prisma.payment.update({
          where: { id: payment.id },
          data: {
            providerPaymentId: remote.payment_id,
            providerDetails: details,
            rawStatus: remote.status,
            status: "PENDING",
          },
        }),
        prisma.reservation.update({
          where: { id: reservation.id },
          data: { status: "AWAITING_PAYMENT" },
        }),
      ]);
      return NextResponse.json({
        reservationReference: reservation.reference,
        paymentId: remote.payment_id,
        status: remote.status,
        amount: remote.total_amount,
        method,
        details,
      });
    } catch (error) {
      if (
        error instanceof PaymentsApiError &&
        error.status &&
        error.status < 500
      ) {
        await prisma.payment.update({
          where: { id: payment.id },
          data: { status: "FAILED", rawStatus: `HTTP_${error.status}` },
        });
        return NextResponse.json({ error: error.message }, { status: 502 });
      }
      await prisma.$transaction([
        prisma.payment.update({
          where: { id: payment.id },
          data: { status: "UNKNOWN", rawStatus: "UNKNOWN" },
        }),
        prisma.reservation.update({
          where: { id: reservation.id },
          data: { status: "PAYMENT_UNCERTAIN" },
        }),
      ]);
      return NextResponse.json(
        { reservationReference: reservation.reference, status: "UNKNOWN" },
        { status: 202 },
      );
    }
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof PaymentsApiError
            ? error.message
            : "Não foi possível iniciar o pagamento.",
      },
      { status: 503 },
    );
  }
}
