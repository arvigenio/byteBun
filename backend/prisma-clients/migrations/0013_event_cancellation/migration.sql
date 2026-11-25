-- Free events: attendees can cancel their own registration (a private link in their email).
-- Paid events can't be cancelled. A cancelled registration frees its place and the person can
-- register again.
ALTER TABLE "booking"."event_tickets" ADD COLUMN "manage_nonce" CHAR(32) NOT NULL DEFAULT md5(random()::text || clock_timestamp()::text);
ALTER TABLE "booking"."event_tickets" ADD COLUMN "cancelled_at" TIMESTAMPTZ(3);

ALTER TABLE "booking"."event_tickets" DROP CONSTRAINT "event_tickets_status_check";
ALTER TABLE "booking"."event_tickets" ADD CONSTRAINT "event_tickets_status_check" CHECK ("status" IN ('pending', 'confirmed', 'revoked', 'cancelled'));

DROP INDEX "booking"."event_tickets_event_id_email_live_key";
CREATE UNIQUE INDEX "event_tickets_event_id_email_live_key" ON "booking"."event_tickets"("event_id", lower("email")) WHERE "status" IN ('pending', 'confirmed');
