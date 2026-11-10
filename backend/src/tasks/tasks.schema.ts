import * as yup from 'yup';
import { ADMINS } from '../auth/admins';

// The admin task board (/api/admin/tasks). Mirrored by frontend/src/lib/adminSchemas.js
// (taskSchema, subtaskSchema). Tasks and subtasks share the same three states (columns).
export const TASK_STATUSES = ['todo', 'in_progress', 'done'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const MAX_TASKS = 500;
export const MAX_SUBTASKS = 50;

const title = (what: string) =>
  yup
    .string()
    .trim()
    .transform((v: string) => v.replace(/\s+/g, ' '))
    .max(200, `${what} is too long (200 characters max).`);
const description = yup.string().trim().max(2000, 'Description is too long (2000 characters max).').nullable();
const status = yup.string().oneOf(TASK_STATUSES, 'Unknown column.');
// Who the task is for: one of the admins (their email), or null for nobody.
const assignedTo = yup
  .string()
  .trim()
  .lowercase()
  .nullable()
  .oneOf([...ADMINS.map((a) => a.email), null], 'Pick one of the admins.');

export const createTaskSchema = yup.object({
  title: title('Title').required('Enter a title for the task.'),
  description: description.optional(),
  status: status.optional(),
  assignedTo: assignedTo.optional(),
});

// Moving a task: status (its column) and position (its place in that column, from 0).
export const updateTaskSchema = yup.object({
  title: title('Title').min(1, 'Enter a title for the task.').optional(),
  description: description.optional(),
  status: status.optional(),
  position: yup.number().integer().min(0).max(MAX_TASKS).typeError('Unknown position.').optional(),
  assignedTo: assignedTo.optional(),
});

export const createSubtaskSchema = yup.object({
  title: title('Subtask').required('Enter the subtask.'),
});

// Moving a subtask on its task's board: status (its column) and position (its place there, from 0).
export const updateSubtaskSchema = yup.object({
  title: title('Subtask').min(1, 'Enter the subtask.').optional(),
  status: status.optional(),
  position: yup.number().integer().min(0).max(MAX_SUBTASKS).typeError('Unknown position.').optional(),
});

export type CreateTaskInput = yup.InferType<typeof createTaskSchema>;
export type UpdateTaskInput = yup.InferType<typeof updateTaskSchema>;
export type CreateSubtaskInput = yup.InferType<typeof createSubtaskSchema>;
export type UpdateSubtaskInput = yup.InferType<typeof updateSubtaskSchema>;
