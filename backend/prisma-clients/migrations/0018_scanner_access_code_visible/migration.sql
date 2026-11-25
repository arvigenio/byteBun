-- The access code, encrypted (AES-256-GCM, key derived from BETTER_AUTH_SECRET), so the business
-- can see it on the Scanners tab. Sign-in still checks the SHA-256 hash. Scanners made before
-- this have none until a new access code is made.
ALTER TABLE "booking"."event_scanners" ADD COLUMN "access_code_enc" VARCHAR(120);
