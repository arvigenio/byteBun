-- Attendance scanners are people: first and last name and a role ("Attendance" by default). Each
-- has a scanner code (its ID, in its link) and a secret access code; both are 8 characters and
-- unique. Only free-to-attend events have scanners: 2 per event on every plan.
ALTER TABLE "booking"."event_scanners" ADD COLUMN "first_name" VARCHAR(60) NOT NULL DEFAULT '';
ALTER TABLE "booking"."event_scanners" ADD COLUMN "last_name" VARCHAR(60) NOT NULL DEFAULT '';
ALTER TABLE "booking"."event_scanners" ADD COLUMN "role" VARCHAR(40) NOT NULL DEFAULT 'Attendance';
ALTER TABLE "booking"."event_scanners" ADD COLUMN "scanner_code" CHAR(8);
UPDATE "booking"."event_scanners" SET "first_name" = "label" WHERE "first_name" = '';
UPDATE "booking"."event_scanners" SET "scanner_code" = (
  SELECT string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + floor(random() * 31)::int, 1), '')
  FROM generate_series(1, 8) WHERE "event_scanners"."id" IS NOT NULL
);
ALTER TABLE "booking"."event_scanners" ALTER COLUMN "scanner_code" SET NOT NULL;
CREATE UNIQUE INDEX "event_scanners_scanner_code_key" ON "booking"."event_scanners"("scanner_code");
CREATE UNIQUE INDEX "event_scanners_code_hash_key" ON "booking"."event_scanners"("code_hash");
ALTER TABLE "booking"."event_scanners" ALTER COLUMN "label" DROP NOT NULL;

UPDATE "billing"."plans" SET "limits" = "limits" || '{"events.scanners": 2}'::jsonb;
INSERT INTO "billing"."entitlements" ("organization_id", "key", "value")
SELECT s."organization_id", 'limit:events.scanners', 2
FROM "billing"."subscriptions" s
WHERE s."status" <> 'cancelled'
ON CONFLICT DO NOTHING;
