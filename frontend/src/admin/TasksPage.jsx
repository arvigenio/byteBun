import { useCallback, useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { toast } from 'sonner';
import { navigate } from '../lib/router.js';
import { clearTasks, deleteTask, fetchTasks, isDone, isFinished, updateTask } from '../store/adminTasksSlice.js';
import { PageTitle } from './AdminLayout.jsx';
import { useConfirm } from './dialogs.jsx';
import { assignActions, assignedMessage, Assignee, cardGrip, CardMenu, cardShell, deleteQuestion, FOCUS, FONT, Icon, ICONS, Kanban, pct, person, plural, StateLabel, SubtaskProgress, TaskDialog, taskPath, useAdmins, useRun } from './taskBoard.jsx';
import { AdminButton, Notice, Spinner } from './ui.jsx';

// The task board, laid out like a work-tracking kanban board: a toolbar, one column per state
// (To do, In progress, Done) with a plain header and count, and compact cards (ID, title, state,
// who it is assigned to, subtasks). New and edited tasks open in a dialog; a card's title opens the task's own
// page (TaskPage.jsx), where its subtasks are a board of their own.
//
// Drag a card to move or reorder it; the "⋯" menu also moves, assigns, edits and deletes. Once everything
// is done the whole board can be cleared. Every change shows at once and is shared live with the
// other admins. The board itself, the cards' menu and the task dialog are in taskBoard.jsx.

const TASK_STRIPE = 'border-l-honey-gold'; // every card here is a task

export function TasksPage() {
  const dispatch = useDispatch();
  const { tasks, status, error } = useSelector((s) => s.adminTasks);
  const confirm = useConfirm();
  const run = useRun();
  // The dialog shown: { mode: 'new', status } or { mode: 'edit', id } (title, description, state).
  const [dialog, setDialog] = useState(null);

  useEffect(() => {
    dispatch(fetchTasks());
  }, [dispatch]);

  const done = tasks.filter((t) => t.status === 'done').length;
  const allFinished = tasks.length > 0 && tasks.every(isFinished);
  const openNew = useCallback((s = 'todo') => setDialog({ mode: 'new', status: s }), []);
  // The edit dialog follows the live task, so other admins' changes show (and a deleted task closes it).
  const editing = dialog?.mode === 'edit' ? tasks.find((t) => t.id === dialog.id) : null;
  const moveTo = (task, to) => run(updateTask({ id: task.id, status: to, position: 0 }));

  const onClear = async () => {
    const sure = await confirm({
      title: 'Clear the board?',
      body: `All ${plural(tasks.length, 'task')} and their subtasks will be deleted. This can't be undone.`,
      action: 'Clear board',
    });
    if (!sure) return;
    const r = await run(clearTasks());
    if (r) toast.success(`Board cleared: ${plural(r.deleted, 'task')} deleted.`);
  };

  return (
    <>
      <PageTitle
        title="Tasks"
        actions={
          <AdminButton onClick={() => openNew()}>
            <Icon d={ICONS.plus} strokeWidth={2.4} />
            New task
          </AdminButton>
        }
      >
        Your shared board. Drag cards between columns, or use a card's ⋯ menu. Open a task to work on its subtasks.
      </PageTitle>

      <div className="overflow-hidden rounded-card border border-line bg-cream-dough text-midnight-plum" style={FONT}>
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-3 border-b border-line px-4 py-2.5">
          <div className="flex items-center gap-2">
            <Icon d={ICONS.task} className="size-5 text-byte-purple" />
            <h2 className="mb-0 text-[15px] font-semibold">Board</h2>
          </div>
          <div className="flex min-w-48 flex-1 items-center gap-3" title={`${done} of ${tasks.length} tasks done`}>
            <div
              role="progressbar"
              aria-label="Tasks done"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct(done, tasks.length)}
              className="h-1.5 max-w-64 flex-1 overflow-hidden rounded-full bg-lavender-mist"
            >
              <div className="h-full bg-circuit-teal transition-[width] duration-300" style={{ width: `${pct(done, tasks.length)}%` }} />
            </div>
            <span className="text-[13px] whitespace-nowrap text-muted">
              <strong className="font-semibold text-midnight-plum">{pct(done, tasks.length)}%</strong> complete · {done} of {tasks.length} done
            </span>
          </div>
          <button
            type="button"
            onClick={onClear}
            disabled={!allFinished}
            title={allFinished ? 'Delete every task' : 'Finish every task and subtask to clear the board'}
            className={`flex cursor-pointer items-center gap-1.5 rounded-sm px-2 py-1.5 text-[13px] text-danger hover:bg-lavender-mist disabled:cursor-not-allowed disabled:text-muted/50 disabled:hover:bg-transparent ${FOCUS}`}
          >
            <Icon d={ICONS.trash} />
            Clear board
          </button>
        </div>

        {allFinished && (
          <div className="flex items-center gap-2 border-b border-line bg-circuit-teal/12 px-4 py-2 text-[13px]" role="status">
            <Icon d={ICONS.check} className="size-4 text-circuit-teal" />
            Everything on the board is done. Use <strong className="font-semibold">Clear board</strong> to delete it all and start fresh.
          </div>
        )}

        {status === 'loading' || status === 'idle' ? (
          <div className="px-4">
            <Spinner label="Loading tasks…" />
          </div>
        ) : status === 'error' ? (
          <div className="p-4">
            <Notice tone="danger">
              {error}{' '}
              <button type="button" className="cursor-pointer font-semibold underline" onClick={() => dispatch(fetchTasks())}>
                Try again
              </button>
            </Notice>
          </div>
        ) : (
          <Kanban
            items={tasks}
            onMove={(task, to, position) => run(updateTask({ id: task.id, status: to, position }))}
            renderCard={(task, { lifted }) =>
              lifted ? <CardFace task={task} lifted /> : <TaskCard task={task} run={run} moveTo={moveTo} onEdit={() => setDialog({ mode: 'edit', id: task.id })} />
            }
            columnTop={(col) =>
              col.status === 'todo' && (
                <button
                  type="button"
                  onClick={() => openNew(col.status)}
                  className={`flex w-full cursor-pointer items-center gap-1.5 rounded-sm px-2 py-1.5 text-left text-[13px] font-semibold text-byte-purple hover:bg-lavender-mist ${FOCUS}`}
                >
                  <Icon d={ICONS.plus} strokeWidth={2.4} />
                  New item
                </button>
              )
            }
            emptyText={(col) => (col.status === 'todo' ? 'No items. Use New item to add one.' : 'No items')}
          />
        )}
      </div>

      {dialog?.mode === 'new' && <TaskDialog key="new" status={dialog.status} run={run} onClose={() => setDialog(null)} />}
      {editing && <TaskDialog key={`edit-${editing.id}`} task={editing} run={run} onClose={() => setDialog(null)} />}
    </>
  );
}

