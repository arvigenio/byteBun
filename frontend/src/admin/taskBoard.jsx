import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { toast } from 'sonner';
import {
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useAdminForm } from '../hooks/admin/useAdminForm.js';
import { taskDialogSchema } from '../lib/adminSchemas.js';
import { createTask, deleteTask, fetchTasks, isDone, selectColumns, TASK_COLUMNS, updateTask } from '../store/adminTasksSlice.js';
import { Dialog, useConfirm } from './dialogs.jsx';
import { AdminButton, Field, SelectInput, TextInput } from './ui.jsx';

// What the two task boards share: the board of all tasks (TasksPage.jsx) and one task's board of
// subtasks (TaskPage.jsx). Both are a kanban with a column per state (To do, In progress, Done).
//
// Drag a card by mouse, touch (press and hold) or keyboard (focus it, Space, arrows, Space) to
// move or reorder it; each card's "⋯" menu does the same without dragging.
//
// A task can be assigned to an admin (Assignee, assignActions, the task dialog). The admin it is
// assigned to is emailed and told live, unless they assigned it to themselves (the API decides).
//
// Colors are the site's brand tokens only (index.css resets Tailwind's default palette).

export const TASKS_PATH = '/admin/tasks';
export const taskPath = (id) => `${TASKS_PATH}/${id}`;

export const FOCUS = 'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-soft-violet';
export const FONT = { fontFamily: '"Segoe UI", -apple-system, BlinkMacSystemFont, Roboto, "Helvetica Neue", sans-serif' };
export const STATE = {
  todo: { dot: 'bg-muted/40', label: 'To do' },
  in_progress: { dot: 'bg-soft-violet', label: 'In progress' },
  done: { dot: 'bg-circuit-teal', label: 'Done' },
};
const TEXTAREA =
  'block w-full rounded-btn border-2 border-line bg-cream-dough px-3.5 py-2.5 text-[15px] text-midnight-plum outline-none transition-colors placeholder:text-muted/60 focus:border-soft-violet aria-[invalid=true]:border-danger';

export const pct = (n, total) => (total ? Math.round((n / total) * 100) : 0);
export const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** "josue.mapagdalita@…" -> { name: "Josue Mapagdalita", initials: "JM" } */
export function person(email = '') {
  const parts = email.split('@')[0].split(/[._-]+/).filter(Boolean);
  const name = parts.map((p) => p[0].toUpperCase() + p.slice(1)).join(' ') || email;
  return { name, initials: (parts[0]?.[0] ?? '?').toUpperCase() + (parts[1]?.[0] ?? '').toUpperCase() };
}
const AVATAR_TONES = ['bg-byte-purple text-cream-dough', 'bg-circuit-teal text-midnight-plum', 'bg-bun-orange text-midnight-plum', 'bg-soft-violet text-cream-dough'];
export const avatarTone = (email = '') => AVATAR_TONES[[...email].reduce((n, ch) => n + ch.charCodeAt(0), 0) % AVATAR_TONES.length];

/** The admins a task can be assigned to: [{ name, email }] (loaded with the tasks). */
export const useAdmins = () => useSelector((s) => s.adminTasks.admins);
export const adminName = (admins, email) => admins.find((a) => a.email === email)?.name ?? person(email).name;

/** Who a task is assigned to: their initials and name, or "Unassigned". */
export function Assignee({ email, className = '' }) {
  const admins = useAdmins();
  if (!email) {
    return (
      <span className={`flex min-w-0 items-center gap-1.5 text-muted/80 ${className}`}>
        <span className="size-5 flex-none rounded-full border border-dashed border-muted/60" aria-hidden="true" />
        <span className="truncate">Unassigned</span>
      </span>
    );
  }
  const name = adminName(admins, email);
  return (
    <span className={`flex min-w-0 items-center gap-1.5 ${className}`} title={`Assigned to ${name}`}>
      <span className={`grid size-5 flex-none place-items-center rounded-full text-[9px] font-semibold ${avatarTone(email)}`} aria-hidden="true">
        {person(name.replace(/\s+/g, '.')).initials}
      </span>
      <span className="truncate">{name}</span>
    </span>
  );
}

