-- Lead emails (confirmation, reminder) and the lead's reschedule/cancel link.

-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "manage_nonce" CHAR(32);

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "confirmation_sent_at" TIMESTAMPTZ(3),
ADD COLUMN     "reminder_at" TIMESTAMPTZ(3),
ADD COLUMN     "reminder_sent_at" TIMESTAMPTZ(3),
ADD COLUMN     "sequence" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "ix_bookings_reminder_at" ON "bookings"("reminder_at");

-- Calls booked before this release: no confirmation is sent after the fact, but upcoming calls
-- still get their reminder.
UPDATE "bookings" SET "confirmation_sent_at" = "created_at";
UPDATE "bookings" SET "reminder_at" = "starts_at" - interval '24 hours' WHERE "starts_at" > now();
