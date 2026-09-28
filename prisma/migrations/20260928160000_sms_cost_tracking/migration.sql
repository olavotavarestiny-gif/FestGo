-- Additive SMS cost and audit metadata. Existing notifications are preserved.
ALTER TABLE "Notification"
  ADD COLUMN "providerStatus" TEXT,
  ADD COLUMN "content" TEXT,
  ADD COLUMN "encoding" TEXT,
  ADD COLUMN "characterCount" INTEGER,
  ADD COLUMN "segmentCount" INTEGER,
  ADD COLUMN "lastError" TEXT,
  ADD COLUMN "requestedById" TEXT;

CREATE INDEX "Notification_requestedById_createdAt_idx"
  ON "Notification"("requestedById", "createdAt");

ALTER TABLE "Notification"
  ADD CONSTRAINT "Notification_requestedById_fkey"
  FOREIGN KEY ("requestedById") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
