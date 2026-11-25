-- Deleting an event cascades in the database: registrations, scanners, claimables and claims go
-- with it (already foreign keys with ON DELETE CASCADE). Two links get proper foreign keys too:
--   a claim's scanner: cleared when the scanner is deleted (the claim stays, with "claimed by")
--   a voucher's event: cleared when the event is deleted (the voucher is Byte Bun's payment record)
UPDATE "booking"."event_claims" c SET "scanner_id" = NULL WHERE "scanner_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "booking"."event_scanners" s WHERE s."id" = c."scanner_id");
ALTER TABLE "booking"."event_claims" ADD CONSTRAINT "event_claims_scanner_id_fkey" FOREIGN KEY ("scanner_id") REFERENCES "booking"."event_scanners"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "event_claims_scanner_id_idx" ON "booking"."event_claims"("scanner_id");

UPDATE "booking"."event_vouchers" v SET "event_id" = NULL WHERE "event_id" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "booking"."events" e WHERE e."id" = v."event_id");
ALTER TABLE "booking"."event_vouchers" ADD CONSTRAINT "event_vouchers_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "booking"."events"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "event_vouchers_event_id_idx" ON "booking"."event_vouchers"("event_id");
