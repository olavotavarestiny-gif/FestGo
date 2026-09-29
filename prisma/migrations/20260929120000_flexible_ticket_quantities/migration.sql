ALTER TABLE "Event"
  ADD COLUMN "individualPrice" DECIMAL(12,2) NOT NULL DEFAULT 25000,
  ADD COLUMN "duoPrice" DECIMAL(12,2) NOT NULL DEFAULT 47500,
  ADD COLUMN "groupPrice" DECIMAL(12,2) NOT NULL DEFAULT 90000,
  ADD COLUMN "minorAgeLimit" INTEGER NOT NULL DEFAULT 18;

ALTER TABLE "Reservation"
  ADD COLUMN "pricingBreakdown" JSONB,
  ADD COLUMN "minorCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "minorAgeLimit" INTEGER NOT NULL DEFAULT 18,
  ADD COLUMN "minorGuardianName" TEXT,
  ADD COLUMN "minorGuardianPhone" TEXT;

ALTER TABLE "ReservationPassenger"
  ADD COLUMN "birthDate" DATE,
  ADD COLUMN "ageAtEvent" INTEGER,
  ADD COLUMN "isMinor" BOOLEAN;

CREATE INDEX "Reservation_minorCount_idx" ON "Reservation"("minorCount");
