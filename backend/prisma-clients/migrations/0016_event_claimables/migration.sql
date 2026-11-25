-- Claimables: things attendees can claim at a free event (e.g. "Free Water", "Snack"). Each has
-- its own scanners (a scanner with a claimable_id scans claims; without one, attendance). An
-- attendee claims each item once. Limit per event: limit:events.claimables (free plan 2, premium
-- up to 15, to be set by Byte Bun).
CREATE TABLE "booking"."event_claimables" (
    "id" SERIAL NOT NULL,
    "event_id" INTEGER NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "event_claimables_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "event_claimables_event_id_idx" ON "booking"."event_claimables"("event_id");
ALTER TABLE "booking"."event_claimables" ADD CONSTRAINT "event_claimables_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "booking"."events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "booking"."event_scanners" ADD COLUMN "claimable_id" INTEGER;
CREATE INDEX "event_scanners_claimable_id_idx" ON "booking"."event_scanners"("claimable_id");
ALTER TABLE "booking"."event_scanners" ADD CONSTRAINT "event_scanners_claimable_id_fkey" FOREIGN KEY ("claimable_id") REFERENCES "booking"."event_claimables"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "booking"."event_claims" (
    "id" SERIAL NOT NULL,
    "claimable_id" INTEGER NOT NULL,
    "ticket_id" INTEGER NOT NULL,
    "organization_id" TEXT NOT NULL,
    "scanner_id" INTEGER,
    "claimed_by" VARCHAR(200),
    "claimed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "event_claims_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "event_claims_claimable_id_ticket_id_key" ON "booking"."event_claims"("claimable_id", "ticket_id");
CREATE INDEX "event_claims_ticket_id_idx" ON "booking"."event_claims"("ticket_id");
ALTER TABLE "booking"."event_claims" ADD CONSTRAINT "event_claims_claimable_id_fkey" FOREIGN KEY ("claimable_id") REFERENCES "booking"."event_claimables"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "booking"."event_claims" ADD CONSTRAINT "event_claims_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "booking"."event_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

UPDATE "billing"."plans" SET "limits" = "limits" || '{"events.claimables": 2}'::jsonb WHERE "code" IN ('free', 'bookings', 'starter');
UPDATE "billing"."plans" SET "limits" = "limits" || '{"events.claimables": 15}'::jsonb WHERE "code" IN ('premium', 'growth');
INSERT INTO "billing"."entitlements" ("organization_id", "key", "value")
SELECT s."organization_id", 'limit:events.claimables', CASE WHEN s."plan_code" IN ('premium', 'growth') THEN 15 ELSE 2 END
FROM "billing"."subscriptions" s
WHERE s."status" <> 'cancelled'
ON CONFLICT DO NOTHING;
