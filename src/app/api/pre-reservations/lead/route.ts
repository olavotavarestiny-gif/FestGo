import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { clientIp, enforceRateLimit } from "@/lib/rate-limit";
import { createReservationToken, verifyReservationToken } from "@/lib/reservation-access";
import {
  calculateTicketPricing,
  isPreReservationMode,
  legacyPlanForQuantity,
  normalizeAngolanPhone,
  pickupPreferences,
} from "@/lib/pre-reservations";

export const runtime = "nodejs";

const schema = z
  .object({
    name: z.string().trim().min(4).max(120),
    phone: z.string().trim().min(9).max(24),
    email: z.string().trim().email().max(254).optional().or(z.literal("")),
    quantity: z.number().int().min(1).max(100),
    pickupPreference: z.enum([
      "CIDADE_PRIMEIRO_MAIO",
      "TALATONA_BELAS",
      "11_NOVEMBRO",
      "BENFICA_GIRAFA",
      "OUTRO",
    ]),
    pickupOther: z.string().trim().max(160).optional().default(""),
    returnArea: z.string().trim().max(160).optional().default(""),
    playlistSuggestion: z.string().trim().max(160).optional().default(""),
    kidsInterest: z.boolean().default(false),
    dataConsent: z.literal(true),
    marketingConsent: z.boolean().default(false),
    idempotencyKey: z.string().uuid(),
    campaignSource: z.string().trim().max(120).optional(),
    utmSource: z.string().trim().max(120).optional(),
    utmMedium: z.string().trim().max(120).optional(),
    utmCampaign: z.string().trim().max(160).optional(),
    utmContent: z.string().trim().max(160).optional(),
    utmTerm: z.string().trim().max(160).optional(),
    referral: z.string().trim().max(80).optional(),
    reservationId: z.string().min(8).max(40).optional(),
    accessToken: z.string().min(32).max(100).optional(),
  })
  .superRefine((value, context) => {
    if (value.pickupPreference === "OUTRO" && value.pickupOther.length < 3) {
      context.addIssue({
        code: "custom",
        path: ["pickupOther"],
        message: "Indica a localização pretendida.",
      });
    }
  });

