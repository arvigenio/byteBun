-- Team: custom roles (booking.team_roles; members/invitations.team_role_id), event assignments
-- (booking.event_members: everyone except owners and admins sees only their events), and the team
-- chat (rooms: team / event / direct; messages with an optional image or PDF; read state).

-- AlterTable
ALTER TABLE "auth"."invitations" ADD COLUMN     "team_role_id" INTEGER;

-- AlterTable
ALTER TABLE "auth"."members" ADD COLUMN     "team_role_id" INTEGER;

-- CreateTable
CREATE TABLE "booking"."team_roles" (
    "id" SERIAL NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" VARCHAR(40) NOT NULL,
    "permissions" TEXT[],
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "team_roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking"."event_members" (
    "event_id" INTEGER NOT NULL,
    "user_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "assigned_by" VARCHAR(254) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_members_pkey" PRIMARY KEY ("event_id","user_id")
);

-- CreateTable
CREATE TABLE "booking"."chat_rooms" (
    "id" SERIAL NOT NULL,
    "organization_id" TEXT NOT NULL,
    "key" VARCHAR(200) NOT NULL,
    "kind" VARCHAR(10) NOT NULL,
    "event_id" INTEGER,
    "user_a" TEXT,
    "user_b" TEXT,
    "last_message_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking"."chat_messages" (
    "id" SERIAL NOT NULL,
    "room_id" INTEGER NOT NULL,
    "organization_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "body" VARCHAR(4000) NOT NULL DEFAULT '',
    "file" VARCHAR(64),
    "file_type" VARCHAR(40),
    "file_name" VARCHAR(200),
    "file_size" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking"."chat_reads" (
    "room_id" INTEGER NOT NULL,
    "user_id" TEXT NOT NULL,
    "last_read_id" INTEGER NOT NULL DEFAULT 0,
    "notified_id" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_reads_pkey" PRIMARY KEY ("room_id","user_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "team_roles_organization_id_name_key" ON "booking"."team_roles"("organization_id", "name");

-- CreateIndex
CREATE INDEX "event_members_organization_id_user_id_idx" ON "booking"."event_members"("organization_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "chat_rooms_key_key" ON "booking"."chat_rooms"("key");

-- CreateIndex
CREATE UNIQUE INDEX "chat_rooms_event_id_key" ON "booking"."chat_rooms"("event_id");

-- CreateIndex
CREATE INDEX "chat_rooms_organization_id_kind_idx" ON "booking"."chat_rooms"("organization_id", "kind");

-- CreateIndex
CREATE INDEX "chat_messages_room_id_id_idx" ON "booking"."chat_messages"("room_id", "id");

-- CreateIndex
CREATE INDEX "chat_reads_user_id_idx" ON "booking"."chat_reads"("user_id");

-- AddForeignKey
ALTER TABLE "auth"."members" ADD CONSTRAINT "members_team_role_id_fkey" FOREIGN KEY ("team_role_id") REFERENCES "booking"."team_roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "auth"."invitations" ADD CONSTRAINT "invitations_team_role_id_fkey" FOREIGN KEY ("team_role_id") REFERENCES "booking"."team_roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking"."event_members" ADD CONSTRAINT "event_members_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "booking"."events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking"."chat_rooms" ADD CONSTRAINT "chat_rooms_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "booking"."events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking"."chat_messages" ADD CONSTRAINT "chat_messages_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "booking"."chat_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking"."chat_reads" ADD CONSTRAINT "chat_reads_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "booking"."chat_rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Allowed values.
ALTER TABLE "booking"."chat_rooms" ADD CONSTRAINT "chat_rooms_kind_check" CHECK ("kind" IN ('team', 'event', 'direct'));
ALTER TABLE "booking"."chat_messages" ADD CONSTRAINT "chat_messages_content_check" CHECK ("body" <> '' OR "file" IS NOT NULL OR "deleted_at" IS NOT NULL);
