-- Scanners per claimable (e.g. Free Water): 2, premium plans up to 5. Attendance keeps
-- limit:events.scanners (2).
UPDATE "billing"."plans" SET "limits" = "limits" || '{"events.claimable_scanners": 2}'::jsonb WHERE "code" IN ('free', 'bookings', 'starter');
UPDATE "billing"."plans" SET "limits" = "limits" || '{"events.claimable_scanners": 5}'::jsonb WHERE "code" IN ('premium', 'growth');
INSERT INTO "billing"."entitlements" ("organization_id", "key", "value")
SELECT s."organization_id", 'limit:events.claimable_scanners', CASE WHEN s."plan_code" IN ('premium', 'growth') THEN 5 ELSE 2 END
FROM "billing"."subscriptions" s
WHERE s."status" <> 'cancelled'
ON CONFLICT DO NOTHING;
