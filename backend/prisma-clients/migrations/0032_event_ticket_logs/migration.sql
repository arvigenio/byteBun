-- A registration's activity log: every action on it, who did it and when.
CREATE TABLE "booking"."event_ticket_logs" (
    "id" SERIAL NOT NULL,
    "ticket_id" INTEGER NOT NULL,
    "organization_id" TEXT NOT NULL,
    "action" VARCHAR(30) NOT NULL,
    "by" VARCHAR(200),
    "detail" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "event_ticket_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "event_ticket_logs_ticket_id_created_at_idx" ON "booking"."event_ticket_logs"("ticket_id", "created_at");
ALTER TABLE "booking"."event_ticket_logs" ADD CONSTRAINT "event_ticket_logs_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "booking"."event_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Registrations made before this: their history, rebuilt from what was recorded.
INSERT INTO "booking"."event_ticket_logs" ("ticket_id", "organization_id", "action", "by", "detail", "created_at")
SELECT "id", "organization_id",
  CASE "source" WHEN 'business' THEN 'code_issued' WHEN 'manual' THEN 'registered_manually' ELSE 'registered' END,
  CASE WHEN "source" IN ('public', 'payment') THEN 'Attendee' END,
  CASE "source" WHEN 'public' THEN 'On the event page' WHEN 'payment' THEN 'On the event page, with a proof of payment' END,
  "created_at"
FROM "booking"."event_tickets";

INSERT INTO "booking"."event_ticket_logs" ("ticket_id", "organization_id", "action", "by", "detail", "created_at")
SELECT "ticket_id", "organization_id", 'proof_uploaded', 'Attendee', "name", "created_at" FROM "booking"."event_payment_proofs";

INSERT INTO "booking"."event_ticket_logs" ("ticket_id", "organization_id", "action", "by", "detail", "created_at")
SELECT "id", "organization_id", 'payment_approved', "payment_reviewed_by", NULL, COALESCE("payment_reviewed_at", "confirmed_at")
FROM "booking"."event_tickets" WHERE "source" = 'payment' AND "confirmed_at" IS NOT NULL;

INSERT INTO "booking"."event_ticket_logs" ("ticket_id", "organization_id", "action", "by", "detail", "created_at")
SELECT "id", "organization_id", 'code_used', 'Attendee', 'Registered with the organizer’s code', "confirmed_at"
FROM "booking"."event_tickets" WHERE "source" = 'business' AND "confirmed_at" IS NOT NULL;

INSERT INTO "booking"."event_ticket_logs" ("ticket_id", "organization_id", "action", "by", "detail", "created_at")
SELECT "ticket_id", "organization_id", CASE "type" WHEN 'partial' THEN 'partial_refund' ELSE 'full_refund' END, "created_by",
  NULLIF(concat_ws(' · ', "amount", CASE WHEN "cancelled" THEN 'Registration cancelled' END, "note"), ''), "created_at"
FROM "booking"."event_refunds";

INSERT INTO "booking"."event_ticket_logs" ("ticket_id", "organization_id", "action", "by", "detail", "created_at")
SELECT "id", "organization_id", 'checked_in', NULL, NULL, "checked_in_at" FROM "booking"."event_tickets" WHERE "checked_in_at" IS NOT NULL;

INSERT INTO "booking"."event_ticket_logs" ("ticket_id", "organization_id", "action", "by", "detail", "created_at")
SELECT c."ticket_id", c."organization_id", 'claimed', c."claimed_by", k."name", c."claimed_at"
FROM "booking"."event_claims" c JOIN "booking"."event_claimables" k ON k."id" = c."claimable_id";

INSERT INTO "booking"."event_ticket_logs" ("ticket_id", "organization_id", "action", "by", "detail", "created_at")
SELECT "id", "organization_id", 'revoked', NULL, "revoke_reason", "revoked_at" FROM "booking"."event_tickets" WHERE "revoked_at" IS NOT NULL;

INSERT INTO "booking"."event_ticket_logs" ("ticket_id", "organization_id", "action", "by", "detail", "created_at")
SELECT "id", "organization_id", 'cancelled', 'Attendee', NULL, "cancelled_at" FROM "booking"."event_tickets" WHERE "cancelled_at" IS NOT NULL;
