import { Prisma, ReservationStatus } from "@prisma/client";

export const deletableReservationStatuses: ReservationStatus[] = [
  "LEAD",
  "PRE_RESERVED",
  "WAITLIST",
  "CANCELLED",
  "EXPIRED",
];

export const deletableCustomerWhere = {
  reservations: {
    none: {
      OR: [
        { status: { notIn: deletableReservationStatuses } },
        { payments: { some: {} } },
        { passengers: { some: { ticket: { isNot: null } } } },
      ],
    },
  },
  referralCodes: { none: { redemptions: { some: {} } } },
} satisfies Prisma.CustomerWhereInput;

export async function lockCustomerDeletionTargets(
  tx: Prisma.TransactionClient,
  customerIds: string[],
) {
  if (!customerIds.length) return;
  await tx.$queryRaw`SELECT "id" FROM "Customer" WHERE "id" IN (${Prisma.join(customerIds)}) FOR UPDATE`;
  await tx.$queryRaw`SELECT "id" FROM "Reservation" WHERE "customerId" IN (${Prisma.join(customerIds)}) FOR UPDATE`;
}

export async function deleteCustomerRecords(
  tx: Prisma.TransactionClient,
  customerIds: string[],
) {
  const reservations = await tx.reservation.findMany({
    where: { customerId: { in: customerIds } },
    select: { id: true },
  });
  const reservationIds = reservations.map((reservation) => reservation.id);
  if (reservationIds.length) {
    await tx.notification.deleteMany({
      where: { reservationId: { in: reservationIds } },
    });
    await tx.cRMIntegrationJob.deleteMany({
      where: { reservationId: { in: reservationIds } },
    });
    await tx.referralRedemption.deleteMany({
      where: { reservationId: { in: reservationIds } },
    });
    await tx.reservation.deleteMany({
      where: { id: { in: reservationIds } },
    });
  }
  await tx.referralCode.deleteMany({
    where: { customerId: { in: customerIds } },
  });
  const deleted = await tx.customer.deleteMany({
    where: { id: { in: customerIds } },
  });
  return { customersDeleted: deleted.count, reservationsDeleted: reservationIds.length };
}
