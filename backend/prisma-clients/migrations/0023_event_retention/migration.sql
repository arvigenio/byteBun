-- Events without a bigger-event voucher (50 participants or fewer) are deleted automatically 3
-- months after they end: the business agrees when creating one. Owners and admins get reminders
-- 7, 3 and 1 days before, and the complete event as CSV and JSON when it is deleted.
ALTER TABLE "booking"."events" ADD COLUMN "retention_agreed_at" TIMESTAMPTZ(3);
ALTER TABLE "booking"."events" ADD COLUMN "retention_notices" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];
