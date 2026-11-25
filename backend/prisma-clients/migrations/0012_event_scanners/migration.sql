-- Event scanners: a link (scanner.bytebuntech.com/{business}/{event}/{id}) plus an 8-character access
-- code; the first device to enter the code gets the scanner, nobody else can. Codes and device
-- sessions are stored as SHA-256 hashes. Free plan: 2 scanners per event.
CREATE TABLE "booking"."event_scanners" (
    "id" SERIAL NOT NULL,
    "event_id" INTEGER NOT NULL,
    "organization_id" TEXT NOT NULL,
    "public_id" UUID NOT NULL,
    "label" VARCHAR(60) NOT NULL,
    "code_hash" CHAR(64),
    "code_created_at" TIMESTAMPTZ(3),
    "redeemed_at" TIMESTAMPTZ(3),
    "session_hash" CHAR(64),
    "last_seen_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "event_scanners_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "event_scanners_public_id_key" ON "booking"."event_scanners"("public_id");
CREATE INDEX "event_scanners_event_id_idx" ON "booking"."event_scanners"("event_id");
ALTER TABLE "booking"."event_scanners" ADD CONSTRAINT "event_scanners_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "booking"."events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The registration button's text, chosen by the business ("Register for free" by default).
ALTER TABLE "booking"."events" ADD COLUMN IF NOT EXISTS "register_label" VARCHAR(40);

UPDATE "billing"."plans" SET "limits" = "limits" || '{"events.scanners": 2}'::jsonb WHERE "code" = 'free';
INSERT INTO "billing"."entitlements" ("organization_id", "key", "value")
SELECT s."organization_id", 'limit:events.scanners', 2
FROM "billing"."subscriptions" s
WHERE s."plan_code" = 'free' AND s."status" <> 'cancelled'
ON CONFLICT DO NOTHING;
