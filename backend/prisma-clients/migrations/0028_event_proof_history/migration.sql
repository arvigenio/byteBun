-- Proofs of payment: when a file is deleted (approved, rejected, refunded, replaced), its row stays
-- as the registration's upload history.
ALTER TABLE "booking"."event_payment_proofs"
  ADD COLUMN "deleted_at" TIMESTAMPTZ(3),
  ADD COLUMN "deleted_reason" VARCHAR(20);
