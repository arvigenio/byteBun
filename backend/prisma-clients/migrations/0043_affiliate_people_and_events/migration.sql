-- Affiliates become people with programs (catch-up for 0042, whose tables are still empty):
--   billing.affiliates           the person (email), payout account, portal sign-in code
--   billing.plan_affiliates      Byte Bun's own program: promo code, discount %, commission %
--   billing.affiliate_sessions   signed-in affiliate portal devices
--   booking.event_affiliates     a paid event's affiliates (up to 5): their promo code is an
--                                event_promo_codes row; commission % of what attendees paid
--   booking.event_affiliate_payouts  money the business sent them

-- billing.affiliates: program columns move to plan_affiliates (their CHECK constraints go with them).
DROP INDEX "billing"."affiliates_promo_code_key";
ALTER TABLE "billing"."affiliates" DROP COLUMN "commission_percent",
DROP COLUMN "created_by",
DROP COLUMN "discount_percent",
DROP COLUMN "invite_expires_at",
DROP COLUMN "invite_hash",
DROP COLUMN "invited_at",
DROP COLUMN "note",
DROP COLUMN "promo_code",
DROP COLUMN "status",
ADD COLUMN     "login_attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "login_code_expires_at" TIMESTAMPTZ(3),
ADD COLUMN     "login_code_hash" VARCHAR(64);

CREATE TABLE "billing"."plan_affiliates" (
    "id" SERIAL NOT NULL,
    "affiliate_id" INTEGER NOT NULL,
    "promo_code" VARCHAR(20) NOT NULL,
    "discount_percent" DECIMAL(5,2) NOT NULL,
    "commission_percent" DECIMAL(5,2) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'invited',
    "invite_hash" VARCHAR(64),
    "invite_expires_at" TIMESTAMPTZ(3),
    "invited_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "joined_at" TIMESTAMPTZ(3),
    "note" VARCHAR(500),
    "created_by" VARCHAR(254) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plan_affiliates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "billing"."affiliate_sessions" (
    "id" SERIAL NOT NULL,
    "affiliate_id" INTEGER NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "affiliate_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "booking"."event_affiliates" (
    "id" SERIAL NOT NULL,
    "event_id" INTEGER NOT NULL,
    "organization_id" TEXT NOT NULL,
    "affiliate_id" INTEGER NOT NULL,
    "first_name" VARCHAR(60) NOT NULL,
    "last_name" VARCHAR(60) NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "phone" VARCHAR(40) NOT NULL,
    "promo_code_id" INTEGER NOT NULL,
    "commission_percent" DECIMAL(5,2) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'invited',
    "invite_hash" VARCHAR(64),
    "invite_expires_at" TIMESTAMPTZ(3),
    "invited_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "joined_at" TIMESTAMPTZ(3),
    "created_by" VARCHAR(254) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_affiliates_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "booking"."event_affiliate_payouts" (
    "id" SERIAL NOT NULL,
    "event_affiliate_id" INTEGER NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "reference" VARCHAR(120),
    "created_by" VARCHAR(254) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_affiliate_payouts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "plan_affiliates_affiliate_id_key" ON "billing"."plan_affiliates"("affiliate_id");
CREATE UNIQUE INDEX "plan_affiliates_promo_code_key" ON "billing"."plan_affiliates"("promo_code");
CREATE UNIQUE INDEX "affiliate_sessions_token_hash_key" ON "billing"."affiliate_sessions"("token_hash");
CREATE INDEX "affiliate_sessions_affiliate_id_idx" ON "billing"."affiliate_sessions"("affiliate_id");
CREATE UNIQUE INDEX "event_affiliates_promo_code_id_key" ON "booking"."event_affiliates"("promo_code_id");
CREATE INDEX "event_affiliates_affiliate_id_idx" ON "booking"."event_affiliates"("affiliate_id");
CREATE UNIQUE INDEX "event_affiliates_event_id_affiliate_id_key" ON "booking"."event_affiliates"("event_id", "affiliate_id");

ALTER TABLE "billing"."plan_affiliates" ADD CONSTRAINT "plan_affiliates_affiliate_id_fkey" FOREIGN KEY ("affiliate_id") REFERENCES "billing"."affiliates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "billing"."affiliate_sessions" ADD CONSTRAINT "affiliate_sessions_affiliate_id_fkey" FOREIGN KEY ("affiliate_id") REFERENCES "billing"."affiliates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "booking"."event_affiliates" ADD CONSTRAINT "event_affiliates_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "booking"."events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "booking"."event_affiliates" ADD CONSTRAINT "event_affiliates_affiliate_id_fkey" FOREIGN KEY ("affiliate_id") REFERENCES "billing"."affiliates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "booking"."event_affiliates" ADD CONSTRAINT "event_affiliates_promo_code_id_fkey" FOREIGN KEY ("promo_code_id") REFERENCES "booking"."event_promo_codes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "booking"."event_affiliate_payouts" ADD CONSTRAINT "event_affiliate_payouts_event_affiliate_id_fkey" FOREIGN KEY ("event_affiliate_id") REFERENCES "booking"."event_affiliates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Allowed values.
ALTER TABLE "billing"."plan_affiliates" ADD CONSTRAINT "plan_affiliates_status_check" CHECK ("status" IN ('invited', 'active', 'disabled'));
ALTER TABLE "billing"."plan_affiliates" ADD CONSTRAINT "plan_affiliates_percent_check" CHECK ("discount_percent" >= 0 AND "discount_percent" <= 100 AND "commission_percent" >= 0 AND "commission_percent" <= 100);
ALTER TABLE "booking"."event_affiliates" ADD CONSTRAINT "event_affiliates_status_check" CHECK ("status" IN ('invited', 'active', 'disabled'));
ALTER TABLE "booking"."event_affiliates" ADD CONSTRAINT "event_affiliates_percent_check" CHECK ("commission_percent" >= 0 AND "commission_percent" <= 100);
ALTER TABLE "booking"."event_affiliate_payouts" ADD CONSTRAINT "event_affiliate_payouts_amount_check" CHECK ("amount" > 0);
