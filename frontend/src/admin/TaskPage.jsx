import { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useAdminForm } from '../hooks/admin/useAdminForm.js';
import { subtaskDialogSchema, subtaskSchema } from '../lib/adminSchemas.js';
import { navigate, onRouteLinkClick } from '../lib/router.js';
import { addSubtask, deleteSubtask, deleteTask, fetchTasks, isDone, TASK_COLUMNS, updateSubtask, updateTask } from '../store/adminTasksSlice.js';
import { PageTitle } from './AdminLayout.jsx';
import { Dialog, useConfirm } from './dialogs.jsx';
import { assignedMessage, cardGrip, CardMenu, cardShell, deleteQuestion, FOCUS, FONT, Icon, ICONS, Kanban, pct, person, plural, StateLabel, SubtaskProgress, TaskDialog, TASKS_PATH, useAdmins, useRun } from './taskBoard.jsx';
import { AdminButton, Field, Notice, SelectInput, Spinner, TextInput } from './ui.jsx';

// One task's own page (/admin/tasks/:id), opened from its card on the task board (TasksPage.jsx):
// what the task is, who it is assigned to, how far along it is, and its subtasks as a board of their own with the same
// three columns (To do, In progress, Done). Subtasks are added here, dragged between columns or
// moved from their "⋯" menu, renamed and deleted. Every change shows at once and is shared live.

