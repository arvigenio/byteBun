-- Paid events: a registration gets its check-in code (and QR code) only once its payment is
-- confirmed. Until then it has none.
ALTER TABLE "booking"."event_tickets" ALTER COLUMN "code" DROP NOT NULL;
UPDATE "booking"."event_tickets" SET "code" = NULL WHERE "status" IN ('review', 'rejected');
