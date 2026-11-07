-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "leads" (
    "id" SERIAL NOT NULL,
    "first_name" VARCHAR(50) NOT NULL,
    "last_name" VARCHAR(50) NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "phone" VARCHAR(40),
    "business_name" VARCHAR(160),
    "business_type" VARCHAR(80) NOT NULL,
    "goals" VARCHAR(1000),
    "goals_other" VARCHAR(200),
    "features" VARCHAR(1000),
    "message" VARCHAR(2000),
    "source" VARCHAR(50) NOT NULL DEFAULT 'website',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" VARCHAR(30) NOT NULL DEFAULT 'new',

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookings" (
    "id" SERIAL NOT NULL,
    "lead_id" INTEGER NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "time_zone" VARCHAR(64),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ix_leads_created_at" ON "leads"("created_at");

-- CreateIndex
CREATE INDEX "ix_leads_email" ON "leads"("email");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_lead_id_key" ON "bookings"("lead_id");

-- CreateIndex
CREATE UNIQUE INDEX "bookings_starts_at_key" ON "bookings"("starts_at");

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