export function TaskPage({ id }) {
  const dispatch = useDispatch();
  const { tasks, status, error } = useSelector((s) => s.adminTasks);
  const confirm = useConfirm();
  const run = useRun();
  const admins = useAdmins();
  // The dialog shown: { mode: 'task' } (edit the task) or { mode: 'subtask', id } (edit a subtask).
  const [dialog, setDialog] = useState(null);

  useEffect(() => {
    dispatch(fetchTasks());
  }, [dispatch]);

  const task = tasks.find((t) => t.id === id);
  const back = (
    <a href={TASKS_PATH} onClick={onRouteLinkClick} className={`mb-4 inline-flex items-center gap-1.5 rounded-sm text-sm font-semibold text-byte-purple hover:underline ${FOCUS}`}>
      <Icon d={ICONS.back} strokeWidth={2.2} />
      All tasks
    </a>
  );

  if (!task) {
    return (
      <>
        {back}
        {status === 'loading' || status === 'idle' ? (
          <Spinner label="Loading the task…" />
        ) : status === 'error' ? (
          <Notice tone="danger">
            {error}{' '}
            <button type="button" className="cursor-pointer font-semibold underline" onClick={() => dispatch(fetchTasks())}>
              Try again
            </button>
          </Notice>
        ) : (
          <Notice tone="warning">Task {id} no longer exists. It may have been deleted.</Notice>
        )}
      </>
    );
  }

  const subtasks = task.subtasks;
  const total = subtasks.length;
  const finished = subtasks.filter(isDone).length;
  const doing = subtasks.filter((s) => s.status === 'in_progress').length;
  const assign = (email) => run(updateTask({ id: task.id, assignedTo: email }), assignedMessage(admins, email));
  // Dialogs follow the live subtask, so other admins' changes show (and a deleted one closes it).
  const editing = dialog?.mode === 'subtask' ? subtasks.find((s) => s.id === dialog.id) : null;
  const toBoard = () => navigate(TASKS_PATH, { replace: true });

  const onDelete = async () => {
    if (!(await confirm(deleteQuestion(task)))) return;
    toBoard();
    run(deleteTask(task.id), 'Task deleted.');
  };
  const moveSubtask = (s, to, position = 0) => run(updateSubtask({ taskId: task.id, id: s.id, status: to, position }));
  const deleteSub = async (s) => {
    const sure = await confirm({ title: 'Delete this subtask?', body: `“${s.title}” will be deleted. This can't be undone.`, action: 'Delete subtask' });
    if (sure) run(deleteSubtask({ taskId: task.id, id: s.id }));
  };

  return (
    <>
      {back}
      <PageTitle
        title={task.title}
        actions={
          <div className="flex flex-wrap items-end gap-3">
            <div className="w-52">
              <label htmlFor="task-assignee" className="mb-1 block text-xs font-semibold text-muted">
                Assigned to
              </label>
              <SelectInput id="task-assignee" value={task.assignedTo ?? ''} onChange={(e) => assign(e.target.value || null)}>
                <option value="">Unassigned</option>
                {admins.map((a) => (
                  <option key={a.email} value={a.email}>
                    {a.name}
                  </option>
                ))}
              </SelectInput>
            </div>
            <AdminButton variant="outline" onClick={() => setDialog({ mode: 'task' })}>
              <Icon d={ICONS.edit} />
              Edit details
            </AdminButton>
            <AdminButton variant="danger" onClick={onDelete}>
              <Icon d={ICONS.trash} />
              Delete
            </AdminButton>
          </div>
        }
      >
        <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
          <span>Task {task.id}</span>
          <span className="text-midnight-plum">
            <StateLabel status={task.status} />
          </span>
          <span>Created by {person(task.createdBy).name}</span>
        </span>
      </PageTitle>

      {task.description && <p className="mb-6 max-w-3xl text-[15px] whitespace-pre-line text-muted">{task.description}</p>}

      <div className="overflow-hidden rounded-card border border-line bg-cream-dough text-midnight-plum" style={FONT}>
        {/* Toolbar: how far along the subtasks are */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-line px-4 py-2.5">
          <div className="flex items-center gap-2">
            <Icon d={ICONS.check} className="size-5 text-byte-purple" />
            <h2 className="mb-0 text-[15px] font-semibold">Subtasks</h2>
          </div>
          <div className="flex min-w-48 flex-1 items-center gap-3">
            <SubtaskProgress subtasks={subtasks} className="h-1.5 max-w-64 flex-1" />
            <span className="text-[13px] text-muted">
              {total ? (
                <>
                  <strong className="font-semibold text-midnight-plum">{pct(finished, total)}%</strong> complete · {finished} of {total} done
                  {doing > 0 && ` · ${doing} in progress`}
                </>
              ) : (
                'No subtasks yet'
              )}
            </span>
          </div>
        </div>

        <AddSubtask taskId={task.id} run={run} />

        {total > 0 && finished === total && task.status !== 'done' && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-line bg-circuit-teal/12 px-4 py-2 text-[13px]" role="status">
            <Icon d={ICONS.check} className="size-4 text-circuit-teal" />
            All {plural(total, 'subtask')} done.
            <button type="button" onClick={() => run(updateTask({ id: task.id, status: 'done', position: 0 }), 'Task moved to Done.')} className={`cursor-pointer rounded-sm font-semibold text-byte-purple hover:underline ${FOCUS}`}>
              Move the task to Done
            </button>
          </div>
        )}

        <Kanban
          items={subtasks}
          laneClass="min-h-[40vh]"
          onMove={moveSubtask}
          renderCard={(s, { lifted }) => (
            <SubtaskCard
              subtask={s}
              lifted={lifted}
              menu={
                !lifted && (
                  <CardMenu
                    title={s.title}
                    status={s.status}
                    actions={[{ icon: ICONS.edit, label: 'Edit', onClick: () => setDialog({ mode: 'subtask', id: s.id }) }]}
                    onMove={(to) => moveSubtask(s, to)}
                    onDelete={() => deleteSub(s)}
                  />
                )
              }
            />
          )}
          emptyText={(col) => (total ? 'No subtasks' : col.status === 'todo' ? 'No subtasks yet. Add the first one above.' : 'No subtasks')}
        />
      </div>

      {dialog?.mode === 'task' && <TaskDialog key={`edit-${task.id}`} task={task} run={run} onClose={() => setDialog(null)} onDeleted={toBoard} />}
      {editing && <SubtaskDialog key={`subtask-${editing.id}`} task={task} subtask={editing} run={run} onClose={() => setDialog(null)} />}
    </>
  );
}

