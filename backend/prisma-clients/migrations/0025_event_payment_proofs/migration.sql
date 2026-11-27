-- Paid events: attendees register on the event page with a proof of payment (image or PDF); the
-- business verifies it (review -> confirmed, or rejected with 2 hours to upload a new one).
-- Payment channels: up to 4 per event (a QR code image or bank details), shown on the form.
ALTER TABLE "booking"."event_tickets"
  ADD COLUMN "proof_file" VARCHAR(80),
  ADD COLUMN "proof_name" VARCHAR(200),
  ADD COLUMN "proof_type" VARCHAR(40),
  ADD COLUMN "proof_size" INTEGER,
  ADD COLUMN "proof_uploaded_at" TIMESTAMPTZ(3),
  ADD COLUMN "payment_note" VARCHAR(500),
  ADD COLUMN "reupload_by" TIMESTAMPTZ(3),
  ADD COLUMN "payment_reviewed_at" TIMESTAMPTZ(3),
  ADD COLUMN "payment_reviewed_by" VARCHAR(200);
CREATE INDEX "event_tickets_reupload_by_idx" ON "booking"."event_tickets"("reupload_by") WHERE "status" = 'rejected';

-- One live registration per email per event: payments being verified (or re-uploaded) count too.
DROP INDEX "booking"."event_tickets_event_id_email_live_key";
CREATE UNIQUE INDEX "event_tickets_event_id_email_live_key" ON "booking"."event_tickets"("event_id", lower("email")) WHERE "status" IN ('pending', 'review', 'rejected', 'confirmed');

CREATE TABLE "booking"."event_payment_channels" (
    "id" SERIAL NOT NULL,
    "event_id" INTEGER NOT NULL,
    "organization_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "type" VARCHAR(10) NOT NULL,
    "label" VARCHAR(60) NOT NULL,
    "bank_name" VARCHAR(100),
    "account_name" VARCHAR(120),
    "account_number" VARCHAR(60),
    "qr_file" VARCHAR(80),
    "qr_type" VARCHAR(40),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "event_payment_channels_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "event_payment_channels_event_id_idx" ON "booking"."event_payment_channels"("event_id");
ALTER TABLE "booking"."event_payment_channels" ADD CONSTRAINT "event_payment_channels_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "booking"."events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
