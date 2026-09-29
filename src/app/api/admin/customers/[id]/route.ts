import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { staffFromRequest } from "@/lib/auth";
import { clientIp, enforceRateLimit } from "@/lib/rate-limit";
import {
  deleteCustomerRecords,
  deletableCustomerWhere,
  lockCustomerDeletionTargets,
} from "@/lib/admin-customer-deletion";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const user = await staffFromRequest(request, "ADMIN");
  if (!user)
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const { id } = await context.params;
  try {
    await enforceRateLimit({
      namespace: "admin-delete-customer",
      identifier: user.id,
      limit: 10,
      windowMs: 60 * 60_000,
    });
  } catch {
    return NextResponse.json(
      { error: "Limite de eliminações atingido. Tenta mais tarde." },
      { status: 429 },
    );
  }

  const customer = await prisma.customer.findUnique({ where: { id }, select: { id: true } });
  if (!customer)
    return NextResponse.json({ error: "Contacto não encontrado." }, { status: 404 });
  const result = await prisma.$transaction(async (tx) => {
    await lockCustomerDeletionTargets(tx, [id]);
    const eligible = await tx.customer.count({
      where: { id, ...deletableCustomerWhere },
    });
    if (!eligible) return null;
    const deleted = await deleteCustomerRecords(tx, [id]);
    await tx.auditLog.create({
      data: {
        userId: user.id,
        action: "UNCONVERTED_CONTACT_DELETED",
        entityType: "Customer",
        metadata: { reservationsDeleted: deleted.reservationsDeleted },
        ipAddress: clientIp(request),
      },
    });
    return deleted;
  });
  if (!result)
    return NextResponse.json(
      {
        error:
          "Este contacto possui pagamento, bilhete ou histórico comercial protegido e não pode ser eliminado.",
      },
      { status: 409 },
    );
  return NextResponse.json({ ok: true });
}
