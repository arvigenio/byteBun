-- Affiliates and self-serve plan payments (src/clients/affiliates/).
--   billing.plans                  + prices (USD cents) and self_serve (bought from the Plan page)
--   billing.payment_channels       Byte Bun's own ways to be paid (QR image or bank details)
--   billing.affiliates             people who promote Byte Bun: promo code, discount %, commission %
--   billing.plan_payments          a business paying for a plan, with its proof (verified by an admin)
--   billing.affiliate_commissions  what an affiliate earns from one payment (pending -> earned -> paid)

-- AlterTable
ALTER TABLE "billing"."plans" ADD COLUMN     "price_monthly_cents" INTEGER,
ADD COLUMN     "price_yearly_cents" INTEGER,
ADD COLUMN     "self_serve" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "billing"."payment_channels" (
    "id" SERIAL NOT NULL,
    "type" VARCHAR(10) NOT NULL,
    "label" VARCHAR(60) NOT NULL,
    "bank_name" VARCHAR(80),
    "account_name" VARCHAR(120),
    "account_number" VARCHAR(60),
    "qr_file" VARCHAR(64),
    "qr_type" VARCHAR(40),
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."affiliates" (
    "id" SERIAL NOT NULL,
    "first_name" VARCHAR(60) NOT NULL,
    "last_name" VARCHAR(60) NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "phone" VARCHAR(40) NOT NULL,
    "promo_code" VARCHAR(20) NOT NULL,
    "discount_percent" DECIMAL(5,2) NOT NULL,
    "commission_percent" DECIMAL(5,2) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'invited',
    "invite_hash" VARCHAR(64),
    "invite_expires_at" TIMESTAMPTZ(3),
    "invited_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "joined_at" TIMESTAMPTZ(3),
    "payout_method" VARCHAR(10),
    "payout_provider" VARCHAR(80),
    "payout_account_name" VARCHAR(120),
    "payout_account_number" VARCHAR(60),
    "note" VARCHAR(500),
    "created_by" VARCHAR(254) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "affiliates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."plan_payments" (
    "id" SERIAL NOT NULL,
    "organization_id" TEXT NOT NULL,
    "plan_code" VARCHAR(40) NOT NULL,
    "cycle" VARCHAR(10) NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "list_cents" INTEGER NOT NULL,
    "discount_cents" INTEGER NOT NULL DEFAULT 0,
    "amount_cents" INTEGER NOT NULL,
    "affiliate_id" INTEGER,
    "promo_code" VARCHAR(20),
    "discount_percent" DECIMAL(5,2),
    "status" VARCHAR(20) NOT NULL DEFAULT 'review',
    "proof_file" VARCHAR(64),
    "proof_type" VARCHAR(40),
    "proof_name" VARCHAR(200),
    "reference" VARCHAR(120),
    "submitted_by" VARCHAR(254) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_at" TIMESTAMPTZ(3),
    "reviewed_by" VARCHAR(254),
    "review_note" VARCHAR(500),

    CONSTRAINT "plan_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."affiliate_commissions" (
    "id" SERIAL NOT NULL,
    "affiliate_id" INTEGER NOT NULL,
    "payment_id" INTEGER NOT NULL,
    "organization_id" TEXT NOT NULL,
    "commission_percent" DECIMAL(5,2) NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "earned_at" TIMESTAMPTZ(3),
    "paid_at" TIMESTAMPTZ(3),
    "paid_by" VARCHAR(254),
    "payout_reference" VARCHAR(120),

    CONSTRAINT "affiliate_commissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "affiliates_email_key" ON "billing"."affiliates"("email");

-- CreateIndex
CREATE UNIQUE INDEX "affiliates_promo_code_key" ON "billing"."affiliates"("promo_code");

-- CreateIndex
CREATE INDEX "plan_payments_status_created_at_idx" ON "billing"."plan_payments"("status", "created_at");

-- CreateIndex
CREATE INDEX "plan_payments_organization_id_created_at_idx" ON "billing"."plan_payments"("organization_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "affiliate_commissions_payment_id_key" ON "billing"."affiliate_commissions"("payment_id");

-- CreateIndex
CREATE INDEX "affiliate_commissions_affiliate_id_status_idx" ON "billing"."affiliate_commissions"("affiliate_id", "status");

-- AddForeignKey
ALTER TABLE "billing"."plan_payments" ADD CONSTRAINT "plan_payments_plan_code_fkey" FOREIGN KEY ("plan_code") REFERENCES "billing"."plans"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."plan_payments" ADD CONSTRAINT "plan_payments_affiliate_id_fkey" FOREIGN KEY ("affiliate_id") REFERENCES "billing"."affiliates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."affiliate_commissions" ADD CONSTRAINT "affiliate_commissions_affiliate_id_fkey" FOREIGN KEY ("affiliate_id") REFERENCES "billing"."affiliates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."affiliate_commissions" ADD CONSTRAINT "affiliate_commissions_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "billing"."plan_payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Allowed values.
ALTER TABLE "billing"."payment_channels" ADD CONSTRAINT "payment_channels_type_check" CHECK ("type" IN ('qr', 'bank'));
ALTER TABLE "billing"."affiliates" ADD CONSTRAINT "affiliates_status_check" CHECK ("status" IN ('invited', 'active', 'disabled'));
ALTER TABLE "billing"."affiliates" ADD CONSTRAINT "affiliates_percent_check" CHECK ("discount_percent" >= 0 AND "discount_percent" <= 100 AND "commission_percent" >= 0 AND "commission_percent" <= 100);
ALTER TABLE "billing"."affiliates" ADD CONSTRAINT "affiliates_payout_method_check" CHECK ("payout_method" IS NULL OR "payout_method" IN ('bank', 'ewallet'));
ALTER TABLE "billing"."plan_payments" ADD CONSTRAINT "plan_payments_status_check" CHECK ("status" IN ('review', 'approved', 'rejected', 'cancelled'));
ALTER TABLE "billing"."plan_payments" ADD CONSTRAINT "plan_payments_cycle_check" CHECK ("cycle" IN ('monthly', 'yearly'));
ALTER TABLE "billing"."affiliate_commissions" ADD CONSTRAINT "affiliate_commissions_status_check" CHECK ("status" IN ('pending', 'earned', 'paid', 'void'));

-- Prices as sold on bytebuntech.com (USD). Only Bookings Pro is bought from the Plan page;
-- Premium and Growth start with a free consultation.
UPDATE "billing"."plans" SET "price_monthly_cents" = 1000, "price_yearly_cents" = 10000, "self_serve" = true WHERE "code" = 'bookings';
UPDATE "billing"."plans" SET "price_monthly_cents" = 7900, "price_yearly_cents" = 79000 WHERE "code" = 'premium';
UPDATE "billing"."plans" SET "price_monthly_cents" = 10900, "price_yearly_cents" = 109000 WHERE "code" = 'growth';
