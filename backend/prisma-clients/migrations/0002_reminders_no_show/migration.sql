-- Reminders (settings.reminders), WhatsApp number for owner alerts, and no-show follow-up.

-- AlterTable
ALTER TABLE "booking"."bookings" ADD COLUMN     "no_show_at" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "booking"."settings" ADD COLUMN     "alert_phone" VARCHAR(40),
ADD COLUMN     "no_show_follow_up" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "reminders" JSONB NOT NULL DEFAULT '[{"offsetMinutes": 1440, "channel": "email"}]';

