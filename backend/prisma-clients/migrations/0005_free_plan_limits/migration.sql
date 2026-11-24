-- Free plan: 100 bookings a month (was 60) and 5 active services (was 3).
UPDATE "billing"."plans"
SET "limits" = "limits" || '{"bookings.monthly": 100, "bookings.services": 5}'::jsonb
WHERE "code" = 'free';

-- Existing Free businesses get the new limits now (an add-on may already have raised one: keep the higher value).
UPDATE "billing"."entitlements" e
SET "value" = GREATEST(COALESCE(e."value", 0), CASE e."key" WHEN 'limit:bookings.monthly' THEN 100 ELSE 5 END)
FROM "billing"."subscriptions" s
WHERE e."organization_id" = s."organization_id"
  AND s."plan_code" = 'free'
  AND e."key" IN ('limit:bookings.monthly', 'limit:bookings.services');
