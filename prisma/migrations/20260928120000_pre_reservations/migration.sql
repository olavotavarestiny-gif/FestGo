-- Extend the existing paid-reservation model without deleting historical data.
ALTER TYPE "ReservationStatus" ADD VALUE IF NOT EXISTS 'LEAD';
ALTER TYPE "ReservationStatus" ADD VALUE IF NOT EXISTS 'PRE_RESERVED';
ALTER TYPE "ReservationStatus" ADD VALUE IF NOT EXISTS 'PAYMENT_PENDING';
ALTER TYPE "ReservationStatus" ADD VALUE IF NOT EXISTS 'WAITLIST';

CREATE TYPE "CommercialPlan" AS ENUM ('INDIVIDUAL', 'DUO', 'DUO_INDIVIDUAL', 'GROUP');
CREATE TYPE "CommercialContactStatus" AS ENUM ('TO_CONTACT', 'CONTACTED', 'AWAITING_PAYMENT', 'NO_RESPONSE');
CREATE TYPE "SeatPreferenceStatus" AS ENUM ('PREFERRED', 'TEMPORARILY_HELD', 'CONFIRMED', 'RELEASED');

ALTER TABLE "Event"
  ADD COLUMN "estimatedTravelDuration" TEXT,
  ADD COLUMN "travelEstimateConfirmed" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "PickupPoint"
  ALTER COLUMN "departureAt" DROP NOT NULL,
  ADD COLUMN "operationalConfirmed" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Reservation"
  ALTER COLUMN "routeId" DROP NOT NULL,
  ALTER COLUMN "pickupPointId" DROP NOT NULL,
  ALTER COLUMN "holdExpiresAt" DROP NOT NULL,
  ADD COLUMN "plan" "CommercialPlan",
  ADD COLUMN "pickupPreference" TEXT,
  ADD COLUMN "pickupOther" TEXT,
  ADD COLUMN "contactStatus" "CommercialContactStatus" NOT NULL DEFAULT 'TO_CONTACT',
  ADD COLUMN "operationalConfirmed" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "termsAcceptedAt" TIMESTAMP(3),
  ADD COLUMN "campaignSource" TEXT,
  ADD COLUMN "utmSource" TEXT,
  ADD COLUMN "utmMedium" TEXT,
  ADD COLUMN "utmCampaign" TEXT,
  ADD COLUMN "utmContent" TEXT,
  ADD COLUMN "utmTerm" TEXT,
  ADD COLUMN "referralInput" TEXT;

ALTER TABLE "Notification"
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "CRMIntegrationJob" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'SALE';
DROP INDEX "CRMIntegrationJob_reservationId_key";
CREATE UNIQUE INDEX "CRMIntegrationJob_reservationId_kind_key" ON "CRMIntegrationJob"("reservationId", "kind");

CREATE TABLE "SeatPreference" (
  "id" TEXT NOT NULL,
  "eventId" TEXT NOT NULL,
  "reservationId" TEXT NOT NULL,
  "seatNumber" INTEGER NOT NULL,
  "status" "SeatPreferenceStatus" NOT NULL DEFAULT 'PREFERRED',
  "releasedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SeatPreference_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ContactActivity" (
  "id" TEXT NOT NULL,
  "reservationId" TEXT NOT NULL,
  "userId" TEXT,
  "outcome" "CommercialContactStatus" NOT NULL,
  "comment" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ContactActivity_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "SeatPreference_eventId_status_idx" ON "SeatPreference"("eventId", "status");
CREATE INDEX "SeatPreference_reservationId_idx" ON "SeatPreference"("reservationId");
CREATE UNIQUE INDEX "SeatPreference_active_seat_key"
  ON "SeatPreference"("eventId", "seatNumber") WHERE "releasedAt" IS NULL;
CREATE INDEX "ContactActivity_reservationId_createdAt_idx" ON "ContactActivity"("reservationId", "createdAt");

ALTER TABLE "SeatPreference" ADD CONSTRAINT "SeatPreference_eventId_fkey"
  FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SeatPreference" ADD CONSTRAINT "SeatPreference_reservationId_fkey"
  FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContactActivity" ADD CONSTRAINT "ContactActivity_reservationId_fkey"
  FOREIGN KEY ("reservationId") REFERENCES "Reservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContactActivity" ADD CONSTRAINT "ContactActivity_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
