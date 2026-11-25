-- Onsite events: the exact map pin (chosen from address suggestions, or dragged), used for
-- "Open in Google Maps" on the event page and in emails. Both or neither.
ALTER TABLE "booking"."events" ADD COLUMN "latitude" DOUBLE PRECISION;
ALTER TABLE "booking"."events" ADD COLUMN "longitude" DOUBLE PRECISION;
ALTER TABLE "booking"."events" ADD CONSTRAINT "events_pin_check" CHECK (("latitude" IS NULL) = ("longitude" IS NULL) AND ("latitude" IS NULL OR ("latitude" BETWEEN -90 AND 90 AND "longitude" BETWEEN -180 AND 180)));
