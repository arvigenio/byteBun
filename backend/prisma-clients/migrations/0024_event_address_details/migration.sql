-- Onsite events: an optional complete address (floor, unit, landmarks, or a place the map search
-- can't find), shown with the address on the event page and in emails.
ALTER TABLE "booking"."events" ADD COLUMN "address_details" VARCHAR(300);
