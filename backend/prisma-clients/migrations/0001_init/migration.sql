-- Clients database: auth (Better Auth + organizations), billing (plans, entitlements, status,
-- audit), booking (the Bookings app). See prisma-clients/schema.prisma.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "auth";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "billing";

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "booking";

-- CreateTable
CREATE TABLE "auth"."users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "email_verified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth"."sessions" (
    "id" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "token" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "user_id" TEXT NOT NULL,
    "active_organization_id" TEXT,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth"."accounts" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "access_token" TEXT,
    "refresh_token" TEXT,
    "id_token" TEXT,
    "access_token_expires_at" TIMESTAMPTZ(3),
    "refresh_token_expires_at" TIMESTAMPTZ(3),
    "scope" TEXT,
    "password" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth"."verifications" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth"."rate_limits" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "last_request" BIGINT NOT NULL,

    CONSTRAINT "rate_limits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth"."organizations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "logo" TEXT,
    "metadata" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth"."members" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth"."invitations" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "team_id" TEXT,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "inviter_id" TEXT NOT NULL,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."plans" (
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "apps" TEXT[],
    "features" TEXT[],
    "limits" JSONB NOT NULL DEFAULT '{}',
    "portal" BOOLEAN NOT NULL DEFAULT false,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "billing"."addons" (
    "code" VARCHAR(40) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "apps" TEXT[],
    "features" TEXT[],
    "limits" JSONB NOT NULL DEFAULT '{}',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "addons_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "billing"."subscriptions" (
    "id" SERIAL NOT NULL,
    "organization_id" TEXT NOT NULL,
    "plan_code" VARCHAR(40) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "currency" CHAR(3) NOT NULL DEFAULT 'USD',
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing"."subscription_addons" (
    "subscription_id" INTEGER NOT NULL,
    "addon_code" VARCHAR(40) NOT NULL,
    "added_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_addons_pkey" PRIMARY KEY ("subscription_id","addon_code")
);

-- CreateTable
CREATE TABLE "billing"."entitlements" (
    "organization_id" TEXT NOT NULL,
    "key" VARCHAR(80) NOT NULL,
    "value" INTEGER,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entitlements_pkey" PRIMARY KEY ("organization_id","key")
);

-- CreateTable
CREATE TABLE "billing"."account_status" (
    "organization_id" TEXT NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "reason" VARCHAR(500),
    "changed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changed_by" VARCHAR(254),
    "delete_after" TIMESTAMPTZ(3),

    CONSTRAINT "account_status_pkey" PRIMARY KEY ("organization_id")
);

-- CreateTable
CREATE TABLE "billing"."events" (
    "id" SERIAL NOT NULL,
    "organization_id" TEXT NOT NULL,
    "type" VARCHAR(40) NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "actor" VARCHAR(254) NOT NULL,
    "reason" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking"."settings" (
    "organization_id" TEXT NOT NULL,
    "slug" VARCHAR(60) NOT NULL,
    "business_name" VARCHAR(120) NOT NULL,
    "time_zone" VARCHAR(64) NOT NULL,
    "mode" VARCHAR(10) NOT NULL DEFAULT 'slots',
    "interval_minutes" INTEGER NOT NULL DEFAULT 30,
    "bookers_per_slot" INTEGER NOT NULL DEFAULT 1,
    "max_per_day" INTEGER,
    "min_notice_minutes" INTEGER NOT NULL DEFAULT 120,
    "window_days" INTEGER NOT NULL DEFAULT 60,
    "change_cutoff_hours" INTEGER,
    "phone" VARCHAR(40),
    "contact_email" VARCHAR(254),
    "page_instructions" VARCHAR(2000),
    "private_instructions" VARCHAR(5000),
    "primary_color" VARCHAR(7) NOT NULL DEFAULT '#0F766E',
    "accent_color" VARCHAR(7),
    "background_color" VARCHAR(7),
    "theme" VARCHAR(10) NOT NULL DEFAULT 'light',
    "font" VARCHAR(20) NOT NULL DEFAULT 'system',
    "button_style" VARCHAR(10) NOT NULL DEFAULT 'rounded',
    "owner_alerts" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("organization_id")
);

-- CreateTable
CREATE TABLE "booking"."weekly_hours" (
    "id" SERIAL NOT NULL,
    "organization_id" TEXT NOT NULL,
    "weekday" SMALLINT NOT NULL,
    "start_minute" SMALLINT NOT NULL,
    "end_minute" SMALLINT NOT NULL,

    CONSTRAINT "weekly_hours_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking"."breaks" (
    "id" SERIAL NOT NULL,
    "organization_id" TEXT NOT NULL,
    "weekday" SMALLINT NOT NULL,
    "start_minute" SMALLINT NOT NULL,
    "end_minute" SMALLINT NOT NULL,

    CONSTRAINT "breaks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking"."blocked_dates" (
    "id" SERIAL NOT NULL,
    "organization_id" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "reason" VARCHAR(200),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blocked_dates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking"."services" (
    "id" SERIAL NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "description" VARCHAR(1000),
    "duration_minutes" INTEGER NOT NULL,
    "buffer_minutes" INTEGER NOT NULL DEFAULT 0,
    "location_type" VARCHAR(12) NOT NULL DEFAULT 'in_person',
    "address" VARCHAR(300),
    "meeting_url" VARCHAR(500),
    "instructions" VARCHAR(5000),
    "position" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking"."customers" (
    "id" SERIAL NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "phone" VARCHAR(40),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking"."bookings" (
    "id" SERIAL NOT NULL,
    "organization_id" TEXT NOT NULL,
    "service_id" INTEGER NOT NULL,
    "customer_id" INTEGER NOT NULL,
    "local_date" DATE NOT NULL,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3) NOT NULL,
    "blocked_until" TIMESTAMPTZ(3) NOT NULL,
    "date_only" BOOLEAN NOT NULL DEFAULT false,
    "status" VARCHAR(12) NOT NULL DEFAULT 'confirmed',
    "cancelled_at" TIMESTAMPTZ(3),
    "cancelled_by" VARCHAR(12),
    "cancel_reason" VARCHAR(500),
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "manage_nonce" CHAR(32) NOT NULL,
    "note" VARCHAR(1000),
    "source" VARCHAR(10) NOT NULL DEFAULT 'public',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking"."notifications" (
    "id" SERIAL NOT NULL,
    "organization_id" TEXT NOT NULL,
    "booking_id" INTEGER,
    "kind" VARCHAR(30) NOT NULL,
    "channel" VARCHAR(10) NOT NULL DEFAULT 'email',
    "recipient" VARCHAR(254) NOT NULL,
    "send_at" TIMESTAMPTZ(3) NOT NULL,
    "status" VARCHAR(10) NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" VARCHAR(500),
    "sent_at" TIMESTAMPTZ(3),
    "payload" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "auth"."users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_key" ON "auth"."sessions"("token");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "auth"."sessions"("user_id");

-- CreateIndex
CREATE INDEX "accounts_user_id_idx" ON "auth"."accounts"("user_id");

-- CreateIndex
CREATE INDEX "verifications_identifier_idx" ON "auth"."verifications"("identifier");

-- CreateIndex
CREATE UNIQUE INDEX "rate_limits_key_key" ON "auth"."rate_limits"("key");

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "auth"."organizations"("slug");

-- CreateIndex
CREATE INDEX "members_user_id_idx" ON "auth"."members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "members_organization_id_user_id_key" ON "auth"."members"("organization_id", "user_id");

-- CreateIndex
CREATE INDEX "invitations_organization_id_idx" ON "auth"."invitations"("organization_id");

-- CreateIndex
CREATE INDEX "invitations_email_idx" ON "auth"."invitations"("email");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_organization_id_key" ON "billing"."subscriptions"("organization_id");

-- CreateIndex
CREATE INDEX "events_organization_id_created_at_idx" ON "billing"."events"("organization_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "settings_slug_key" ON "booking"."settings"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "weekly_hours_organization_id_weekday_key" ON "booking"."weekly_hours"("organization_id", "weekday");

-- CreateIndex
CREATE INDEX "breaks_organization_id_idx" ON "booking"."breaks"("organization_id");

-- CreateIndex
CREATE INDEX "blocked_dates_organization_id_start_date_idx" ON "booking"."blocked_dates"("organization_id", "start_date");

-- CreateIndex
CREATE INDEX "services_organization_id_position_idx" ON "booking"."services"("organization_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "customers_organization_id_email_key" ON "booking"."customers"("organization_id", "email");

-- CreateIndex
CREATE INDEX "bookings_organization_id_local_date_idx" ON "booking"."bookings"("organization_id", "local_date");

-- CreateIndex
CREATE INDEX "bookings_organization_id_starts_at_idx" ON "booking"."bookings"("organization_id", "starts_at");

-- CreateIndex
CREATE INDEX "bookings_organization_id_created_at_idx" ON "booking"."bookings"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "notifications_status_send_at_idx" ON "booking"."notifications"("status", "send_at");

-- CreateIndex
CREATE INDEX "notifications_booking_id_idx" ON "booking"."notifications"("booking_id");

-- AddForeignKey
ALTER TABLE "auth"."sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth"."accounts" ADD CONSTRAINT "accounts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth"."members" ADD CONSTRAINT "members_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "auth"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth"."members" ADD CONSTRAINT "members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth"."invitations" ADD CONSTRAINT "invitations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "auth"."organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth"."invitations" ADD CONSTRAINT "invitations_inviter_id_fkey" FOREIGN KEY ("inviter_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."subscriptions" ADD CONSTRAINT "subscriptions_plan_code_fkey" FOREIGN KEY ("plan_code") REFERENCES "billing"."plans"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."subscription_addons" ADD CONSTRAINT "subscription_addons_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "billing"."subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billing"."subscription_addons" ADD CONSTRAINT "subscription_addons_addon_code_fkey" FOREIGN KEY ("addon_code") REFERENCES "billing"."addons"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking"."bookings" ADD CONSTRAINT "bookings_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "booking"."services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking"."bookings" ADD CONSTRAINT "bookings_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "booking"."customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking"."notifications" ADD CONSTRAINT "notifications_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "booking"."bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Plans. Prices are not stored yet (to be provided). Limits missing from "limits" = unlimited.
-- Features and limits are documented in src/clients/entitlements.ts.
INSERT INTO "billing"."plans" ("code", "name", "apps", "features", "limits", "portal", "sort") VALUES
  ('free', 'Free', '{bookings}', '{}',
   '{"bookings.monthly": 60, "bookings.services": 3, "bookings.staff": 2, "bookings.retention_days": 60}', false, 0),
  ('bookings', 'Bookings', '{bookings}', '{bookings.unlimited,bookings.custom_reminders,bookings.whatsapp,bookings.full_branding}',
   '{"bookings.staff": 10}', false, 10),
  ('starter', 'Starter Package', '{bookings}', '{bookings.unlimited,bookings.custom_reminders,bookings.whatsapp,bookings.full_branding}',
   '{"bookings.staff": 25}', true, 20);