/** "Assign to …" entries for a card's ⋯ menu: every admin it is not assigned to, and "Unassign". */
export function assignActions(task, admins, assign) {
  const others = admins.filter((a) => a.email !== task.assignedTo).map((a) => ({ icon: ICONS.user, label: `Assign to ${a.name}`, onClick: () => assign(task, a.email) }));
  return task.assignedTo ? [...others, { icon: ICONS.userOff, label: 'Unassign', onClick: () => assign(task, null) }] : others;
}

/** What the toast says once a task has been assigned. */
export const assignedMessage = (admins, email) => (email ? `Assigned to ${adminName(admins, email)}.` : 'Task unassigned.');

export function Icon({ d, className = 'size-4', strokeWidth = 1.8 }) {
  return (
    <svg viewBox="0 0 24 24" className={`${className} shrink-0`} fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}
export const ICONS = {
  plus: 'M12 5v14M5 12h14',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  check: 'M4 4h16v16H4zM8 12l3 3 5-6',
  task: 'M9 11l3 3 8-8M20 12v7a1 1 0 01-1 1H5a1 1 0 01-1-1V5a1 1 0 011-1h11',
  trash: 'M4 7h16M10 11v6M14 11v6M5 7l1 12a2 2 0 002 2h8a2 2 0 002-2l1-12M9 7V4h6v3',
  edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4 12.5-12.5z',
  open: 'M14 4h6v6M20 4l-8 8M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5',
  back: 'M19 12H5M11 6l-6 6 6 6',
  user: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM5 21a7 7 0 0114 0',
  userOff: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM5 21a7 7 0 0114 0M4 4l16 16',
};

/** A state's colored dot and name. */
export function StateLabel({ status }) {
  const state = STATE[status] ?? STATE.todo;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`size-2 rounded-full ${state.dot}`} aria-hidden="true" />
      {state.label}
    </span>
  );
}

/**
 * A line showing how far a task's subtasks are: the done share in teal, then the share in progress
 * in violet. Give it a height and width (`className`).
 */
export function SubtaskProgress({ subtasks, className = '' }) {
  const total = subtasks.length;
  const done = subtasks.filter(isDone).length;
  const doing = subtasks.filter((s) => s.status === 'in_progress').length;
  return (
    <div
      role="progressbar"
      aria-label="Subtasks done"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct(done, total)}
      title={`${done} of ${plural(total, 'subtask')} done${doing ? `, ${doing} in progress` : ''}`}
      className={`flex overflow-hidden rounded-full bg-lavender-mist ${className}`}
    >
      <div className="h-full bg-circuit-teal transition-[width] duration-300" style={{ width: `${(done / (total || 1)) * 100}%` }} />
      <div className="h-full bg-soft-violet transition-[width] duration-300" style={{ width: `${(doing / (total || 1)) * 100}%` }} />
    </div>
  );
}

/**
 * `run(action, success?)` runs a change. If the server refuses, it says why and reloads the tasks
 * (undoing the change shown ahead of the answer) and gives null; otherwise the server's answer.
 */
export function useRun() {
  const dispatch = useDispatch();
  return useCallback(
    async (action, success) => {
      const r = await dispatch(action);
      if (r.meta.requestStatus === 'rejected') {
        toast.error(r.payload?.message || 'That change was not saved. Please try again.');
        dispatch(fetchTasks());
        return null;
      }
      if (success) toast.success(success);
      return r.payload;
    },
    [dispatch],
  );
}

// ---------------------------------------------------------------- the board

const LANE_PREFIX = 'lane-';
const laneId = (status) => `${LANE_PREFIX}${status}`;

/**
 * A kanban board: one column per state, cards that can be dragged between and inside columns.
 *   items       [{ id, status, position }] (tasks, or one task's subtasks)
 *   onMove      (item, status, position) => void, when a card is dropped somewhere new
 *   renderCard  (item, { lifted }) => the card; `lifted` is the copy that follows the pointer
 *   columnTop   (column) => something above the column's cards (optional)
 *   emptyText   (column) => what an empty column says (optional)
 *   laneClass   the columns' minimum height
 */
