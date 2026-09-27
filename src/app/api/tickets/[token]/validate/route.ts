import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";

const inputSchema = z.object({
  leg: z.enum(["OUTBOUND", "RETURN"]),
  operatorId: z.string().trim().min(2).max(80),
  deviceId: z.string().trim().max(120).optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const secret = process.env.TICKET_VALIDATION_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }
  const { token } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(token)) return NextResponse.json({ error: "Bilhete inválido." }, { status: 400 });
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Indica o trajecto e o operador." }, { status: 400 });

  const ticket = await prisma.ticket.findUnique({ where: { publicToken: token }, include: { passenger: true } });
  if (!ticket || ticket.status !== "VALID") return NextResponse.json({ error: "Bilhete inválido ou revogado." }, { status: 404 });
  try {
    const validation = await prisma.ticketValidation.create({
      data: { ticketId: ticket.id, leg: parsed.data.leg, operatorId: parsed.data.operatorId, deviceId: parsed.data.deviceId },
    });
    return NextResponse.json({ valid: true, passenger: ticket.passenger.fullName, leg: parsed.data.leg, validatedAt: validation.validatedAt });
  } catch (error) {
    if (typeof error === "object" && error && "code" in error && error.code === "P2002") {
      return NextResponse.json({ error: "Este trajecto já foi validado." }, { status: 409 });
    }
    return NextResponse.json({ error: "Não foi possível validar o bilhete." }, { status: 503 });
  }
}
