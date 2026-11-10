// The admin task board: tasks in three columns (to do, in progress, done). A task can have
// subtasks, which sit in the same three columns on the task's own board. Every change is announced
// live (realtime/admin-events.ts), so the boards stay the same for every signed-in admin.
//
// A task can be assigned to an admin. When an admin assigns one to another admin, that admin gets
// an email (task-emails.ts) and a live notice; assigning a task to yourself tells nobody.
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { adminName, ADMINS } from '../auth/admins';
import { MAILER } from '../auth/auth.module';
import type { Mailer } from '../auth/mailer';
import { ApiError } from '../common/api-error';
import { PrismaService } from '../database/prisma.service';
import { AdminEvents } from '../realtime/admin-events';
import { taskAssignedEmail } from './task-emails';
import {
  type CreateSubtaskInput,
  type CreateTaskInput,
  MAX_SUBTASKS,
  MAX_TASKS,
  type TaskStatus,
  type UpdateSubtaskInput,
  type UpdateTaskInput,
} from './tasks.schema';

const SUBTASK_ORDER = [{ position: 'asc' }, { id: 'asc' }] satisfies Prisma.AdminSubtaskOrderByWithRelationInput[];
const WITH_SUBTASKS = { subtasks: { orderBy: SUBTASK_ORDER } } satisfies Prisma.AdminTaskInclude;
type TaskRow = Prisma.AdminTaskGetPayload<{ include: typeof WITH_SUBTASKS }>;
type Tx = Prisma.TransactionClient;

function present(t: TaskRow) {
  return {
    id: t.id,
    title: t.title,
    description: t.description,
    status: t.status as TaskStatus,
    position: t.position,
    createdBy: t.createdBy,
    assignedTo: t.assignedTo,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
    completedAt: t.completedAt,
    subtasks: t.subtasks.map((s) => ({ id: s.id, title: s.title, status: s.status as TaskStatus, position: s.position })),
  };
}

const notFound = (what = 'task') => new ApiError(404, { error: 'not_found', message: `That ${what} no longer exists. It may have been deleted.` });
const COLUMN_ORDER = [{ position: 'asc' }, { id: 'asc' }] satisfies Prisma.AdminTaskOrderByWithRelationInput[];

