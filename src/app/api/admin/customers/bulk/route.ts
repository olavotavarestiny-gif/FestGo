import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { staffFromRequest } from "@/lib/auth";
import { clientIp, enforceRateLimit } from "@/lib/rate-limit";
import {
  deleteCustomerRecords,
  deletableCustomerWhere,
  lockCustomerDeletionTargets,
} from "@/lib/admin-customer-deletion";

const schema = z.object({
  ids: z.array(z.string().min(8).max(40)).min(1).max(100),
});

export async function DELETE(request: Request) {
  const user = await staffFromRequest(request, "ADMIN");
  if (!user)
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "Selecciona contactos válidos." }, { status: 400 });
  const ids = [...new Set(parsed.data.ids)];
  try {
    await enforceRateLimit({
      namespace: "admin-delete-customers-bulk",
      identifier: user.id,
      limit: 6,
      windowMs: 60 * 60_000,
    });
  } catch {
    return NextResponse.json(
      { error: "Limite de eliminações em lote atingido. Tenta mais tarde." },
      { status: 429 },
    );
  }

  const result = await prisma.$transaction(async (tx) => {
    await lockCustomerDeletionTargets(tx, ids);
    const eligible = await tx.customer.findMany({
      where: { id: { in: ids }, ...deletableCustomerWhere },
      select: { id: true },
    });
    const eligibleIds = eligible.map((customer) => customer.id);
    const deleted = eligibleIds.length
      ? await deleteCustomerRecords(tx, eligibleIds)
      : { customersDeleted: 0, reservationsDeleted: 0 };
    await tx.auditLog.create({
      data: {
        userId: user.id,
        action: "UNCONVERTED_CONTACTS_BULK_DELETED",
        entityType: "Customer",
        metadata: {
          requested: ids.length,
          customersDeleted: deleted.customersDeleted,
          reservationsDeleted: deleted.reservationsDeleted,
          skipped: ids.length - deleted.customersDeleted,
        },
        ipAddress: clientIp(request),
      },
    });
    return {
      ...deleted,
      skipped: ids.length - deleted.customersDeleted,
    };
  });
  return NextResponse.json({ ok: true, ...result });
}
