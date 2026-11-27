-- Paid events: registrations are "reserved" (2 hours to send the proof of payment) before
-- "review"; when full, one person can join the "waitlist" and gets a freed spot in order.
CREATE INDEX "event_tickets_reserved_by_idx" ON "booking"."event_tickets"("reupload_by") WHERE "status" = 'reserved';
CREATE INDEX "event_tickets_waitlist_idx" ON "booking"."event_tickets"("event_id", "created_at") WHERE "status" = 'waitlist';
