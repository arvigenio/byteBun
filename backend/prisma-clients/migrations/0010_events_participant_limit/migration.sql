-- Catch-up for databases that ran an early version of 0008_events: the per-event participant limit
-- and the free plan's event limits. Safe to run again (a no-op where 0008 already did it).
ALTER TABLE "booking"."events" ADD COLUMN IF NOT EXISTS "participant_limit" INTEGER;

UPDATE "billing"."plans" SET "limits" = "limits" || '{"events.participants": 50, "events.per_day": 1}'::jsonb WHERE "code" = 'free';
INSERT INTO "billing"."entitlements" ("organization_id", "key", "value")
SELECT s."organization_id", k."key", k."value"
FROM "billing"."subscriptions" s
CROSS JOIN (VALUES ('limit:events.participants', 50), ('limit:events.per_day', 1)) AS k("key", "value")
WHERE s."plan_code" = 'free' AND s."status" <> 'cancelled'
ON CONFLICT DO NOTHING;