/** A column's ids with `id` put at `position` (the top when not given, the bottom when past the end). */
function insertAt(others: { id: number }[], id: number, position?: number) {
  const at = Math.min(position ?? 0, others.length);
  return [...others.slice(0, at).map((x) => x.id), id, ...others.slice(at).map((x) => x.id)];
}

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: AdminEvents,
    @Inject(MAILER) private readonly mailer: Mailer,
  ) {}

  /** The whole board, in column order, and the admins a task can be assigned to. */
  async list() {
    const rows = await this.prisma.adminTask.findMany({ include: WITH_SUBTASKS, orderBy: COLUMN_ORDER });
    return { tasks: rows.map(present), admins: ADMINS.map((a) => ({ name: a.name, email: a.email })) };
  }

  /**
   * The task was just assigned to `task.assignedTo` by `by`: email them, and give the live notice
   * to send with the "tasks.changed" event. Undefined (and no email) when nobody is to be told:
   * nobody is assigned, or the admin assigned the task to themselves.
   */
  private assigned(task: TaskRow, by: { email: string }) {
    const to = task.assignedTo;
    const from = by.email.toLowerCase();
    if (!to || to === from) return undefined;
    this.mailer.sendInBackground(taskAssignedEmail(task, to, from));
    return { taskId: task.id, title: task.title, to, by: { name: adminName(from) ?? from, email: from } };
  }

  async create(input: CreateTaskInput, by: { email: string }) {
    const status = (input.status ?? 'todo') as TaskStatus;
    const task = await this.prisma.$transaction(async (tx) => {
      if ((await tx.adminTask.count()) >= MAX_TASKS) {
        throw new ApiError(409, { error: 'too_many_tasks', message: `The board is full (${MAX_TASKS} tasks). Clear finished tasks first.` });
      }
      // New tasks go on top of their column.
      await tx.adminTask.updateMany({ where: { status }, data: { position: { increment: 1 } } });
      return tx.adminTask.create({
        data: {
          title: input.title,
          description: input.description || null,
          status,
          position: 0,
          createdBy: by.email,
          assignedTo: input.assignedTo ?? null,
          completedAt: status === 'done' ? new Date() : null,
        },
        include: WITH_SUBTASKS,
      });
    });
    this.events.tasksChanged(this.assigned(task, by));
    return present(task);
  }

  async update(id: number, input: UpdateTaskInput, by: { email: string }) {
    let reassigned = false;
    const task = await this.prisma.$transaction(async (tx) => {
      const current = await tx.adminTask.findUnique({ where: { id } });
      if (!current) throw notFound();
      reassigned = input.assignedTo !== undefined && input.assignedTo !== current.assignedTo;
      const status = (input.status ?? current.status) as TaskStatus;
      const changedColumn = status !== current.status;
      await tx.adminTask.update({
        where: { id },
        data: {
          ...(input.title !== undefined && { title: input.title }),
          ...(input.description !== undefined && { description: input.description || null }),
          ...(input.assignedTo !== undefined && { assignedTo: input.assignedTo }),
          ...(changedColumn && { status, completedAt: status === 'done' ? new Date() : null }),
        },
      });
      if (changedColumn || input.position !== undefined) await this.place(tx, id, current.status, status, input.position);
      return tx.adminTask.findUniqueOrThrow({ where: { id }, include: WITH_SUBTASKS });
    });
    this.events.tasksChanged(reassigned ? this.assigned(task, by) : undefined);
    return present(task);
  }

  /** Puts the task at `position` in column `to` (the top when not given) and renumbers both columns. */
  private async place(tx: Tx, id: number, from: string, to: string, position?: number) {
    const others = await tx.adminTask.findMany({ where: { status: to, id: { not: id } }, orderBy: COLUMN_ORDER, select: { id: true } });
    for (const [i, taskId] of insertAt(others, id, position).entries()) await tx.adminTask.update({ where: { id: taskId }, data: { position: i } });
    if (from !== to) {
      const left = await tx.adminTask.findMany({ where: { status: from }, orderBy: COLUMN_ORDER, select: { id: true } });
      for (const [i, t] of left.entries()) await tx.adminTask.update({ where: { id: t.id }, data: { position: i } });
    }
  }

  async remove(id: number) {
    const { count } = await this.prisma.adminTask.deleteMany({ where: { id } });
    if (!count) throw notFound();
    this.events.tasksChanged();
    return { ok: true };
  }

  /** Empties the board, only once every task and every subtask is done. */
  async clearAll() {
    const deleted = await this.prisma.$transaction(async (tx) => {
      const open = await tx.adminTask.count({ where: { OR: [{ status: { not: 'done' } }, { subtasks: { some: { status: { not: 'done' } } } }] } });
      if (open) {
        throw new ApiError(409, {
          error: 'tasks_not_done',
          message: `${open} task${open === 1 ? ' is' : 's are'} not finished yet. The board can be cleared once everything is done.`,
        });
      }
      return (await tx.adminTask.deleteMany({})).count;
    });
    if (deleted) this.events.tasksChanged();
    return { deleted };
  }

  // ---------------------------------------------------------------- subtasks

  async addSubtask(taskId: number, input: CreateSubtaskInput) {
    await this.prisma.$transaction(async (tx) => {
      if (!(await tx.adminTask.findUnique({ where: { id: taskId }, select: { id: true } }))) throw notFound();
      const count = await tx.adminSubtask.count({ where: { taskId } });
      if (count >= MAX_SUBTASKS) throw new ApiError(409, { error: 'too_many_subtasks', message: `A task can have up to ${MAX_SUBTASKS} subtasks.` });
      // New subtasks go to the bottom of To do, so steps stay in the order they were written.
      const last = await tx.adminSubtask.findFirst({ where: { taskId, status: 'todo' }, orderBy: { position: 'desc' }, select: { position: true } });
      await tx.adminSubtask.create({ data: { taskId, title: input.title, status: 'todo', position: (last?.position ?? -1) + 1 } });
    });
    return this.touched(taskId);
  }

  async updateSubtask(taskId: number, id: number, input: UpdateSubtaskInput) {
    await this.prisma.$transaction(async (tx) => {
      const current = await tx.adminSubtask.findFirst({ where: { id, taskId } });
      if (!current) throw notFound('subtask');
      const status = (input.status ?? current.status) as TaskStatus;
      const changedColumn = status !== current.status;
      if (input.title !== undefined || changedColumn) {
        await tx.adminSubtask.update({ where: { id }, data: { ...(input.title !== undefined && { title: input.title }), ...(changedColumn && { status }) } });
      }
      if (changedColumn || input.position !== undefined) await this.placeSubtask(tx, taskId, id, current.status, status, input.position);
    });
    return this.touched(taskId);
  }

  /** Like `place`, for a subtask on its task's board. */
  private async placeSubtask(tx: Tx, taskId: number, id: number, from: string, to: string, position?: number) {
    const others = await tx.adminSubtask.findMany({ where: { taskId, status: to, id: { not: id } }, orderBy: SUBTASK_ORDER, select: { id: true } });
    for (const [i, subId] of insertAt(others, id, position).entries()) await tx.adminSubtask.update({ where: { id: subId }, data: { position: i } });
    if (from !== to) {
      const left = await tx.adminSubtask.findMany({ where: { taskId, status: from }, orderBy: SUBTASK_ORDER, select: { id: true } });
      for (const [i, s] of left.entries()) await tx.adminSubtask.update({ where: { id: s.id }, data: { position: i } });
    }
  }

  async removeSubtask(taskId: number, id: number) {
    const { count } = await this.prisma.adminSubtask.deleteMany({ where: { id, taskId } });
    if (!count) throw notFound('subtask');
    return this.touched(taskId);
  }

  /** A subtask changed: bump the task's updatedAt, announce it, and answer with the task. */
  private async touched(taskId: number) {
    const task = await this.prisma.adminTask.update({ where: { id: taskId }, data: { updatedAt: new Date() }, include: WITH_SUBTASKS }).catch((err) => {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') throw notFound();
      throw err;
    });
    this.events.tasksChanged();
    return present(task);
  }
}