// ---------------------------------------------------------------- cards

/** The card as it looks in a column (and, `lifted`, following the pointer while dragged). */
function CardFace({ task, lifted = false, menu, onOpen }) {
  const total = task.subtasks.length;
  const finished = task.subtasks.filter(isDone).length;
  const title = <span className={`font-semibold ${task.status === 'done' ? 'text-muted line-through' : ''}`}>{task.title}</span>;
  return (
    <div className={`${cardShell} ${TASK_STRIPE} px-2.5 pt-2 pb-2 ${cardGrip(lifted)}`} style={lifted ? FONT : undefined}>
      <div className="flex items-start gap-1.5">
        <Icon d={ICONS.task} className="mt-0.5 size-3.5 text-gold-dark" />
        <p className="min-w-0 flex-1 text-[14px] leading-snug wrap-break-word">
          <span className="mr-1.5 text-muted">{task.id}</span>
          {onOpen ? (
            <button type="button" onClick={onOpen} title="Open task" className={`cursor-pointer rounded-sm text-left hover:text-byte-purple hover:underline ${FOCUS}`}>
              {title}
            </button>
          ) : (
            title
          )}
        </p>
        {menu}
      </div>

      <dl className="mt-2 grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1 pl-5 text-[12px]">
        <dt className="text-muted/80">State</dt>
        <dd>
          <StateLabel status={task.status} />
        </dd>
        <dt className="text-muted/80">Created by</dt>
        <dd className="truncate">{person(task.createdBy).name}</dd>
      </dl>

      <div className="mt-2 flex items-center gap-2 pl-5">
        <Assignee email={task.assignedTo} className="text-[12px]" />
        {(total > 0 || onOpen) && (
          <button
            type="button"
            onClick={onOpen}
            aria-label={total ? `Subtasks: ${finished} of ${total} done. Open task` : 'Add subtasks. Open task'}
            title={total ? `${finished} of ${total} subtasks done` : 'Add subtasks'}
            className={`ml-auto flex flex-none cursor-pointer items-center gap-1 rounded-sm px-1 py-0.5 text-[12px] hover:bg-lavender-mist ${finished === total && total ? 'font-semibold text-circuit-teal' : 'text-muted'} ${FOCUS}`}
          >
            <Icon d={ICONS.check} className="size-3.5" />
            {total ? `${finished}/${total}` : '+'}
          </button>
        )}
      </div>

      {/* How far its subtasks are, as a line. */}
      {total > 0 && (
        <div className="mt-2 flex items-center gap-2 pl-5">
          <SubtaskProgress subtasks={task.subtasks} className="h-1.5 flex-1" />
          <span className={`text-[11px] font-semibold tabular-nums ${finished === total ? 'text-circuit-teal' : 'text-muted'}`}>{pct(finished, total)}%</span>
        </div>
      )}
    </div>
  );
}

function TaskCard({ task, run, moveTo, onEdit }) {
  const confirm = useConfirm();
  const admins = useAdmins();
  const assign = (t, email) => run(updateTask({ id: t.id, assignedTo: email }), assignedMessage(admins, email));
  const total = task.subtasks.length;
  const finished = task.subtasks.filter(isDone).length;
  const open = () => navigate(taskPath(task.id));

  const onDelete = async () => {
    if (await confirm(deleteQuestion(task))) run(deleteTask(task.id), 'Task deleted.');
  };

  return (
    <div className="group">
      <CardFace
        task={task}
        onOpen={open}
        menu={
          <CardMenu
            title={task.title}
            status={task.status}
            actions={[
              { icon: ICONS.open, label: 'Open', onClick: open },
              { icon: ICONS.edit, label: 'Edit details', onClick: onEdit },
              ...assignActions(task, admins, assign),
            ]}
            onMove={(to) => moveTo(task, to)}
            onDelete={onDelete}
          />
        }
      />
      {total > 0 && finished === total && task.status !== 'done' && (
        <button type="button" onClick={() => moveTo(task, 'done')} className="mt-1 ml-1 cursor-pointer text-[12px] font-semibold text-byte-purple hover:underline">
          All subtasks done · move to Done
        </button>
      )}
    </div>
  );
}