export function Kanban({ items, onMove, renderCard, columnTop, emptyText, laneClass = 'min-h-[55vh]' }) {
  const columns = useMemo(() => selectColumns(items), [items]);
  const byId = useMemo(() => new Map(items.map((t) => [t.id, t])), [items]);
  const base = useMemo(() => Object.fromEntries(columns.map((c) => [c.status, c.items.map((t) => t.id)])), [columns]);

  // While a card is dragged, the columns as they would be if it were dropped now.
  const [draft, setDraft] = useState(null);
  const [activeId, setActiveId] = useState(null);
  const start = useRef(null); // { status, index } where the dragged card started
  const lanes = draft ?? base;

  const sensors = useSensors(
    // A small move (mouse) or a short press (touch) starts a drag, so clicks on a card's
    // buttons still work and the page still scrolls on phones.
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const laneOf = (id, l = lanes) => {
    if (typeof id === 'string' && id.startsWith(LANE_PREFIX)) return id.slice(LANE_PREFIX.length);
    return Object.keys(l).find((k) => l[k].includes(id));
  };

  const onDragStart = ({ active }) => {
    const status = laneOf(active.id, base);
    start.current = { status, index: base[status].indexOf(active.id) };
    setActiveId(active.id);
    setDraft(base);
  };

  // Over another column: move the card into it, above or below the card it's over.
  const onDragOver = ({ active, over }) => {
    if (!over) return;
    setDraft((d) => {
      const cur = d ?? base;
      const from = laneOf(active.id, cur);
      const to = laneOf(over.id, cur);
      if (!from || !to || from === to) return cur;
      const target = cur[to].filter((x) => x !== active.id);
      const overIndex = target.indexOf(over.id);
      const below = active.rect.current.translated && over.rect && active.rect.current.translated.top > over.rect.top + over.rect.height / 2;
      target.splice(overIndex >= 0 ? overIndex + (below ? 1 : 0) : target.length, 0, active.id);
      return { ...cur, [from]: cur[from].filter((x) => x !== active.id), [to]: target };
    });
  };

  const onDragEnd = ({ active, over }) => {
    const cur = draft ?? base;
    const begin = start.current;
    setActiveId(null);
    setDraft(null);
    start.current = null;
    if (!over || !begin) return;
    const lane = laneOf(active.id, cur);
    let ids = cur[lane];
    // Reordering inside the column it is now in.
    if (laneOf(over.id, cur) === lane && over.id !== active.id && ids.includes(over.id)) ids = arrayMove(ids, ids.indexOf(active.id), ids.indexOf(over.id));
    const index = ids.indexOf(active.id);
    if (lane === begin.status && index === begin.index) return;
    onMove(byId.get(active.id), lane, index);
  };

  const onDragCancel = () => {
    setActiveId(null);
    setDraft(null);
    start.current = null;
  };

  const active = activeId != null ? byId.get(activeId) : null;

  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd} onDragCancel={onDragCancel}>
      {/* Phones scroll sideways, a column at a time. */}
      <div className="snap-x snap-mandatory overflow-x-auto bg-lavender-mist/45">
        <div className="grid min-w-full auto-cols-[minmax(272px,1fr)] grid-flow-col gap-2 p-2 mobile:auto-cols-[86%]">
          {TASK_COLUMNS.map((col) => (
            <Column key={col.status} col={col} ids={lanes[col.status]} byId={byId} activeId={activeId} renderCard={renderCard} top={columnTop?.(col)} empty={emptyText?.(col) ?? 'No items'} laneClass={laneClass} />
          ))}
        </div>
      </div>
      <DragOverlay dropAnimation={{ duration: 160, easing: 'ease-out' }}>{active ? renderCard(active, { lifted: true }) : null}</DragOverlay>
    </DndContext>
  );
}

function Column({ col, ids, byId, activeId, renderCard, top, empty, laneClass }) {
  const { setNodeRef } = useDroppable({ id: laneId(col.status) });
  const cards = ids.map((id) => byId.get(id)).filter(Boolean);
  const target = activeId != null && ids.includes(activeId); // where the dragged card would land

  return (
    <section aria-label={col.label} className="flex snap-start flex-col">
      <header className="flex items-baseline gap-2 border-b-2 border-line px-2 pt-1.5 pb-2">
        <h3 className="mb-0 text-[14px] font-semibold">{col.label}</h3>
        <span className="text-[13px] text-muted/80">{cards.length}</span>
      </header>

      {top && <div className="px-0.5 pt-2">{top}</div>}

      <SortableContext id={laneId(col.status)} items={ids} strategy={verticalListSortingStrategy}>
        <ul ref={setNodeRef} className={`flex ${laneClass} flex-1 flex-col gap-2 rounded-sm px-0.5 pt-2 pb-6 transition-colors ${target ? 'bg-lavender-mist' : ''}`}>
          {cards.map((item) => (
            <SortableCard key={item.id} id={item.id}>
              {renderCard(item, { lifted: false })}
            </SortableCard>
          ))}
          {!cards.length && <li className="rounded-sm border border-dashed border-line px-3 py-6 text-center text-[13px] text-muted/80">{activeId != null ? 'Drop here' : empty}</li>}
        </ul>
      </SortableContext>
    </section>
  );
}

