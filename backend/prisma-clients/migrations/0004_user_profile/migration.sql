-- Client profile: first name, last name and phone (the email can't be changed by the client).
ALTER TABLE "auth"."users" ADD COLUMN "first_name" VARCHAR(60),
ADD COLUMN "last_name" VARCHAR(60),
ADD COLUMN "phone" VARCHAR(40);

-- Existing names: first word = first name, the rest = last name.
UPDATE "auth"."users"
SET "first_name" = NULLIF(LEFT(split_part(btrim("name"), ' ', 1), 60), ''),
    "last_name"  = NULLIF(LEFT(btrim(substr(btrim("name"), length(split_part(btrim("name"), ' ', 1)) + 1)), 60), '')
WHERE btrim("name") <> '';
