-- Events: one-time seminars and webinars, free or paid (paid: the business issues a code).
CREATE TABLE "booking"."events" (
    "id" SERIAL NOT NULL,
    "organization_id" TEXT NOT NULL,
    "slug" VARCHAR(80) NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "description" VARCHAR(20000),
    "kind" VARCHAR(8) NOT NULL DEFAULT 'free',
    "price_label" VARCHAR(60),
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "format" VARCHAR(8) NOT NULL DEFAULT 'onsite',
    "address" VARCHAR(300),
    "meeting_url" VARCHAR(500),
    "capacity" INTEGER,
    "participant_limit" INTEGER,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "events_kind_check" CHECK ("kind" IN ('free', 'paid')),
    CONSTRAINT "events_format_check" CHECK ("format" IN ('onsite', 'online')),
    CONSTRAINT "events_time_check" CHECK ("ends_at" > "starts_at")
);
CREATE UNIQUE INDEX "events_organization_id_slug_key" ON "booking"."events"("organization_id", "slug");
CREATE INDEX "events_organization_id_starts_at_idx" ON "booking"."events"("organization_id", "starts_at");

CREATE TABLE "booking"."event_tickets" (
    "id" SERIAL NOT NULL,
    "event_id" INTEGER NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "phone" VARCHAR(40),
    "code" CHAR(8) NOT NULL,
    "status" VARCHAR(10) NOT NULL DEFAULT 'confirmed',
    "source" VARCHAR(10) NOT NULL DEFAULT 'public',
    "confirmed_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "revoke_reason" VARCHAR(500),
    "checked_in_at" TIMESTAMPTZ(3),
    "checked_in_by" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "event_tickets_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "event_tickets_status_check" CHECK ("status" IN ('pending', 'confirmed', 'revoked'))
);
CREATE UNIQUE INDEX "event_tickets_organization_id_code_key" ON "booking"."event_tickets"("organization_id", "code");
CREATE INDEX "event_tickets_event_id_status_idx" ON "booking"."event_tickets"("event_id", "status");
-- One live registration per email and event (a revoked one doesn't count).
CREATE UNIQUE INDEX "event_tickets_event_id_email_live_key" ON "booking"."event_tickets"("event_id", lower("email")) WHERE "status" <> 'revoked';

ALTER TABLE "booking"."event_tickets" ADD CONSTRAINT "event_tickets_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "booking"."events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Free plan: events of up to 50 participants (bigger ones are bought per event: Byte Bun then
-- raises that event's participant_limit), and one event per day.
UPDATE "billing"."plans" SET "limits" = "limits" || '{"events.participants": 50, "events.per_day": 1}'::jsonb WHERE "code" = 'free';
INSERT INTO "billing"."entitlements" ("organization_id", "key", "value")
SELECT s."organization_id", k."key", k."value"
FROM "billing"."subscriptions" s
CROSS JOIN (VALUES ('limit:events.participants', 50), ('limit:events.per_day', 1)) AS k("key", "value")
WHERE s."plan_code" = 'free' AND s."status" <> 'cancelled'
ON CONFLICT DO NOTHING;
