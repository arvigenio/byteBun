-- Subtasks get the same three states as tasks (todo, in_progress, done), so a task's own page can
-- show them as a board. Ticked subtasks become "done"; the rest start in "todo".

-- AlterTable
ALTER TABLE "admin_subtasks" ADD COLUMN "status" VARCHAR(20) NOT NULL DEFAULT 'todo';

UPDATE "admin_subtasks" SET "status" = 'done' WHERE "done";

ALTER TABLE "admin_subtasks" DROP COLUMN "done";
