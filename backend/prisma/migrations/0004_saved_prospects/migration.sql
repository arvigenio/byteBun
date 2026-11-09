-- Prospecting: saved prospects and their groups.

-- CreateTable
CREATE TABLE "prospect_groups" (
    "id" SERIAL NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "created_by" VARCHAR(254) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prospect_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_prospects" (
    "id" SERIAL NOT NULL,
    "external_id" VARCHAR(200) NOT NULL,
    "group_id" INTEGER,
    "name" VARCHAR(200) NOT NULL,
    "category" VARCHAR(120),
    "address" VARCHAR(400),
    "city" VARCHAR(120),
    "country" VARCHAR(120),
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "phone" VARCHAR(60),
    "email" VARCHAR(254),
    "website" VARCHAR(500),
    "maps_url" VARCHAR(1000),
    "rating" DOUBLE PRECISION,
    "review_count" INTEGER,
    "score" INTEGER NOT NULL,
    "tier" VARCHAR(10) NOT NULL,
    "socials" JSONB NOT NULL DEFAULT '[]',
    "reasons" JSONB NOT NULL DEFAULT '[]',
    "pitch" JSONB NOT NULL DEFAULT '[]',
    "checkup" JSONB,
    "website_kind" VARCHAR(10) NOT NULL,
    "industry" VARCHAR(80) NOT NULL,
    "location" VARCHAR(120) NOT NULL,
    "source" VARCHAR(20) NOT NULL,
    "note" VARCHAR(2000),
    "saved_by" VARCHAR(254) NOT NULL,
    "saved_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "saved_prospects_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "prospect_groups_name_key" ON "prospect_groups"("name");

-- CreateIndex
CREATE UNIQUE INDEX "saved_prospects_external_id_key" ON "saved_prospects"("external_id");

-- CreateIndex
CREATE INDEX "ix_saved_prospects_group_id" ON "saved_prospects"("group_id");

-- CreateIndex
CREATE INDEX "ix_saved_prospects_saved_at" ON "saved_prospects"("saved_at");

-- AddForeignKey
ALTER TABLE "saved_prospects" ADD CONSTRAINT "saved_prospects_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "prospect_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

