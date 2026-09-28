import { prisma } from "@/lib/db";
import { staffFromRequest } from "@/lib/auth";
import {
  parseAdminReservationFilters,
  reservationWhere,
} from "@/lib/admin-reservations";

function csv(value: unknown) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

export async function GET(request: Request) {
  const user = await staffFromRequest(request, "ADMIN");
  if (!user) return new Response("Não autorizado.", { status: 401 });
  const query = new URL(request.url).searchParams;
  const filters = parseAdminReservationFilters({
    q: query.get("q") ?? undefined,
    event: query.get("event") ?? undefined,
    plan: query.get("plan") ?? undefined,
    pickup: query.get("pickup") ?? undefined,
    status: query.get("status") ?? undefined,
  });
  const rows = await prisma.reservation.findMany({
    where: reservationWhere(filters),
    include: {
      customer: true,
      passengers: true,
      seatPreferences: { where: { releasedAt: null }, orderBy: { seatNumber: "asc" } },
    },
    orderBy: { createdAt: "desc" },
  });
  const lines = [
    ["Referência", "Data", "Estado", "Estado comercial", "Responsável", "Telefone", "Email", "Plano", "Total Kz", "Passageiros", "Recolha pretendida", "Outro local", "Lugares pretendidos", "Origem", "UTM source", "UTM medium", "UTM campaign", "Consentimento promocional"]
      .map(csv).join(","),
    ...rows.map((row) => [
      row.reference,
      row.createdAt.toISOString(),
      row.status,
      row.contactStatus,
      row.customer.fullName,
      row.customer.phone,
      row.customer.email,
      row.plan,
      Number(row.totalAmount),
      row.passengers.map((passenger) => passenger.fullName).join(" | "),
      row.pickupPreference,
      row.pickupOther,
      row.seatPreferences.map((seat) => seat.seatNumber).join(" | "),
      row.campaignSource,
      row.utmSource,
      row.utmMedium,
      row.utmCampaign,
      row.customer.marketingConsent ? "SIM" : "NÃO",
    ].map(csv).join(",")),
  ];
  await prisma.auditLog.create({
    data: {
      userId: user.id,
      action: "PRE_RESERVATIONS_EXPORTED",
      entityType: "Event",
      metadata: { filters, rows: rows.length },
    },
  });
  return new Response(`\uFEFF${lines.join("\n")}`, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": "attachment; filename=festgo-pre-reservas.csv",
      "Cache-Control": "no-store",
    },
  });
}