/** A new subtask: it goes to the bottom of To do, and the box is ready for the next one. */
function AddSubtask({ taskId, run }) {
  const { register, handleSubmit, reset, formState, setFocus } = useAdminForm(subtaskSchema, { title: '' });
  const onSubmit = handleSubmit(async ({ title }) => {
    if (await run(addSubtask({ taskId, title }))) {
      reset({ title: '' });
      setFocus('title');
    }
  });
  const inputId = `subtask-new-${taskId}`;
  return (
    <form onSubmit={onSubmit} noValidate className="flex items-start gap-2 border-b border-line px-4 py-3">
      <div className="max-w-xl min-w-0 flex-1">
        <label htmlFor={inputId} className="sr-only">
          New subtask
        </label>
        <TextInput id={inputId} placeholder="Add a subtask (it starts in To do)" autoComplete="off" className="py-2" error={formState.errors.title} {...register('title')} />
        {formState.errors.title && <p className="mt-1 text-[13px] text-danger">{formState.errors.title.message}</p>}
      </div>
      <AdminButton type="submit" className="min-h-11 px-4" busy={formState.isSubmitting}>
        <Icon d={ICONS.plus} strokeWidth={2.4} />
        Add
      </AdminButton>
    </form>
  );
}

/** A subtask's card (and, `lifted`, the copy that follows the pointer while it is dragged). */
function SubtaskCard({ subtask: s, lifted = false, menu }) {
  const done = isDone(s);
  return (
    <div className={`group ${cardShell} ${done ? 'border-l-circuit-teal' : 'border-l-soft-violet'} px-2.5 py-2 ${cardGrip(lifted)}`} style={lifted ? FONT : undefined}>
      <div className="flex items-start gap-1.5">
        <Icon d={ICONS.check} className={`mt-0.5 size-3.5 ${done ? 'text-circuit-teal' : 'text-soft-violet'}`} />
        <p className={`min-w-0 flex-1 text-[14px] leading-snug wrap-break-word ${done ? 'text-muted line-through' : ''}`}>{s.title}</p>
        {menu}
      </div>
    </div>
  );
}

/** Edit a subtask: its name and its state (column). */
function SubtaskDialog({ task, subtask, run, onClose }) {
  const { register, handleSubmit, formState } = useAdminForm(subtaskDialogSchema, { title: subtask.title, status: subtask.status });
  const onSubmit = handleSubmit(async (values) => {
    const changes = {};
    if (values.title !== subtask.title) changes.title = values.title;
    if (values.status !== subtask.status) Object.assign(changes, { status: values.status, position: 0 });
    if (!Object.keys(changes).length || (await run(updateSubtask({ taskId: task.id, id: subtask.id, ...changes }), 'Subtask saved.'))) onClose();
  });

  const id = `subtask-dialog-${subtask.id}`;
  return (
    <Dialog
      eyebrow={`Task ${task.id} · Edit subtask`}
      title={subtask.title}
      stripe="bg-soft-violet"
      onClose={onClose}
      footer={
        <div className="ml-auto flex gap-3">
          <AdminButton variant="outline" onClick={onClose}>
            Cancel
          </AdminButton>
          <AdminButton type="submit" form={`${id}-form`} busy={formState.isSubmitting}>
            Save
          </AdminButton>
        </div>
      }
    >
      <form id={`${id}-form`} onSubmit={onSubmit} noValidate className="px-6 pt-5 pb-1 mobile:px-5">
        <Field label="Subtask" id={`${id}-title`} error={formState.errors.title?.message}>
          <TextInput id={`${id}-title`} autoFocus autoComplete="off" error={formState.errors.title} {...register('title')} />
        </Field>
        <Field label="State" id={`${id}-state`} error={formState.errors.status?.message}>
          <SelectInput id={`${id}-state`} {...register('status')}>
            {TASK_COLUMNS.map((c) => (
              <option key={c.status} value={c.status}>
                {c.label}
              </option>
            ))}
          </SelectInput>
        </Field>
      </form>
    </Dialog>
  );
}
