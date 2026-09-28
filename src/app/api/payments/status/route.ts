import { NextResponse } from "next/server";
import { z } from "zod";
import { reconcilePayment } from "@/lib/integrations/payments-api";
import { prisma } from "@/lib/db";
import { verifyReservationToken } from "@/lib/reservation-access";
import { clientIp, enforceRateLimit } from "@/lib/rate-limit";
import { schedulePostPaymentJobs } from "@/lib/schedule-jobs";
import { arePaymentsEnabled } from "@/lib/pre-reservations";
import { createTicketBundleToken } from "@/lib/ticket-access";

export const runtime = "nodejs";
const schema = z.object({
  reservationId: z.string().min(8).max(40),
  accessToken: z.string().min(32).max(100),
});

export async function POST(request: Request) {
  if (!arePaymentsEnabled())
    return NextResponse.json(
      { error: "Os pagamentos estão desactivados durante as pré-reservas." },
      { status: 409 },
    );
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });
  if (
    !verifyReservationToken(parsed.data.reservationId, parsed.data.accessToken)
  )
    return NextResponse.json(
      { error: "Reserva não autorizada." },
      { status: 403 },
    );
  try {
    await enforceRateLimit({
      namespace: "payment-status",
      identifier: clientIp(request),
      limit: 30,
      windowMs: 10 * 60_000,
    });
    const reservation = await prisma.reservation.findUnique({
      where: { id: parsed.data.reservationId },
      include: {
        event: true,
        payments: {
          where: { provider: "paygo" },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });
    const payment = reservation?.payments[0];
    if (!payment?.providerPaymentId)
      return NextResponse.json(
        { error: "Ainda não existe pagamento consultável." },
        { status: 404 },
      );
    const result = await reconcilePayment(payment.id);
    if (result.status === "SUCCEEDED") schedulePostPaymentJobs(request);
    const ticketUrl =
      result.status === "SUCCEEDED" && reservation
        ? (() => {
            const expiry = new Date(
              (reservation.event.returnAt ?? reservation.event.eventDate).getTime() +
                7 * 24 * 60 * 60_000,
            );
            const token = createTicketBundleToken(
              reservation.reference,
              expiry,
            );
            return `/reserva/${encodeURIComponent(reservation.reference)}/bilhetes?token=${encodeURIComponent(token)}`;
          })()
        : undefined;
    return NextResponse.json({ ...result, ticketUrl });
  } catch (error) {
    if (
      typeof error === "object" &&
      error &&
      "status" in error &&
      error.status === 429
    )
      return NextResponse.json(
        { error: "Demasiadas consultas. Aguarda alguns minutos." },
        { status: 429 },
      );
    return NextResponse.json(
      { error: "Não foi possível consultar o estado do pagamento." },
      { status: 503 },
    );
  }
}
