-- Event scanners have an email: their scanner code and access code are sent there (and a new
-- access code too). Older scanners (before this) have none.
ALTER TABLE "booking"."event_scanners" ADD COLUMN "email" VARCHAR(254) NOT NULL DEFAULT '';
