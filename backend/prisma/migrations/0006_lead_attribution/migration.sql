-- Where a booking came from: the channel (web form or chatbot) and how the visitor reached the
-- site (social media, search, ads, ...). See src/leads/attribution.ts.

-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "channel" VARCHAR(20) NOT NULL DEFAULT 'web_form',
ADD COLUMN     "landing_path" VARCHAR(300),
ADD COLUMN     "origin" VARCHAR(20),
ADD COLUMN     "origin_detail" VARCHAR(80),
ADD COLUMN     "referrer_host" VARCHAR(253),
ADD COLUMN     "utm_campaign" VARCHAR(100),
ADD COLUMN     "utm_medium" VARCHAR(100),
ADD COLUMN     "utm_source" VARCHAR(100);

-- Existing leads: the chat calendar always booked with source "chatbot". Their origin is unknown.
UPDATE "leads" SET "channel" = 'chatbot' WHERE "source" = 'chatbot';
