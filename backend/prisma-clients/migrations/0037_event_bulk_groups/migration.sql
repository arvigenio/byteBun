-- Bulk bookings: the places booked together (one name and email, one proof of payment, verified
-- together) share a group id.
ALTER TABLE "booking"."event_tickets"
  ADD COLUMN "group_id" VARCHAR(36),
  ADD COLUMN "group_size" INTEGER;
CREATE INDEX "event_tickets_group_id_idx" ON "booking"."event_tickets"("group_id");
