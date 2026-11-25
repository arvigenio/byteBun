-- Every event includes up to 50 participants, on every plan. More needs a voucher from Byte Bun
-- (bought per event: 51-300 $10, up to 500 $20, more: custom). One event a day stays free-plan only.
UPDATE "billing"."plans" SET "limits" = "limits" || '{"events.participants": 50}'::jsonb;
INSERT INTO "billing"."entitlements" ("organization_id", "key", "value")
SELECT s."organization_id", 'limit:events.participants', 50
FROM "billing"."subscriptions" s
WHERE s."status" <> 'cancelled'
ON CONFLICT DO NOTHING;
