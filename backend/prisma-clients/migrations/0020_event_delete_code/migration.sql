-- Deleting an event needs a code emailed to the person asking (6 digits, 10 minutes, 5 tries).
ALTER TABLE "booking"."events" ADD COLUMN "delete_code_hash" CHAR(64);
ALTER TABLE "booking"."events" ADD COLUMN "delete_code_expires_at" TIMESTAMPTZ(3);
ALTER TABLE "booking"."events" ADD COLUMN "delete_code_user_id" TEXT;
ALTER TABLE "booking"."events" ADD COLUMN "delete_code_attempts" INTEGER NOT NULL DEFAULT 0;
