-- Paid events: several proofs per registration (an additional proof for an insufficient amount),
-- requests for another or an additional proof (each with its own one-time upload link), and
-- refunds (full, optionally cancelling the registration, or partial for an excess amount).

CREATE TABLE "booking"."event_payment_proofs" (
    "id" SERIAL NOT NULL,
    "ticket_id" INTEGER NOT NULL,
    "organization_id" TEXT NOT NULL,
    "file" VARCHAR(80) NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "type" VARCHAR(40) NOT NULL,
    "size" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "event_payment_proofs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "event_payment_proofs_ticket_id_idx" ON "booking"."event_payment_proofs"("ticket_id");
ALTER TABLE "booking"."event_payment_proofs" ADD CONSTRAINT "event_payment_proofs_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "booking"."event_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The proofs already uploaded move to the new table.
INSERT INTO "booking"."event_payment_proofs" ("ticket_id", "organization_id", "file", "name", "type", "size", "created_at")
SELECT "id", "organization_id", "proof_file", COALESCE("proof_name", 'proof'), COALESCE("proof_type", 'application/octet-stream'), COALESCE("proof_size", 0), COALESCE("proof_uploaded_at", "created_at")
FROM "booking"."event_tickets" WHERE "proof_file" IS NOT NULL;

ALTER TABLE "booking"."event_tickets"
  DROP COLUMN "proof_file",
  DROP COLUMN "proof_name",
  DROP COLUMN "proof_type",
  DROP COLUMN "proof_size",
  DROP COLUMN "proof_uploaded_at",
  ADD COLUMN "proof_request" VARCHAR(12),
  ADD COLUMN "amount_due" VARCHAR(60),
  ADD COLUMN "upload_token_hash" CHAR(64);
-- Earlier rejections asked for a replacement (their links used the old format and stop working).
UPDATE "booking"."event_tickets" SET "proof_request" = 'replace' WHERE "status" = 'rejected';

CREATE TABLE "booking"."event_refunds" (
    "id" SERIAL NOT NULL,
    "ticket_id" INTEGER NOT NULL,
    "organization_id" TEXT NOT NULL,
    "type" VARCHAR(10) NOT NULL,
    "amount" VARCHAR(60),
    "cancelled" BOOLEAN NOT NULL DEFAULT false,
    "note" VARCHAR(500),
    "proof_name" VARCHAR(200),
    "created_by" VARCHAR(200) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "event_refunds_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "event_refunds_type_check" CHECK ("type" IN ('full', 'partial'))
);
CREATE INDEX "event_refunds_ticket_id_idx" ON "booking"."event_refunds"("ticket_id");
ALTER TABLE "booking"."event_refunds" ADD CONSTRAINT "event_refunds_ticket_id_fkey" FOREIGN KEY ("ticket_id") REFERENCES "booking"."event_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