export async function POST(request: Request) {
  if (!isPreReservationMode())
    return NextResponse.json(
      { error: "As pré-reservas ainda não estão abertas." },
      { status: 409 },
    );
  if (!process.env.DATABASE_URL)
    return NextResponse.json(
      { error: "A base de dados ainda não está configurada." },
      { status: 503 },
    );

  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Confirma os teus dados." },
      { status: 400 },
    );
  const input = parsed.data;
  const phone = normalizeAngolanPhone(input.phone);
  if (!phone)
    return NextResponse.json(
      { error: "Indica um número de telemóvel angolano válido." },
      { status: 400 },
    );
  if (
    (input.reservationId || input.accessToken) &&
    (!input.reservationId ||
      !input.accessToken ||
      !verifyReservationToken(input.reservationId, input.accessToken))
  )
    return NextResponse.json({ error: "Inscrição não autorizada." }, { status: 403 });

  try {
    await Promise.all([
      enforceRateLimit({
        namespace: "pre-reservation-lead-ip",
        identifier: clientIp(request),
        limit: 20,
        windowMs: 60 * 60_000,
      }),
      enforceRateLimit({
        namespace: "pre-reservation-lead-phone",
        identifier: phone,
        limit: 6,
        windowMs: 24 * 60 * 60_000,
      }),
    ]);
    const event = await prisma.event.findUnique({
      where: { slug: "brunch-mangais" },
    });
    if (!event || ["CANCELLED", "CLOSED"].includes(event.status))
      return NextResponse.json(
        { error: "As pré-reservas não estão disponíveis neste momento." },
        { status: 409 },
      );

    const activeSeats = await prisma.seatPreference.count({
      where: { eventId: event.id, status: "CONFIRMED", releasedAt: null },
    });
    const available = Math.max(0, event.capacity - activeSeats);
    if (input.quantity > event.capacity || input.quantity > available)
      return NextResponse.json(
        { error: `Existem apenas ${available} lugares disponíveis.` },
        { status: 409 },
      );
    const pricing = calculateTicketPricing(input.quantity, {
      individual: Number(event.individualPrice),
      duo: Number(event.duoPrice),
      group: Number(event.groupPrice),
    });
    const plan = legacyPlanForQuantity(input.quantity);
    const pickup = pickupPreferences.find(
      (option) => option.code === input.pickupPreference,
    );
    if (!pickup)
      return NextResponse.json(
        { error: "Preferência de recolha inválida." },
        { status: 400 },
      );

    const result = await prisma.$transaction(async (tx) => {
      if (input.reservationId) {
        const draft = await tx.reservation.findUnique({
          where: { id: input.reservationId },
        });
        if (!draft || draft.eventId !== event.id || draft.status !== "LEAD")
          throw new Error("LEAD_NOT_EDITABLE");
        await tx.customer.update({
          where: { id: draft.customerId },
          data: {
            fullName: input.name,
            phone,
            email: input.email || null,
            marketingConsent: input.marketingConsent,
            consentUpdatedAt: new Date(),
          },
        });
        return tx.reservation.update({
          where: { id: draft.id },
          data: {
            plan,
            pickupPreference: pickup.label,
            pickupOther: input.pickupPreference === "OUTRO" ? input.pickupOther : null,
            quantity: input.quantity,
            unitPrice: pricing.listTotal / input.quantity,
            discountAmount: pricing.discount,
            totalAmount: pricing.total,
            pricingBreakdown: pricing.composition,
            termsAcceptedAt: new Date(),
            campaignSource: input.campaignSource || null,
            utmSource: input.utmSource || null,
            utmMedium: input.utmMedium || null,
            utmCampaign: input.utmCampaign || null,
            utmContent: input.utmContent || null,
            utmTerm: input.utmTerm || null,
            referralInput: input.referral || null,
          },
        });
      }
      const customer = await tx.customer.upsert({
        where: { phone },
        update: {
          fullName: input.name,
          email: input.email || null,
          marketingConsent: input.marketingConsent,
          consentUpdatedAt: new Date(),
        },
        create: {
          fullName: input.name,
          phone,
          email: input.email || null,
          marketingConsent: input.marketingConsent,
          consentUpdatedAt: new Date(),
        },
      });
      const byKey = await tx.reservation.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      });
      if (byKey) return byKey;

      const existing = await tx.reservation.findFirst({
        where: {
          eventId: event.id,
          customerId: customer.id,
          status: { in: ["LEAD", "PRE_RESERVED", "PAYMENT_PENDING", "WAITLIST"] },
        },
        orderBy: { createdAt: "desc" },
      });
      const data = {
        plan,
        pickupPreference: pickup.label,
        pickupOther:
          input.pickupPreference === "OUTRO" ? input.pickupOther : null,
        quantity: input.quantity,
        unitPrice: pricing.listTotal / input.quantity,
        discountAmount: pricing.discount,
        totalAmount: pricing.total,
        pricingBreakdown: pricing.composition,
        termsAcceptedAt: new Date(),
        campaignSource: input.campaignSource || null,
        utmSource: input.utmSource || null,
        utmMedium: input.utmMedium || null,
        utmCampaign: input.utmCampaign || null,
        utmContent: input.utmContent || null,
        utmTerm: input.utmTerm || null,
        referralInput: input.referral || null,
      } as const;
      if (existing?.status === "LEAD")
        return tx.reservation.update({ where: { id: existing.id }, data });
      if (existing) return existing;
      return tx.reservation.create({
        data: {
          ...data,
          reference: `FGP-${new Date().getFullYear()}-${randomBytes(4).toString("hex").toUpperCase()}`,
          eventId: event.id,
          customerId: customer.id,
          status: "LEAD",
          currency: "AOA",
          idempotencyKey: input.idempotencyKey,
        },
      });
    });

    if (result.status !== "LEAD")
      return NextResponse.json(
        {
          error: "Já existe uma inscrição activa para este contacto.",
          reference: result.reference,
        },
        { status: 409 },
      );

    await prisma.$transaction([
      prisma.auditLog.deleteMany({
        where: {
          action: "EXPERIENCE_PREFERENCES_UPDATED",
          entityType: "Reservation",
          entityId: result.id,
          userId: null,
        },
      }),
      prisma.auditLog.create({
        data: {
          action: "EXPERIENCE_PREFERENCES_UPDATED",
          entityType: "Reservation",
          entityId: result.id,
          metadata: {
            returnArea: input.returnArea || null,
            playlistSuggestion: input.playlistSuggestion || null,
            kidsInterest: input.kidsInterest,
          },
          ipAddress: clientIp(request),
        },
      }),
    ]);

    return NextResponse.json(
      {
        reservationId: result.id,
        accessToken: createReservationToken(result.id),
        reference: result.reference,
      },
      { status: 201 },
    );
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    )
      return NextResponse.json(
        { error: "Este contacto já tem uma inscrição activa." },
        { status: 409 },
      );
    if (error instanceof Error && error.message === "LEAD_NOT_EDITABLE")
      return NextResponse.json(
        { error: "Esta inscrição já não pode ser alterada." },
        { status: 409 },
      );
    if (
      typeof error === "object" &&
      error &&
      "status" in error &&
      error.status === 429
    )
      return NextResponse.json(
        { error: "Limite atingido. Tenta novamente mais tarde." },
        { status: 429 },
      );
    return NextResponse.json(
      { error: "Não foi possível guardar o contacto. Tenta novamente." },
      { status: 503 },
    );
  }
}
