import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import * as adminApi from '../api/admin.js';

// The task board (admin/TasksPage.jsx) and each task's own board of subtasks (admin/TaskPage.jsx).
// Tasks and subtasks sit in the same three columns. Moves, renames and deletes show at once
// (optimistic); if the server refuses, the page reloads the tasks (taskBoard.jsx: useRun). Other
// admins' changes arrive live (hooks/admin/useAdminRealtime.js -> refreshTasks).
// A task can be assigned to one of `admins` (assignedTo: their email, or null for nobody).
//
// Action types start with "adminTasks/" so a 401 signs out like the rest (store/adminStore.js).
export const TASK_COLUMNS = [
  { status: 'todo', label: 'To do' },
  { status: 'in_progress', label: 'In progress' },
  { status: 'done', label: 'Done' },
];

const fail = (err) => ({ message: err.message, status: err.status, fields: err.fields ?? {} });
const thunk = (type, fn) =>
  createAsyncThunk(type, async (arg, api) => {
    try {
      return await fn(arg, api);
    } catch (err) {
      return api.rejectWithValue(fail(err));
    }
  });

export const fetchTasks = thunk('adminTasks/list', (_, { signal }) => adminApi.listTasks({ signal }));
/** { title, description?, status?, assignedTo? } -> top of its column. */
export const createTask = thunk('adminTasks/create', (fields) => adminApi.createTask(fields));
/** { id, title?, description?, status?, position?, assignedTo? } */
export const updateTask = thunk('adminTasks/update', ({ id, ...fields }) => adminApi.updateTask(id, fields));
export const deleteTask = thunk('adminTasks/delete', async (id) => {
  await adminApi.deleteTask(id);
  return { id };
});
export const clearTasks = thunk('adminTasks/clear', () => adminApi.clearTasks());
/** { taskId, title } */
export const addSubtask = thunk('adminTasks/subtasks/add', ({ taskId, title }) => adminApi.addSubtask(taskId, title));
/** { taskId, id, title?, status?, position? } */
export const updateSubtask = thunk('adminTasks/subtasks/update', ({ taskId, id, ...fields }) => adminApi.updateSubtask(taskId, id, fields));
/** { taskId, id } */
export const deleteSubtask = thunk('adminTasks/subtasks/delete', ({ taskId, id }) => adminApi.deleteSubtask(taskId, id));

/** After any change (here or by another admin): reload the board if it has been opened. */
export const refreshTasks = () => (dispatch, getState) => {
  if (getState().adminTasks.status !== 'idle') dispatch(fetchTasks());
};

const byPosition = (a, b) => a.position - b.position || a.id - b.id;

/** Moves a task (or a subtask, among its task's subtasks) to `status` at `position` and renumbers both columns, like the server does. */
function moveLocal(tasks, id, status, position) {
  const task = tasks.find((t) => t.id === id);
  if (!task) return;
  const from = task.status;
  const target = tasks.filter((t) => t.status === status && t.id !== id).sort(byPosition);
  target.splice(Math.min(position ?? 0, target.length), 0, task);
  task.status = status;
  target.forEach((t, i) => {
    t.position = i;
  });
  if (from !== status) {
    tasks
      .filter((t) => t.status === from)
      .sort(byPosition)
      .forEach((t, i) => {
        t.position = i;
      });
  }
}

const tasksSlice = createSlice({
  name: 'adminTasks',
  initialState: {
    tasks: [],
    admins: [], // [{ name, email }]: who a task can be assigned to
    status: 'idle', // idle | loading | ready | error
    error: '',
  },
  reducers: {},
  extraReducers: (b) => {
    const upsert = (s, { payload }) => {
      const i = s.tasks.findIndex((t) => t.id === payload.id);
      if (i >= 0) {
        // Keep the local position (the server renumbered the others too; the live reload syncs it).
        s.tasks[i] = { ...payload, position: s.tasks[i].status === payload.status ? s.tasks[i].position : payload.position };
      } else {
        s.tasks.push(payload);
      }
    };

    b.addCase(fetchTasks.pending, (s) => {
      if (s.status !== 'ready') s.status = 'loading';
    })
      .addCase(fetchTasks.fulfilled, (s, { payload }) => {
        s.tasks = payload.tasks;
        s.admins = payload.admins ?? s.admins;
        s.status = 'ready';
        s.error = '';
      })
      .addCase(fetchTasks.rejected, (s, { payload }) => {
        if (s.status !== 'ready') s.status = 'error';
        s.error = payload?.message || 'The tasks could not be loaded.';
      })
      .addCase(createTask.fulfilled, (s, { payload }) => {
        for (const t of s.tasks) if (t.status === payload.status) t.position += 1;
        s.tasks.push(payload);
      })
      .addCase(updateTask.pending, (s, { meta: { arg } }) => {
        const task = s.tasks.find((t) => t.id === arg.id);
        if (!task) return;
        if (arg.title !== undefined) task.title = arg.title;
        if (arg.description !== undefined) task.description = arg.description;
        if (arg.assignedTo !== undefined) task.assignedTo = arg.assignedTo;
        if (arg.status !== undefined || arg.position !== undefined) moveLocal(s.tasks, arg.id, arg.status ?? task.status, arg.position);
      })
      .addCase(updateTask.fulfilled, upsert)
      .addCase(deleteTask.pending, (s, { meta: { arg: id } }) => {
        s.tasks = s.tasks.filter((t) => t.id !== id);
      })
      .addCase(clearTasks.fulfilled, (s) => {
        s.tasks = [];
      })
      .addCase(addSubtask.fulfilled, upsert)
      .addCase(updateSubtask.pending, (s, { meta: { arg } }) => {
        const task = s.tasks.find((t) => t.id === arg.taskId);
        const sub = task?.subtasks.find((x) => x.id === arg.id);
        if (!sub) return;
        if (arg.title !== undefined) sub.title = arg.title;
        if (arg.status !== undefined || arg.position !== undefined) moveLocal(task.subtasks, arg.id, arg.status ?? sub.status, arg.position);
      })
      .addCase(updateSubtask.fulfilled, upsert)
      .addCase(deleteSubtask.pending, (s, { meta: { arg } }) => {
        const task = s.tasks.find((t) => t.id === arg.taskId);
        if (task) task.subtasks = task.subtasks.filter((x) => x.id !== arg.id);
      })
      .addCase(deleteSubtask.fulfilled, upsert);
  },
});

export default tasksSlice.reducer;

/** Tasks (or one task's subtasks) as columns, each sorted top to bottom. */
export const selectColumns = (items) => TASK_COLUMNS.map((c) => ({ ...c, items: items.filter((t) => t.status === c.status).sort(byPosition) }));

/** A task or subtask in the Done column. */
export const isDone = (x) => x.status === 'done';
/** A task counts as finished when it is in Done and so is every one of its subtasks. */
export const isFinished = (t) => isDone(t) && t.subtasks.every(isDone);
