-- Time off can now be part of a day (start/end minute, both or neither) and for one service only
-- (service_id; NULL = the whole business).
ALTER TABLE "booking"."blocked_dates"
  ADD COLUMN "start_minute" INTEGER,
  ADD COLUMN "end_minute" INTEGER,
  ADD COLUMN "service_id" INTEGER;

ALTER TABLE "booking"."blocked_dates"
  ADD CONSTRAINT "blocked_dates_minutes_check" CHECK (
    ("start_minute" IS NULL AND "end_minute" IS NULL)
    OR ("start_minute" >= 0 AND "end_minute" <= 1440 AND "start_minute" < "end_minute")
  );

ALTER TABLE "booking"."blocked_dates"
  ADD CONSTRAINT "blocked_dates_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "booking"."services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "blocked_dates_service_id_idx" ON "booking"."blocked_dates"("service_id");
