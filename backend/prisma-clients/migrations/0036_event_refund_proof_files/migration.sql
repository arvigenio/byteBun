-- Proofs of refund are kept (with the event's files), not only emailed.
ALTER TABLE "booking"."event_refunds"
  ADD COLUMN "proof_file" VARCHAR(80),
  ADD COLUMN "proof_type" VARCHAR(40);
