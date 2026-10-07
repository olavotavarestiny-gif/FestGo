import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
export const META_SITE = "https://festgo.mazanga.digital";
export const purchaseEventId = (reservationId: string) => `purchase:${reservationId}`;
export function metaHash(value: string) { return createHash("sha256").update(value.trim().toLowerCase()).digest("hex"); }
export function metaCustomer(customer: { id: string; fullName: string; phone: string; email: string | null }) {
  const names = customer.fullName.trim().toLowerCase().split(/\s+/);
  let phone = customer.phone.replace(/\D/g, "").replace(/^00/, "");
  if (phone.length === 9) phone = `244${phone}`;
  return { external_id: [metaHash(customer.id)], ph: [metaHash(phone)], country: [metaHash("ao")],
    ...(customer.email ? { em: [metaHash(customer.email)] } : {}),
    ...(names[0] ? { fn: [metaHash(names[0])] } : {}),
    ...(names.length > 1 ? { ln: [metaHash(names.at(-1)!)] } : {}) };
}
export type MetaServerEvent = { event_name: string; event_id: string; event_time: number; action_source: "website"; event_source_url: string; user_data: Record<string, unknown>; custom_data: Record<string, unknown> };
export async function sendMetaEvent(event: MetaServerEvent) {
  const token = process.env.META_CONVERSIONS_API_TOKEN;
  const pixel = process.env.NEXT_PUBLIC_META_PIXEL_ID;
  if (!token || !pixel) return false;
  const response = await fetch(`https://graph.facebook.com/v25.0/${pixel}/events`, {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ data: [event], ...(process.env.META_TEST_EVENT_CODE ? { test_event_code: process.env.META_TEST_EVENT_CODE } : {}) }),
    signal: AbortSignal.timeout(8000),
  });
  const result = await response.json();
  if (!response.ok || result.events_received !== 1) throw new Error("Meta rejected event");
  console.info("Meta CAPI accepted", event.event_name, event.event_id, result.events_received);
  return true;
}
// AuditLog is the durable outbox: queued in the same transaction as payment confirmation.
export async function flushMetaPurchases() {
  if (!process.env.META_CONVERSIONS_API_TOKEN) return;
  const pending = await prisma.auditLog.findMany({ where: { action: "META_PURCHASE_PENDING" }, orderBy: { createdAt: "asc" }, take: 20 });
  for (const job of pending) {
    try {
      await prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT "id" FROM "AuditLog" WHERE "id" = ${job.id} FOR UPDATE`;
        const current = await tx.auditLog.findUniqueOrThrow({ where: { id: job.id } });
        if (current.action !== "META_PURCHASE_PENDING") return;
        const event = current.metadata as unknown as MetaServerEvent;
        if (event.event_time < Math.floor(Date.now() / 1000) - 7 * 86400) {
          await tx.auditLog.update({ where: { id: job.id }, data: { action: "META_PURCHASE_EXPIRED" } }); return;
        }
        if (await sendMetaEvent(event)) await tx.auditLog.update({ where: { id: job.id }, data: { action: "META_PURCHASE_SENT" } });
      }, { timeout: 12000 });
    } catch { console.warn("Meta Purchase pending; retry with same event_id", job.id); }
  }
}
export const metaJson = (event: MetaServerEvent) => event as unknown as Prisma.InputJsonObject;
