-- Paid events' promo codes: an amount or a percentage off per place, a usage limit (1 = one-time,
-- null = unlimited), an optional expiry. Registrations keep the code and discount they got.
CREATE TABLE "booking"."event_promo_codes" (
    "id" SERIAL NOT NULL,
    "event_id" INTEGER NOT NULL,
    "organization_id" TEXT NOT NULL,
    "code" VARCHAR(30) NOT NULL,
    "discount_type" VARCHAR(10) NOT NULL,
    "discount_value" DECIMAL(12, 2) NOT NULL,
    "usage_limit" INTEGER,
    "used" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMPTZ(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "event_promo_codes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "event_promo_codes_type_check" CHECK ("discount_type" IN ('amount', 'percent')),
    CONSTRAINT "event_promo_codes_used_check" CHECK ("used" >= 0 AND ("usage_limit" IS NULL OR "used" <= "usage_limit"))
);
CREATE UNIQUE INDEX "event_promo_codes_event_id_code_key" ON "booking"."event_promo_codes"("event_id", "code");
ALTER TABLE "booking"."event_promo_codes" ADD CONSTRAINT "event_promo_codes_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "booking"."events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "booking"."event_tickets"
  ADD COLUMN "promo_code_id" INTEGER,
  ADD COLUMN "promo_code" VARCHAR(30),
  ADD COLUMN "discount" DECIMAL(12, 2);
CREATE INDEX "event_tickets_promo_code_id_idx" ON "booking"."event_tickets"("promo_code_id");
ALTER TABLE "booking"."event_tickets" ADD CONSTRAINT "event_tickets_promo_code_id_fkey" FOREIGN KEY ("promo_code_id") REFERENCES "booking"."event_promo_codes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
