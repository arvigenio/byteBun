-- The same email address may register more than once for an event (e.g. someone registering
-- family members or colleagues): no more one-registration-per-email rule.
DROP INDEX IF EXISTS "booking"."event_tickets_event_id_email_live_key";
CREATE INDEX IF NOT EXISTS "event_tickets_event_id_email_idx" ON "booking"."event_tickets"("event_id", lower("email"));
