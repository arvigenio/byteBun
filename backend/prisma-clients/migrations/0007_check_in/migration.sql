-- Attendance: each booking has an 8-character check-in code (in the QR code of its emails) and is
-- marked when the customer checks in at the front desk.
ALTER TABLE "booking"."bookings"
  ADD COLUMN "check_in_code" CHAR(8),
  ADD COLUMN "checked_in_at" TIMESTAMPTZ(3),
  ADD COLUMN "checked_in_by" TEXT;

-- Codes for existing bookings: 8 characters from an alphabet without look-alikes (no 0/O, 1/I/L).
UPDATE "booking"."bookings" SET "check_in_code" = (
  SELECT string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789', 1 + floor(random() * 31)::int, 1), '')
  FROM generate_series(1, 8) WHERE "bookings"."id" IS NOT NULL
);

ALTER TABLE "booking"."bookings" ALTER COLUMN "check_in_code" SET NOT NULL;
CREATE UNIQUE INDEX "bookings_organization_id_check_in_code_key" ON "booking"."bookings"("organization_id", "check_in_code");
