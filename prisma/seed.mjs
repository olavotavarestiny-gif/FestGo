import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const eventDate = new Date("2026-11-01T09:00:00.000Z"); // 10:00 em Luanda
const returnAt = new Date("2026-11-01T19:00:00.000Z"); // 20:00 em Luanda

try {
  const event = await prisma.event.upsert({
    where: { slug: "brunch-mangais" },
    update: {}, // Preserve operator configuration when the seed is re-run.
    create: {
      slug: "brunch-mangais",
      name: "FestGO — Brunch Mangais",
      venue: "Mangais Golf Resort",
      eventDate,
      returnAt,
      basePrice: 25000,
      currency: "AOA",
      capacity: 45,
      ticketIncludesEntry: false,
      status: "DRAFT",
    },
  });

  let route = await prisma.route.findFirst({
    where: { eventId: event.id, name: "Preferências Luanda" },
  });
  if (!route) {
    route = await prisma.route.create({
      data: {
        eventId: event.id,
        name: "Preferências Luanda",
        capacity: 45,
      },
    });
  }

  const points = [
    {
      name: "Cidade — Primeiro de Maio",
      address: "Preferência; ponto exacto por confirmar",
      sortOrder: 1,
    },
    {
      name: "Talatona — Belas Shopping",
      address: "Preferência; ponto exacto por confirmar",
      sortOrder: 2,
    },
    {
      name: "11 de Novembro",
      address: "Preferência; ponto exacto por confirmar",
      sortOrder: 3,
    },
    {
      name: "Benfica — Girafa",
      address: "Preferência; ponto exacto por confirmar",
      sortOrder: 4,
    },
  ];

  for (const point of points) {
    await prisma.pickupPoint.upsert({
      where: { routeId_name: { routeId: route.id, name: point.name } },
      update: {
        sortOrder: point.sortOrder,
      },
      create: {
        route: { connect: { id: route.id } },
        name: point.name,
        address: point.address,
        departureAt: null,
        operationalConfirmed: false,
        sortOrder: point.sortOrder,
      },
    });
  }

  console.log("FestGO Brunch Mangais preparado com as vendas fechadas.");
} finally {
  await prisma.$disconnect();
}
