-- Events: a cover photo and a logo for the event page (images in UPLOADS_DIR/event-media/).
ALTER TABLE "booking"."events"
  ADD COLUMN "cover_file" VARCHAR(80),
  ADD COLUMN "cover_type" VARCHAR(40),
  ADD COLUMN "logo_file" VARCHAR(80),
  ADD COLUMN "logo_type" VARCHAR(40);
