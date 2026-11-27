-- Bulk bookings: a refund request can cover the whole booking (every spot of the group).
ALTER TABLE "booking"."event_refund_requests"
  ADD COLUMN "whole_booking" BOOLEAN NOT NULL DEFAULT false;
