-- Vouchers for bigger events (paid by hand; created on the admin site, used once on an event).
CREATE TABLE "booking"."event_vouchers" (
    "id" SERIAL NOT NULL,
    "organization_id" TEXT NOT NULL,
    "code" CHAR(8) NOT NULL,
    "participants" INTEGER NOT NULL,
    "price_label" VARCHAR(60),
    "note" VARCHAR(500),
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "used_at" TIMESTAMPTZ(3),
    "event_id" INTEGER,
    CONSTRAINT "event_vouchers_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "event_vouchers_participants_check" CHECK ("participants" > 0)
);
CREATE UNIQUE INDEX "event_vouchers_code_key" ON "booking"."event_vouchers"("code");
CREATE INDEX "event_vouchers_organization_id_idx" ON "booking"."event_vouchers"("organization_id");
