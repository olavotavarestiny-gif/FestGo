import { prisma } from "@/lib/db";
import { staffFromRequest } from "@/lib/auth";

function csv(value: unknown) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}
export async function GET(request: Request) {
  const user = await staffFromRequest(request, "ADMIN");
  if (!user) return new Response("Não autorizado.", { status: 401 });
  const rows = await prisma.reservationPassenger.findMany({
    where: {
      reservation: { event: { slug: "brunch-mangais" }, status: "PAID" },
    },
    include: {
      reservation: { include: { customer: true, pickupPoint: true } },
      ticket: { include: { validations: true } },
    },
    orderBy: { fullName: "asc" },
  });
  const lines = [
    [
      "Reserva",
      "Passageiro",
      "Comprador",
      "Telefone",
      "Embarque",
      "Bilhete",
      "Ida",
      "Volta",
    ]
      .map(csv)
      .join(","),
    ...rows.map((row) =>
      [
        row.reservation.reference,
        row.fullName,
        row.reservation.customer.fullName,
        row.reservation.customer.phone,
        row.reservation.pickupPoint.name,
        row.ticket?.status ?? "NÃO EMITIDO",
        row.ticket?.validations.some((value) => value.leg === "OUTBOUND")
          ? "SIM"
          : "NÃO",
        row.ticket?.validations.some((value) => value.leg === "RETURN")
          ? "SIM"
          : "NÃO",
      ]
        .map(csv)
        .join(","),
    ),
  ];
  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: "PASSENGERS_EXPORTED",
      entityType: "Event",
    },
  });
  return new Response(`\uFEFF${lines.join("\n")}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": "attachment; filename=festgo-passageiros.csv",
      "Cache-Control": "no-store",
    },
  });
}
