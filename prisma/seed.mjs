import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const eventDate = new Date("2026-11-01T09:00:00.000Z"); // 10:00 em Luanda
const returnAt = new Date("2026-11-01T19:00:00.000Z"); // 20:00 em Luanda

try {
  const event = await prisma.event.upsert({
    where: { slug: "brunch-mangais" },
    update: {
      name: "FestGO — Brunch Mangais",
      venue: "Mangais Golf Resort",
      eventDate,
      returnAt,
      basePrice: 25000,
      currency: "AOA",
      capacity: 30,
      ticketIncludesEntry: false,
      status: "DRAFT",
    },
    create: {
      slug: "brunch-mangais",
      name: "FestGO — Brunch Mangais",
      venue: "Mangais Golf Resort",
      eventDate,
      returnAt,
      basePrice: 25000,
      currency: "AOA",
      capacity: 30,
      ticketIncludesEntry: false,
      status: "DRAFT",
    },
  });

  let route = await prisma.route.findFirst({
    where: { eventId: event.id, name: "Luanda · Talatona · Benfica" },
  });
  if (!route) {
    route = await prisma.route.create({
      data: {
        eventId: event.id,
        name: "Luanda · Talatona · Benfica",
        capacity: 30,
      },
    });
  } else {
    route = await prisma.route.update({
      where: { id: route.id },
      data: { capacity: 30, active: true },
    });
  }

  const points = [
    {
      name: "Cidade de Luanda",
      address: "Marginal — ponto exacto por SMS",
      at: "2026-11-01T06:30:00.000Z",
      sortOrder: 1,
    },
    {
      name: "Talatona",
      address: "Belas Shopping — entrada principal",
      at: "2026-11-01T07:10:00.000Z",
      sortOrder: 2,
    },
    {
      name: "Benfica",
      address: "Via Expressa — ponto FestGO",
      at: "2026-11-01T07:40:00.000Z",
      sortOrder: 3,
    },
  ];

  for (const point of points) {
    await prisma.pickupPoint.upsert({
      where: { routeId_name: { routeId: route.id, name: point.name } },
      update: {
        address: point.address,
        departureAt: new Date(point.at),
        sortOrder: point.sortOrder,
      },
      create: {
        routeId: route.id,
        name: point.name,
        address: point.address,
        departureAt: new Date(point.at),
        sortOrder: point.sortOrder,
      },
    });
  }

  console.log("FestGO Brunch Mangais preparado com as vendas fechadas.");
} finally {
  await prisma.$disconnect();
}
