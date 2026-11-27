-- Paid events: the "reserved" and "waitlist" statuses.
ALTER TABLE "booking"."event_tickets" DROP CONSTRAINT "event_tickets_status_check";
ALTER TABLE "booking"."event_tickets" ADD CONSTRAINT "event_tickets_status_check" CHECK ("status" IN ('pending', 'reserved', 'waitlist', 'review', 'rejected', 'confirmed', 'revoked', 'cancelled'));