function SortableCard({ id, children }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  // Space / Enter pick the card up only when the card itself has focus, not one of its buttons.
  const onKeyDown = (e) => {
    if (e.target === e.currentTarget) listeners?.onKeyDown?.(e);
  };
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      className={`touch-manipulation rounded-sm outline-none focus-visible:outline-2 focus-visible:outline-soft-violet ${isDragging ? 'opacity-40' : ''}`}
      {...attributes}
      {...listeners}
      onKeyDown={onKeyDown}
    >
      {children}
    </li>
  );
}

// ---------------------------------------------------------------- cards

export const cardShell = 'rounded-sm border-l-4 bg-cream-dough shadow-[0_1.6px_3.6px_rgb(26_10_51/0.13),0_0.3px_0.9px_rgb(26_10_51/0.11)]';
export const liftedShadow = 'shadow-[0_6.4px_14.4px_rgb(26_10_51/0.16),0_1.2px_3.6px_rgb(26_10_51/0.12)]';
/** How a card looks in its column, and while it is dragged. */
export const cardGrip = (lifted) => (lifted ? `rotate-1 cursor-grabbing ${liftedShadow}` : 'cursor-grab');

/** Keeps a press inside a card's ⋯ menu from starting a drag (or Space from picking the card up). */
const stopDrag = {
  onPointerDown: (e) => e.stopPropagation(),
  onMouseDown: (e) => e.stopPropagation(),
  onTouchStart: (e) => e.stopPropagation(),
  onKeyDown: (e) => e.stopPropagation(),
};

/**
 * A card's "⋯" menu: its own `actions` ([{ icon, label, onClick }]), then move to another column,
 * then delete. Shown on hover: the card needs the `group` class.
 */
