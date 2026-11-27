-- Paid events' collections: what each confirmed registration paid, how and when (proof of
-- payment, an organizer code, Manual Register, or free).
ALTER TABLE "booking"."event_tickets"
  ADD COLUMN "payment_method" VARCHAR(10),
  ADD COLUMN "amount_paid" DECIMAL(12, 2),
  ADD COLUMN "paid_currency" CHAR(3),
  ADD COLUMN "paid_at" TIMESTAMPTZ(3);
CREATE INDEX "event_tickets_event_id_paid_at_idx" ON "booking"."event_tickets"("event_id", "paid_at");

-- Registrations confirmed before this: paid the event's price (proof or organizer code).
UPDATE "booking"."event_tickets" t
SET "payment_method" = CASE WHEN t."source" = 'payment' THEN 'proof' ELSE 'code' END,
    "amount_paid" = e."price",
    "paid_currency" = e."currency",
    "paid_at" = COALESCE(t."confirmed_at", t."created_at")
FROM "booking"."events" e
WHERE e."id" = t."event_id" AND e."kind" = 'paid' AND t."status" IN ('confirmed', 'revoked') AND t."confirmed_at" IS NOT NULL;
