-- Proofs of payment are kept (with their files) until the event is deleted: "deleted" becomes
-- what became of each one (replaced, approved, rejected, refunded, expired, removed).
ALTER TABLE "booking"."event_payment_proofs" RENAME COLUMN "deleted_at" TO "outcome_at";
ALTER TABLE "booking"."event_payment_proofs" RENAME COLUMN "deleted_reason" TO "outcome";

-- Money: a business currency (the default wherever a currency is chosen), paid events' price and
-- currency (price_label stays as the formatted text), and refunds' amount and currency.
ALTER TABLE "booking"."settings" ADD COLUMN "currency" CHAR(3) NOT NULL DEFAULT 'PHP';
ALTER TABLE "booking"."events" ADD COLUMN "price" DECIMAL(12, 2), ADD COLUMN "currency" CHAR(3);
ALTER TABLE "booking"."event_refunds" ADD COLUMN "amount_value" DECIMAL(12, 2), ADD COLUMN "currency" CHAR(3);

-- Existing paid events: the price read from their label when it's a plain number ("₱1,500",
-- "$50", "PHP 500"); the currency from its symbol, else the business's.
UPDATE "booking"."events" e
SET "price" = CASE WHEN regexp_replace(e."price_label", '[^0-9.]', '', 'g') ~ '^[0-9]+(\.[0-9]{1,2})?$' THEN regexp_replace(e."price_label", '[^0-9.]', '', 'g')::DECIMAL(12, 2) END,
    "currency" = CASE
      WHEN e."price_label" LIKE '%₱%' OR e."price_label" ILIKE '%php%' THEN 'PHP'
      WHEN e."price_label" ILIKE '%usd%' OR e."price_label" LIKE '$%' THEN 'USD'
      WHEN e."price_label" LIKE '%€%' OR e."price_label" ILIKE '%eur%' THEN 'EUR'
      ELSE s."currency" END
FROM "booking"."settings" s
WHERE s."organization_id" = e."organization_id" AND e."kind" = 'paid';
