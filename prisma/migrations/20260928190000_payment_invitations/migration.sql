-- Individual, revocable payment invitations. No payment is created by this migration.
CREATE TABLE "PaymentInvitation" (
  "id" TEXT NOT NULL,
  "reservationId" TEXT NOT NULL,
  "nonce" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "confirmedAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PaymentInvitation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PaymentInvitation_reservationId_key"
  ON "PaymentInvitation"("reservationId");
CREATE INDEX "PaymentInvitation_expiresAt_idx"
  ON "PaymentInvitation"("expiresAt");
CREATE INDEX "PaymentInvitation_createdById_createdAt_idx"
  ON "PaymentInvitation"("createdById", "createdAt");

ALTER TABLE "PaymentInvitation"
  ADD CONSTRAINT "PaymentInvitation_reservationId_fkey"
  FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PaymentInvitation"
  ADD CONSTRAINT "PaymentInvitation_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
