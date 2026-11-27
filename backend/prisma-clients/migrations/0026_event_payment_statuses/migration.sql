-- Paid events with a proof of payment: "review" (to verify) and "rejected" (2 hours to upload a
-- new one) are registration statuses too.
ALTER TABLE "booking"."event_tickets" DROP CONSTRAINT "event_tickets_status_check";
ALTER TABLE "booking"."event_tickets" ADD CONSTRAINT "event_tickets_status_check" CHECK ("status" IN ('pending', 'review', 'rejected', 'confirmed', 'revoked', 'cancelled'));
