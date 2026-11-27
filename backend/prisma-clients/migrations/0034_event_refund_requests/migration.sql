-- Refund requests: the business asks an attendee where to send their refund (a unique link);
-- they upload a QR code or enter bank details; it's completed with the proof of refund.
CREATE TABLE "booking"."event_refund_requests" (
    "id" SERIAL NOT NULL,
    "ticket_id" INTEGER NOT NULL,
    "organization_id" TEXT NOT NULL,
    "type" VARCHAR(10) NOT NULL,
    "amount_value" DECIMAL(12, 2),
    "currency" CHAR(3),
    "cancel" BOOLEAN NOT NULL DEFAULT false,
    "note" VARCHAR(500),
    "status" VARCHAR(10) NOT NULL DEFAULT 'waiting',
    "token_hash" CHAR(64),
    "method" VARCHAR(10),
    "bank_name" VARCHAR(100),
    "account_name" VARCHAR(120),
    "account_number" VARCHAR(60),
    "qr_file" VARCHAR(80),
    "qr_type" VARCHAR(40),
    "submitted_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "completed_by" VARCHAR(200),
    "refund_id" INTEGER,
    "created_by" VARCHAR(200) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "event_refund_requests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "event_refund_requests_type_check" CHECK ("type" IN ('full', 'partial')),
    CONSTRAINT "event_refund_requests_status_check" CHECK ("status" IN ('waiting', 'submitted', 'completed', 'cancelled'))
);
CREATE INDEX "event_refund_requests_ticket_id_idx" ON "booking"."event_refund_requests"("ticket_id");
ALTER TABLE "booking"."event_refund_requests" ADD CONSTRAINT "event_refund_requests_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "booking"."event_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
