-- Plans as sold on bytebuntech.com (prices in USD, not stored here):
--   free          Free            $0
--   bookings      Bookings Pro    $10/month, $100/year   unlimited bookings, history kept, branding,
--                                                        WhatsApp alerts to the OWNER (not customers)
--   premium       Premium         $60/month, $600/year   + reminders down to 1 hour, WhatsApp to customers
--   growth        Growth          $89/month, $890/year   (price pending confirmation)
-- "starter" is retired (no longer sold); existing subscriptions keep working.
-- New feature: bookings.whatsapp_alerts (owner alerts by WhatsApp). bookings.whatsapp now means
-- WhatsApp messages to customers.
UPDATE "billing"."plans" SET "name" = 'Bookings Pro',
  "features" = '{bookings.unlimited,bookings.full_branding,bookings.whatsapp_alerts}', "sort" = 10
WHERE "code" = 'bookings';

UPDATE "billing"."plans" SET "active" = false, "sort" = 90,
  "features" = array_append("features", 'bookings.whatsapp_alerts')
WHERE "code" = 'starter';

INSERT INTO "billing"."plans" ("code", "name", "apps", "features", "limits", "portal", "sort") VALUES
  ('premium', 'Premium', '{bookings}',
   '{bookings.unlimited,bookings.full_branding,bookings.custom_reminders,bookings.whatsapp,bookings.whatsapp_alerts}',
   '{"bookings.staff": 25}', true, 20),
  ('growth', 'Growth', '{bookings}',
   '{bookings.unlimited,bookings.full_branding,bookings.custom_reminders,bookings.whatsapp,bookings.whatsapp_alerts}',
   '{"bookings.staff": 50}', true, 30)
ON CONFLICT ("code") DO NOTHING;

-- Add-ons from the pricing page (features for the apps that exist; the rest are sold as services).
INSERT INTO "billing"."addons" ("code", "name", "apps", "features", "limits") VALUES
  ('website_chatbot', 'Website AI Chatbot', '{}', '{}', '{}'),
  ('social_chatbot', 'Social Media AI Chatbot', '{}', '{}', '{}'),
  ('email_marketing', 'Email Marketing', '{}', '{}', '{}'),
  ('missed_call_text_back', 'Missed Call Text Back', '{}', '{}', '{}'),
  ('recall_campaigns', 'Recall & Reactivation Campaigns', '{}', '{}', '{}'),
  ('intake_forms', 'Digital Intake Forms + E-Signature', '{}', '{}', '{}'),
  ('booking_deposits', 'Booking Deposits & No-Show Protection', '{}', '{}', '{}')
ON CONFLICT ("code") DO NOTHING;

-- Existing Bookings Pro / Starter clients get their entitlements rebuilt by the app on the next
-- plan change; rebuild the feature rows here so the split takes effect now.
DELETE FROM "billing"."entitlements" e USING "billing"."subscriptions" s
WHERE e."organization_id" = s."organization_id" AND s."plan_code" = 'bookings' AND e."key" IN ('feature:bookings.whatsapp', 'feature:bookings.custom_reminders');
INSERT INTO "billing"."entitlements" ("organization_id", "key", "value")
SELECT s."organization_id", 'feature:bookings.whatsapp_alerts', NULL FROM "billing"."subscriptions" s
WHERE s."plan_code" IN ('bookings', 'starter') AND s."status" <> 'cancelled'
ON CONFLICT DO NOTHING;
