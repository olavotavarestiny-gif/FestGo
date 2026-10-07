import { after, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { clientIp, enforceRateLimit } from "@/lib/rate-limit";
import { verifyReservationToken } from "@/lib/reservation-access";
import { META_SITE, metaCustomer, sendMetaEvent } from "@/lib/meta-server";
export const runtime = "nodejs";
const schema = z.object({ name: z.enum(["PageView", "ViewContent", "InitiateCheckout", "AddPaymentInfo"]), eventId: z.string().min(8).max(100), path: z.string().max(200), data: z.object({ content_name: z.string().max(100).optional(), content_type: z.literal("product").optional() }).optional(), reservationId: z.string().max(40).optional(), accessToken: z.string().max(100).optional() });
export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return new NextResponse(null, { status: 403 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return new NextResponse(null, { status: 400 });
  const body = parsed.data;
  if (!/^\/(?:$|reservar$|checkout\/[a-zA-Z0-9_-]+$|pagamento$)/.test(body.path)) return new NextResponse(null, { status: 400 });
  try {
    await enforceRateLimit({ namespace: "meta", identifier: clientIp(request), limit: 60, windowMs: 60000 });
    let user: Record<string, unknown> = {};
    let data: Record<string, unknown> = body.data ?? {};
    if (body.name === "AddPaymentInfo") {
      if (!body.reservationId || !body.accessToken || !verifyReservationToken(body.reservationId, body.accessToken)) return new NextResponse(null, { status: 403 });
      const reservation = await prisma.reservation.findUnique({ where: { id: body.reservationId }, include: { customer: true } });
      if (!reservation || !["HELD", "PAYMENT_PENDING", "AWAITING_PAYMENT"].includes(reservation.status)) return new NextResponse(null, { status: 409 });
      user = metaCustomer(reservation.customer); data = { value: Number(reservation.totalAmount), currency: "AOA" };
    }
    const cookies = new Map((request.headers.get("cookie") ?? "").split(";").map(item => { const [key, ...rest] = item.trim().split("="); return [key, rest.join("=")]; }));
    for (const [cookie, field] of [["_fbp", "fbp"], ["_fbc", "fbc"]]) { const value = cookies.get(cookie); if (value && /^fb\.\d+\.\d+\.[\w.-]+$/.test(value) && value.length < 250) user[field] = value; }
    const ip = clientIp(request); if (ip !== "unknown") user.client_ip_address = ip;
    user.client_user_agent = request.headers.get("user-agent") ?? "";
    if (body.name === "AddPaymentInfo" && body.reservationId) await prisma.auditLog.create({ data: { action: "META_MATCH_CONTEXT", entityType: "Reservation", entityId: body.reservationId, metadata: { ...user } as import("@prisma/client").Prisma.InputJsonObject } });
    after(async () => { try { await sendMetaEvent({ event_name: body.name, event_id: body.eventId, event_time: Math.floor(Date.now()/1000), action_source: "website", event_source_url: META_SITE + body.path, user_data: user, custom_data: data }); } catch { console.warn("Meta browser mirror rejected", body.name); } });
    return new NextResponse(null, { status: 202 });
  } catch { return new NextResponse(null, { status: 429 }); }
}
