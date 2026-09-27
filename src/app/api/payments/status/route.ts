import { NextResponse } from "next/server";
import { z } from "zod";
import { reconcilePayment } from "@/lib/integrations/payments-api";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
const schema = z.object({ reservationId: z.string().min(8).max(40) });

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });
  try {
    const reservation = await prisma.reservation.findUnique({ where: { id: parsed.data.reservationId }, include: { payments: { where: { provider: "paygo" }, orderBy: { createdAt: "desc" }, take: 1 } } });
    const payment = reservation?.payments[0];
    if (!payment?.providerPaymentId) return NextResponse.json({ error: "Ainda não existe pagamento consultável." }, { status: 404 });
    return NextResponse.json(await reconcilePayment(payment.id));
  } catch {
    return NextResponse.json({ error: "Não foi possível consultar o estado do pagamento." }, { status: 503 });
  }
}
