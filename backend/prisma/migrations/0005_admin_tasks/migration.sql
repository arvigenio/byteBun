-- Admin task board: tasks and their subtasks.

-- CreateTable
CREATE TABLE "admin_tasks" (
    "id" SERIAL NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" VARCHAR(2000),
    "status" VARCHAR(20) NOT NULL DEFAULT 'todo',
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_by" VARCHAR(254) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),

    CONSTRAINT "admin_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_subtasks" (
    "id" SERIAL NOT NULL,
    "task_id" INTEGER NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "done" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_subtasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ix_admin_tasks_status_position" ON "admin_tasks"("status", "position");

-- CreateIndex
CREATE INDEX "ix_admin_subtasks_task_id" ON "admin_subtasks"("task_id");

-- AddForeignKey
ALTER TABLE "admin_subtasks" ADD CONSTRAINT "admin_subtasks_task_id_fkey" FOREIGN KEY ("task_id") REFERENCES "admin_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
