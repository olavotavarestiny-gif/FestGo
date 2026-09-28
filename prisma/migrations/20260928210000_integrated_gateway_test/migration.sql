-- Fully isolated administrative purchase test. No official reservation, seat or ticket is referenced.
CREATE TABLE "TestReservation" (
  "id" TEXT NOT NULL,
  "reference" TEXT NOT NULL,
  "accessToken" TEXT NOT NULL,
  "eventName" TEXT NOT NULL DEFAULT 'FestGO — Brunch Mangais',
  "plan" "CommercialPlan" NOT NULL,
  "passengerName" TEXT NOT NULL,
  "customerEmail" TEXT NOT NULL,
  "customerPhone" TEXT NOT NULL,
  "testSeat" TEXT NOT NULL,
  "pickupPreference" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'READY',
  "createdById" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TestReservation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TestPayment" (
  "id" TEXT NOT NULL,
  "testReservationId" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'paygo',
  "providerPaymentId" TEXT,
  "idempotencyKey" TEXT NOT NULL,
  "productId" TEXT NOT NULL,
  "method" TEXT NOT NULL,
  "status" "PaymentStatus" NOT NULL DEFAULT 'CREATED',
  "amount" DECIMAL(12,2) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'AOA',
  "providerDetails" JSONB,
  "rawStatus" TEXT,
  "reconciledAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TestPayment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TestPaymentWebhookEvent" (
  "id" TEXT NOT NULL,
  "testPaymentId" TEXT NOT NULL,
  "providerEventId" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "signatureValid" BOOLEAN NOT NULL,
  "processedAt" TIMESTAMP(3),
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TestPaymentWebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TestTicket" (
  "id" TEXT NOT NULL,
  "testReservationId" TEXT NOT NULL,
  "publicToken" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'VALID',
  "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TestTicket_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TestTicketValidation" (
  "id" TEXT NOT NULL,
  "ticketId" TEXT NOT NULL,
  "leg" "TicketLeg" NOT NULL,
  "validatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "operatorId" TEXT NOT NULL,
  "deviceId" TEXT,
  CONSTRAINT "TestTicketValidation_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TestReservation_reference_key" ON "TestReservation"("reference");
CREATE UNIQUE INDEX "TestReservation_accessToken_key" ON "TestReservation"("accessToken");
CREATE INDEX "TestReservation_createdById_createdAt_idx" ON "TestReservation"("createdById", "createdAt");
CREATE INDEX "TestReservation_status_createdAt_idx" ON "TestReservation"("status", "createdAt");
CREATE UNIQUE INDEX "TestPayment_testReservationId_key" ON "TestPayment"("testReservationId");
CREATE UNIQUE INDEX "TestPayment_providerPaymentId_key" ON "TestPayment"("providerPaymentId");
CREATE UNIQUE INDEX "TestPayment_idempotencyKey_key" ON "TestPayment"("idempotencyKey");
CREATE INDEX "TestPayment_status_createdAt_idx" ON "TestPayment"("status", "createdAt");
CREATE UNIQUE INDEX "TestPaymentWebhookEvent_providerEventId_key" ON "TestPaymentWebhookEvent"("providerEventId");
CREATE INDEX "TestPaymentWebhookEvent_testPaymentId_receivedAt_idx" ON "TestPaymentWebhookEvent"("testPaymentId", "receivedAt");
CREATE UNIQUE INDEX "TestTicket_testReservationId_key" ON "TestTicket"("testReservationId");
CREATE UNIQUE INDEX "TestTicket_publicToken_key" ON "TestTicket"("publicToken");
CREATE UNIQUE INDEX "TestTicketValidation_ticketId_leg_key" ON "TestTicketValidation"("ticketId", "leg");
CREATE INDEX "TestTicketValidation_validatedAt_idx" ON "TestTicketValidation"("validatedAt");

ALTER TABLE "TestReservation" ADD CONSTRAINT "TestReservation_createdById_fkey"
  FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TestPayment" ADD CONSTRAINT "TestPayment_testReservationId_fkey"
  FOREIGN KEY ("testReservationId") REFERENCES "TestReservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TestPaymentWebhookEvent" ADD CONSTRAINT "TestPaymentWebhookEvent_testPaymentId_fkey"
  FOREIGN KEY ("testPaymentId") REFERENCES "TestPayment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TestTicket" ADD CONSTRAINT "TestTicket_testReservationId_fkey"
  FOREIGN KEY ("testReservationId") REFERENCES "TestReservation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TestTicketValidation" ADD CONSTRAINT "TestTicketValidation_ticketId_fkey"
  FOREIGN KEY ("ticketId") REFERENCES "TestTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TestTicketValidation" ADD CONSTRAINT "TestTicketValidation_operatorId_fkey"
  FOREIGN KEY ("operatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
