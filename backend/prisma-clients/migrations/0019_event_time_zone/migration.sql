-- Each event has its own time zone (chosen when creating it; the creator's by default). Null:
-- events from before this use the business's time zone.
ALTER TABLE "booking"."events" ADD COLUMN "time_zone" VARCHAR(64);