export function CardMenu({ title, actions, status, onMove, onDelete }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => {
      if (!ref.current?.contains(e.target)) setOpen(false);
    };
    const esc = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('touchstart', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('touchstart', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  const item = 'flex w-full cursor-pointer items-center gap-2.5 px-3 py-1.5 text-left text-[13px] text-midnight-plum hover:bg-lavender-mist';
  const pick = (fn) => () => {
    setOpen(false);
    fn();
  };

  return (
    <div ref={ref} className="relative -mt-1 -mr-1" {...stopDrag}>
      <button
        type="button"
        aria-label={`Actions for ${title}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`grid size-7 cursor-pointer place-items-center rounded-sm text-muted opacity-0 group-hover:opacity-100 hover:bg-lavender-mist focus-visible:opacity-100 aria-expanded:opacity-100 mobile:opacity-100 ${FOCUS}`}
      >
        <Icon d={ICONS.more} className="size-5" strokeWidth={3} />
      </button>
      {open && (
        <div role="menu" className={`absolute top-8 right-0 z-20 w-48 rounded-sm border border-line bg-cream-dough py-1 ${liftedShadow}`} style={FONT}>
          {actions.map((a) => (
            <button key={a.label} type="button" role="menuitem" className={item} onClick={pick(a.onClick)}>
              <Icon d={a.icon} />
              {a.label}
            </button>
          ))}
          <div className="my-1 border-t border-line" />
          <p className="px-3 pt-1 pb-0.5 text-[11px] font-semibold text-muted/80">Move to column</p>
          {TASK_COLUMNS.filter((c) => c.status !== status).map((c) => (
            <button key={c.status} type="button" role="menuitem" className={item} onClick={pick(() => onMove(c.status))}>
              <span className={`ml-1 size-2 rounded-full ${STATE[c.status].dot}`} aria-hidden="true" />
              <span className="ml-0.5">{c.label}</span>
            </button>
          ))}
          <div className="my-1 border-t border-line" />
          <button type="button" role="menuitem" className={`${item} text-danger`} onClick={pick(onDelete)}>
            <Icon d={ICONS.trash} />
            Delete
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- the task dialog

/** What the confirmation says before a task is deleted. */
export function deleteQuestion(task) {
  const n = task.subtasks.length;
  return {
    title: 'Delete this task?',
    body: `“${task.title}”${n ? ` and its ${plural(n, 'subtask')}` : ''} will be deleted. This can't be undone.`,
    action: 'Delete task',
  };
}

/**
 * New task (no `task`) or edit one: title, description, state and who it is assigned to. Subtasks
 * are managed on the task's own page. `onDeleted` runs once the admin has confirmed deleting the task.
 */
export function TaskDialog({ task, status = 'todo', run, onClose, onDeleted }) {
  const confirm = useConfirm();
  const admins = useAdmins();
  const isNew = !task;
  const { register, handleSubmit, formState } = useAdminForm(taskDialogSchema, {
    title: task?.title ?? '',
    description: task?.description ?? '',
    status: task?.status ?? status,
    assignedTo: task?.assignedTo ?? '',
  });

  const onSubmit = handleSubmit(async (values) => {
    const description = values.description?.trim() || null;
    const assignedTo = values.assignedTo || null;
    if (isNew) {
      if (await run(createTask({ title: values.title, status: values.status, ...(description && { description }), ...(assignedTo && { assignedTo }) }), 'Task added.')) onClose();
      return;
    }
    const changes = {};
    if (assignedTo !== (task.assignedTo ?? null)) changes.assignedTo = assignedTo;
    if (values.title !== task.title) changes.title = values.title;
    if (description !== (task.description ?? null)) changes.description = description;
    if (values.status !== task.status) Object.assign(changes, { status: values.status, position: 0 });
    if (!Object.keys(changes).length || (await run(updateTask({ id: task.id, ...changes }), 'Task saved.'))) onClose();
  });

  const onDelete = async () => {
    if (!(await confirm(deleteQuestion(task)))) return;
    onClose();
    onDeleted?.();
    run(deleteTask(task.id), 'Task deleted.');
  };

  const id = isNew ? 'task-dialog-new' : `task-dialog-${task.id}`;
  return (
    <Dialog
      eyebrow={isNew ? 'New task' : `Task ${task.id} · Edit details`}
      title={isNew ? 'Add a task' : task.title}
      onClose={onClose}
      footer={
        <>
          {!isNew && (
            <AdminButton variant="danger" onClick={onDelete} className="mr-auto">
              <Icon d={ICONS.trash} />
              Delete
            </AdminButton>
          )}
          <div className="ml-auto flex gap-3">
            <AdminButton variant="outline" onClick={onClose}>
              Cancel
            </AdminButton>
            <AdminButton type="submit" form={`${id}-form`} busy={formState.isSubmitting}>
              {isNew ? 'Add task' : 'Save'}
            </AdminButton>
          </div>
        </>
      }
    >
      <form id={`${id}-form`} onSubmit={onSubmit} noValidate className="px-6 pt-5 mobile:px-5">
        <Field label="Title" id={`${id}-title`} error={formState.errors.title?.message}>
          <TextInput id={`${id}-title`} autoFocus autoComplete="off" placeholder="e.g. Send the proposal to Santos Dental" error={formState.errors.title} {...register('title')} />
        </Field>
        <Field label="Description (optional)" id={`${id}-desc`} error={formState.errors.description?.message}>
          <textarea id={`${id}-desc`} rows={4} className={TEXTAREA} aria-invalid={formState.errors.description ? 'true' : 'false'} {...register('description')} />
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
        <Field label="Assigned to" id={`${id}-assignee`} hint="They get an email when you assign a task to them (not when you assign it to yourself)." error={formState.errors.assignedTo?.message}>
          <SelectInput id={`${id}-assignee`} {...register('assignedTo')}>
            <option value="">Unassigned</option>
            {admins.map((a) => (
              <option key={a.email} value={a.email}>
                {a.name}
              </option>
            ))}
          </SelectInput>
        </Field>
        {isNew && <p className="-mt-1 mb-5 text-[13px] text-muted">Add subtasks after creating it: open the task from its card.</p>}
      </form>
    </Dialog>
  );
}
