import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { staffFromRequest } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { normalizeAngolanPhone, pickupPreferences } from "@/lib/pre-reservations";
import { clientIp, enforceRateLimit } from "@/lib/rate-limit";

const schema = z.object({
  passengerName: z.string().trim().min(3).max(120),
  email: z.string().trim().email().max(254),
  phone: z.string().trim().min(9).max(24),
  plan: z.enum(["INDIVIDUAL", "DUO", "GROUP"]),
  testSeat: z.string().trim().min(2).max(20),
  pickupPreference: z.enum([
    "CIDADE_PRIMEIRO_MAIO",
    "TALATONA_BELAS",
    "11_NOVEMBRO",
    "BENFICA_GIRAFA",
    "OUTRO",
  ]),
  pickupOther: z.string().trim().max(160).optional().default(""),
});

export async function POST(request: Request) {
  const user = await staffFromRequest(request, "ADMIN");
  if (!user)
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Dados de teste inválidos." },
      { status: 400 },
    );
  const phone = normalizeAngolanPhone(parsed.data.phone);
  const pickup = pickupPreferences.find(
    (item) => item.code === parsed.data.pickupPreference,
  );
  if (!phone || !pickup)
    return NextResponse.json(
      { error: "Telefone ou recolha inválidos." },
      { status: 400 },
    );
  if (
    parsed.data.pickupPreference === "OUTRO" &&
    parsed.data.pickupOther.length < 3
  )
    return NextResponse.json(
      { error: "Indica a localização de teste." },
      { status: 400 },
    );
  try {
    await enforceRateLimit({
      namespace: "admin-test-reservation",
      identifier: user.id,
      limit: 5,
      windowMs: 60 * 60_000,
    });
    const reservation = await prisma.$transaction(async (tx) => {
      const created = await tx.testReservation.create({
        data: {
          reference: `TESTE-${new Date().getFullYear()}-${randomBytes(4).toString("hex").toUpperCase()}`,
          plan: parsed.data.plan,
          passengerName: parsed.data.passengerName,
          customerEmail: parsed.data.email,
          customerPhone: phone,
          testSeat: parsed.data.testSeat,
          pickupPreference:
            parsed.data.pickupPreference === "OUTRO"
              ? parsed.data.pickupOther
              : pickup.label,
          createdById: user.id,
        },
      });
      await tx.auditLog.create({
        data: {
          userId: user.id,
          action: "INTEGRATED_TEST_RESERVATION_CREATED",
          entityType: "TestReservation",
          entityId: created.id,
          metadata: { reference: created.reference },
          ipAddress: clientIp(request),
        },
      });
      return created;
    });
    return NextResponse.json({
      ok: true,
      reference: reservation.reference,
      url: `https://festgo.mazanga.digital/admin/teste-gateway/reserva/${reservation.accessToken}`,
    });
  } catch (error) {
    if (
      typeof error === "object" &&
      error &&
      "status" in error &&
      error.status === 429
    )
      return NextResponse.json(
        { error: "Limite de reservas de teste atingido." },
        { status: 429 },
      );
    return NextResponse.json(
      { error: "Não foi possível criar a reserva de teste." },
      { status: 503 },
    );
  }
}
