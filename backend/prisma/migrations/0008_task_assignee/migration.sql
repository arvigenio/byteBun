-- Tasks can be assigned to an admin (their email, src/auth/admins.ts). NULL = nobody yet.

-- AlterTable
ALTER TABLE "admin_tasks" ADD COLUMN "assigned_to" VARCHAR(254);
