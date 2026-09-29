import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { staffFromRequest } from "@/lib/auth";
import { clientIp } from "@/lib/rate-limit";

const schema = z.object({
  duration: z.string().trim().max(120),
  confirmed: z.boolean(),
  individualPrice: z.number().int().min(1).max(10_000_000),
  duoPrice: z.number().int().min(1).max(10_000_000),
  groupPrice: z.number().int().min(1).max(10_000_000),
  minorAgeLimit: z.number().int().min(1).max(25),
}).superRefine((value, context) => {
  if (value.confirmed && value.duration.length < 3)
    context.addIssue({ code: "custom", path: ["duration"], message: "Indica uma duração validada." });
});

export async function PATCH(request: Request) {
  const user = await staffFromRequest(request, "ADMIN");
  if (!user)
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos." }, { status: 400 });
  const event = await prisma.event.update({
    where: { slug: "brunch-mangais" },
    data: {
      estimatedTravelDuration: parsed.data.duration || null,
      travelEstimateConfirmed: parsed.data.confirmed,
      individualPrice: parsed.data.individualPrice,
      duoPrice: parsed.data.duoPrice,
      groupPrice: parsed.data.groupPrice,
      minorAgeLimit: parsed.data.minorAgeLimit,
    },
  });
  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: "TRAVEL_ESTIMATE_UPDATED",
      entityType: "Event",
      entityId: event.id,
      metadata: {
        confirmed: parsed.data.confirmed,
        individualPrice: parsed.data.individualPrice,
        duoPrice: parsed.data.duoPrice,
        groupPrice: parsed.data.groupPrice,
        minorAgeLimit: parsed.data.minorAgeLimit,
      },
      ipAddress: clientIp(request),
    },
  });
  return NextResponse.json({ ok: true });
}
