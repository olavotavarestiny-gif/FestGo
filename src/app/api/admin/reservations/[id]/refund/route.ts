import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { staffFromRequest } from "@/lib/auth";
import { clientIp } from "@/lib/rate-limit";

const inputSchema = z.object({
  reason: z.enum(["CUSTOMER", "OPERATOR"]),
  requestedAt: z.string().datetime().optional(),
  refundedAmount: z.number().positive(),
  providerRefundReference: z.string().trim().min(5).max(160),
}).strict();

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await staffFromRequest(request, "ADMIN");
  if (!user) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Indica o motivo, o valor e a referência do reembolso já efectuado." }, { status: 400 });
  const { id } = await params;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const identity = await tx.reservation.findUnique({ where: { id }, select: { eventId: true } });
      if (!identity) throw new Error("Reserva não encontrada.");
      await tx.$queryRaw`SELECT "id" FROM "Event" WHERE "id" = ${identity.eventId} FOR UPDATE`;
      const reservation = await tx.reservation.findUniqueOrThrow({ where: { id }, include: { event: true, payments: { where: { status: { in: ["SUCCEEDED", "REFUNDED"] } } } } });
      const existing = await tx.auditLog.findFirst({ where: { entityType: "Reservation", entityId: id, action: "REFUND_CONFIRMED_MANUALLY" }, orderBy: { createdAt: "desc" } });
      if (reservation.status === "REFUNDED" && existing && typeof existing.metadata === "object" && existing.metadata && !Array.isArray(existing.metadata) && existing.metadata.providerRefundReference === parsed.data.providerRefundReference)
        return { duplicate: true };
      if (reservation.status !== "PAID") throw new Error("A reserva não está paga ou já foi reembolsada.");
      const payment = reservation.payments.find((item) => item.status === "SUCCEEDED");
      if (!payment) throw new Error("Não há pagamento confirmado para esta reserva.");
      const total = Number(reservation.totalAmount);
      if (parsed.data.refundedAmount > total) throw new Error("O valor reembolsado excede o pagamento.");
      if (parsed.data.reason === "CUSTOMER") {
        const requestedAt = parsed.data.requestedAt ? new Date(parsed.data.requestedAt) : null;
        const cutoff = new Date(reservation.event.eventDate.getTime() - 7 * 24 * 60 * 60_000);
        if (!requestedAt || requestedAt > new Date() || requestedAt > cutoff) throw new Error("O pedido do cliente chegou depois do limite de 7 dias.");
        if (parsed.data.refundedAmount !== Math.round(total * 50) / 100) throw new Error("O reembolso normal deve ser exactamente 50% do valor pago.");
      }
      const now = new Date();
      await tx.payment.update({ where: { id: payment.id }, data: { status: "REFUNDED", reconciledAt: now } });
      await tx.reservation.update({ where: { id }, data: { status: "REFUNDED" } });
      await tx.ticket.updateMany({ where: { passenger: { reservationId: id }, status: { not: "REVOKED" } }, data: { status: "REVOKED", revokedAt: now } });
      await tx.seatPreference.updateMany({ where: { reservationId: id, releasedAt: null }, data: { status: "RELEASED", releasedAt: now } });
      await tx.auditLog.create({ data: {
        userId: user.id, action: "REFUND_CONFIRMED_MANUALLY", entityType: "Reservation", entityId: id,
        metadata: { reason: parsed.data.reason, requestedAt: parsed.data.requestedAt ?? null, refundedAmount: parsed.data.refundedAmount, providerRefundReference: parsed.data.providerRefundReference, paymentId: payment.id },
        ipAddress: clientIp(request),
      } });
      return { duplicate: false };
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    const known = ["Reserva não encontrada.", "A reserva não está paga ou já foi reembolsada.", "Não há pagamento confirmado para esta reserva.", "O valor reembolsado excede o pagamento.", "O pedido do cliente chegou depois do limite de 7 dias.", "O reembolso normal deve ser exactamente 50% do valor pago."];
    return NextResponse.json({ error: error instanceof Error && known.includes(error.message) ? error.message : "Não foi possível registar o reembolso." }, { status: 409 });
  }
}
