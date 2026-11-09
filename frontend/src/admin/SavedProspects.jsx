import { useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { toast } from 'sonner';
import { useAdminForm } from '../hooks/admin/useAdminForm.js';
import { downloadProspectsCsv } from '../hooks/admin/useProspects.js';
import { prospectGroupSchema, savedProspectNoteSchema } from '../lib/adminSchemas.js';
import {
  createProspectGroup,
  deleteProspectGroup,
  fetchProspectGroups,
  fetchSavedProspects,
  refreshSavedProspects,
  removeSavedProspect,
  renameProspectGroup,
  saveProspects,
  savedGroupShown,
  savedProspectSelected,
  updateSavedProspect,
} from '../store/adminSavedProspectsSlice.js';
import { Chance, EmailCell, ExternalLink, SocialCell, WebsiteCell } from './prospectCells.jsx';
import { AdminButton, Field, Notice, Panel, SelectInput, Spinner, TextInput } from './ui.jsx';

// Saving prospects into groups: the controls on the Search tab (SaveCell, BulkSave) and the
// Saved tab (SavedTab). Backend: backend/src/prospects/saved-prospects.service.ts.

const MAX_BULK = 200; // the API saves at most 200 at a time
const errorMessage = (err, fallback) => err?.message ?? fallback;
const when = (iso) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(iso));

/** The groups (ProspectsPage loads them once per visit, via useLoadProspectGroups). */
const useGroups = () => useSelector((s) => s.adminSavedProspects.groups);

export function useLoadProspectGroups() {
  const dispatch = useDispatch();
  useEffect(() => {
    dispatch(fetchProspectGroups());
  }, [dispatch]);
}

/**
 * A select value -> a group id: 'none' -> null, 'new' -> asks for a name and creates the group
 * (undefined if cancelled or it failed).
 */
async function resolveGroup(dispatch, value) {
  if (value === 'none') return null;
  if (value !== 'new') return Number(value);
  const name = window.prompt('Name for the new group (e.g. "Makati dentists"):')?.trim();
  if (!name) return undefined;
  try {
    await prospectGroupSchema.validate({ name });
    return (await dispatch(createProspectGroup(name)).unwrap()).id;
  } catch (err) {
    toast.error(errorMessage(err, 'The group was not created.'));
    return undefined;
  }
}

/** Native select: no group, each group, "+ New group…", and (optional) remove. */
function GroupSelect({ value, groups, placeholder, withRemove = false, className = '', ...rest }) {
  return (
    <SelectInput value={value} className={`py-1.5 text-sm ${className}`} onClick={(e) => e.stopPropagation()} {...rest}>
      {placeholder && (
        <option value="" disabled>
          {placeholder}
        </option>
      )}
      <option value="none">No group</option>
      {groups.map((g) => (
        <option key={g.id} value={String(g.id)}>
          {g.name}
        </option>
      ))}
      <option value="new">+ New group…</option>
      {withRemove && <option value="remove">Remove from saved</option>}
    </SelectInput>
  );
}

const groupValue = (groupId) => (groupId == null ? 'none' : String(groupId));

// ---------------------------------------------------------------- Search tab

/** One search result: "Save to…", or its group (change it, or remove it from saved). */
export function SaveCell({ p, searchId }) {
  const dispatch = useDispatch();
  const groups = useGroups();
  const onChange = async (e) => {
    const value = e.target.value;
    try {
      if (value === 'remove') {
        await dispatch(removeSavedProspect({ id: p.saved.id })).unwrap();
        toast.success(`Removed ${p.name} from saved.`);
        return;
      }
      const groupId = await resolveGroup(dispatch, value);
      if (groupId === undefined) return;
      if (p.saved) await dispatch(updateSavedProspect({ id: p.saved.id, groupId })).unwrap();
      else await dispatch(saveProspects({ searchId, itemIds: [p.id], groupId })).unwrap();
      toast.success(`Saved ${p.name}${groupId ? ` to ${groups.find((g) => g.id === groupId)?.name ?? 'the group'}` : ''}.`);
    } catch (err) {
      toast.error(errorMessage(err, 'That did not save. Please try again.'));
    } finally {
      dispatch(refreshSavedProspects());
    }
  };
  return (
    <div className="w-40" onClick={(e) => e.stopPropagation()}>
      {p.saved && <div className="mb-1 text-[11px] font-bold tracking-wider text-circuit-teal uppercase">✓ Saved</div>}
      <GroupSelect aria-label={`Save ${p.name}`} value={p.saved ? groupValue(p.saved.groupId) : ''} placeholder={p.saved ? undefined : 'Save to…'} groups={groups} withRemove={!!p.saved} onChange={onChange} />
    </div>
  );
}

/** "Save all shown…": every result on screen (after filters) into one group. */
export function BulkSave({ searchId, items }) {
  const dispatch = useDispatch();
  const groups = useGroups();
  const onChange = async (e) => {
    const value = e.target.value;
    e.target.value = '';
    const groupId = await resolveGroup(dispatch, value);
    if (groupId === undefined) return;
    const itemIds = items.slice(0, MAX_BULK).map((p) => p.id);
    try {
      const r = await dispatch(saveProspects({ searchId, itemIds, groupId })).unwrap();
      const into = groupId ? ` to ${groups.find((g) => g.id === groupId)?.name ?? 'the group'}` : '';
      toast.success(`Saved ${r.created + r.updated}${into}${r.updated ? ` (${r.updated} were already saved)` : ''}.${items.length > MAX_BULK ? ` Only the first ${MAX_BULK} were saved.` : ''}`);
    } catch (err) {
      toast.error(errorMessage(err, 'They did not save. Please try again.'));
    } finally {
      dispatch(refreshSavedProspects());
    }
  };
  return <GroupSelect aria-label="Save all shown results" className="w-48 py-2" value="" placeholder={`Save all ${items.length} shown…`} groups={groups} onChange={onChange} disabled={!items.length} />;
}

// ---------------------------------------------------------------- Saved tab

function NewGroupForm() {
  const dispatch = useDispatch();
  const { register, handleSubmit, reset, formState, applyServerErrors } = useAdminForm(prospectGroupSchema, { name: '' });
  const onSubmit = handleSubmit(async ({ name }) => {
    const r = await dispatch(createProspectGroup(name));
    if (createProspectGroup.rejected.match(r)) return applyServerErrors(r.payload ?? { fields: { name: 'The group was not created.' } });
    reset({ name: '' });
    dispatch(savedGroupShown(r.payload.id));
    dispatch(fetchSavedProspects(r.payload.id));
  });
  return (
    <form onSubmit={onSubmit} noValidate className="mt-4 border-t border-line pt-4">
      <Field label="New group" id="new-group" error={formState.errors.name?.message}>
        <TextInput id="new-group" placeholder="e.g. Makati dentists" autoComplete="off" error={formState.errors.name} {...register('name')} />
      </Field>
      <AdminButton type="submit" variant="outline" className="min-h-10 w-full py-2" busy={formState.isSubmitting}>
        Add group
      </AdminButton>
    </form>
  );
}

function GroupList() {
  const dispatch = useDispatch();
  const { groups, total, ungrouped, group } = useSelector((s) => s.adminSavedProspects);
  const show = (g) => {
    dispatch(savedGroupShown(g));
    dispatch(fetchSavedProspects(g));
  };
  const entries = [{ key: 'all', label: 'All saved', count: total }, { key: 'none', label: 'No group', count: ungrouped }, ...groups.map((g) => ({ key: g.id, label: g.name, count: g.count }))];
  return (
    <Panel className="self-start p-4 mobile:p-4">
      <h2 className="mb-2 px-2 text-xs font-bold tracking-wider text-soft-violet uppercase">Groups</h2>
      <ul className="space-y-0.5">
        {entries.map((e) => (
          <li key={e.key}>
            <button
              type="button"
              onClick={() => show(e.key)}
              aria-current={group === e.key ? 'true' : undefined}
              className={`flex w-full cursor-pointer items-center justify-between gap-2 rounded-btn px-3 py-2 text-left text-sm ${group === e.key ? 'bg-byte-purple font-semibold text-cream-dough' : 'text-midnight-plum hover:bg-lavender-mist'}`}
            >
              <span className="truncate">{e.label}</span>
              <span className={`text-xs ${group === e.key ? 'text-lavender-mist' : 'text-muted'}`}>{e.count}</span>
            </button>
          </li>
        ))}
      </ul>
      <NewGroupForm />
    </Panel>
  );
}

function NoteForm({ p }) {
  const dispatch = useDispatch();
  const { register, handleSubmit, formState, applyServerErrors, reset } = useAdminForm(savedProspectNoteSchema, { note: p.note ?? '' });
  const onSubmit = handleSubmit(async ({ note }) => {
    const r = await dispatch(updateSavedProspect({ id: p.id, note: note || null }));
    if (updateSavedProspect.rejected.match(r)) return applyServerErrors(r.payload ?? { fields: { note: 'The note was not saved.' } });
    reset({ note: r.payload.note ?? '' });
    toast.success('Note saved.');
  });
  return (
    <form onSubmit={onSubmit} noValidate onClick={(e) => e.stopPropagation()}>
      <Field label="Note" id={`note-${p.id}`} error={formState.errors.note?.message}>
        <textarea
          id={`note-${p.id}`}
          rows={3}
          placeholder="e.g. Spoke to the owner, call back in January"
          aria-invalid={formState.errors.note ? 'true' : 'false'}
          className="block w-full rounded-btn border-2 border-line bg-cream-dough px-3.5 py-2.5 text-[15px] text-midnight-plum outline-none focus:border-soft-violet aria-[invalid=true]:border-danger"
          {...register('note')}
        />
      </Field>
      <AdminButton type="submit" variant="outline" className="min-h-10 py-2" busy={formState.isSubmitting} disabled={!formState.isDirty}>
        Save note
      </AdminButton>
    </form>
  );
}

function SavedDetails({ p }) {
  return (
    <div className="grid gap-5 bg-lavender-mist/40 px-5 py-4 text-sm desktop:grid-cols-3">
      <div>
        <h3 className="mb-2 text-xs font-bold tracking-wider text-soft-violet uppercase">Why this rank</h3>
        <ul className="space-y-1">
          {p.reasons.map((r) => (
            <li key={r.key} className="flex justify-between gap-3">
              <span className="text-midnight-plum">{r.label}</span>
              <span className={`font-semibold ${r.points < 0 ? 'text-danger' : 'text-circuit-teal'}`}>
                {r.points > 0 ? '+' : ''}
                {r.points}
              </span>
            </li>
          ))}
          {!p.reasons.length && <li className="text-muted">Not much to go on for this business.</li>}
        </ul>
        {p.pitch.length > 0 && (
          <>
            <h3 className="mt-4 mb-2 text-xs font-bold tracking-wider text-soft-violet uppercase">What to pitch</h3>
            <ul className="list-disc space-y-1 pl-5 text-midnight-plum">
              {p.pitch.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </>
        )}
      </div>
      <div className="space-y-1 text-midnight-plum">
        <h3 className="mb-2 text-xs font-bold tracking-wider text-soft-violet uppercase">Contact</h3>
        {p.address && <div>{p.address}</div>}
        {p.phone && (
          <div>
            <a href={`tel:${p.phone.replace(/[^\d+]/g, '')}`} onClick={(e) => e.stopPropagation()} className="font-semibold text-soft-violet hover:underline">
              {p.phone}
            </a>
          </div>
        )}
        {p.mapsUrl && <ExternalLink href={p.mapsUrl}>Open on the map</ExternalLink>}
        <p className="pt-2 text-xs text-muted">
          From a search for “{p.industry}” in {p.location}. Saved {when(p.savedAt)} by {p.savedBy}.
        </p>
      </div>
      <NoteForm p={p} />
    </div>
  );
}

function GroupActions({ group }) {
  const dispatch = useDispatch();
  const rename = async () => {
    const name = window.prompt('New name for the group:', group.name)?.trim();
    if (!name || name === group.name) return;
    try {
      await prospectGroupSchema.validate({ name });
      await dispatch(renameProspectGroup({ id: group.id, name })).unwrap();
      toast.success('Group renamed.');
    } catch (err) {
      toast.error(errorMessage(err, 'The group was not renamed.'));
    }
  };
  const remove = async () => {
    if (!window.confirm(`Delete the group “${group.name}”? Its ${group.count} prospect${group.count === 1 ? '' : 's'} stay saved, without a group.`)) return;
    try {
      await dispatch(deleteProspectGroup(group.id)).unwrap();
      dispatch(fetchSavedProspects('all'));
      toast.success('Group deleted.');
    } catch (err) {
      toast.error(errorMessage(err, 'The group was not deleted.'));
    }
  };
  return (
    <>
      <AdminButton variant="outline" className="min-h-10 py-2" onClick={rename}>
        Rename
      </AdminButton>
      <AdminButton variant="danger" className="min-h-10 py-2" onClick={remove}>
        Delete group
      </AdminButton>
    </>
  );
}

export function SavedTab() {
  const dispatch = useDispatch();
  const groups = useGroups();
  const { group, items, status, error, selectedId, busyId, total } = useSelector((s) => s.adminSavedProspects);
  useEffect(() => {
    dispatch(fetchSavedProspects());
  }, [dispatch]);

  const shown = typeof group === 'number' ? groups.find((g) => g.id === group) : null;
  const title = shown?.name ?? (group === 'none' ? 'No group' : 'All saved');
  const select = (id) => dispatch(savedProspectSelected(id === selectedId ? null : id));
  const move = async (p, value) => {
    try {
      if (value === 'remove') {
        await dispatch(removeSavedProspect({ id: p.id })).unwrap();
        toast.success(`Removed ${p.name} from saved.`);
      } else {
        const groupId = await resolveGroup(dispatch, value);
        if (groupId === undefined) return;
        await dispatch(updateSavedProspect({ id: p.id, groupId })).unwrap();
      }
    } catch (err) {
      toast.error(errorMessage(err, 'That did not save. Please try again.'));
    } finally {
      dispatch(refreshSavedProspects());
    }
  };

  return (
    <div className="grid gap-5 desktop:grid-cols-[240px_minmax(0,1fr)]">
      <GroupList />
      <div className="min-w-0">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-midnight-plum">
            {title} <span className="text-sm font-semibold text-muted">({items.length})</span>
          </h2>
          <div className="flex flex-wrap gap-2">
            {shown && <GroupActions group={shown} />}
            <AdminButton
              variant="outline"
              className="min-h-10 py-2"
              disabled={!items.length}
              onClick={() => downloadProspectsCsv({ industry: title, location: 'saved' }, items.map((p, i) => ({ ...p, rank: i + 1 })))}
            >
              Download CSV
            </AdminButton>
          </div>
        </div>
        {error && <Notice tone="danger">{error}</Notice>}
        <Panel className="overflow-x-auto p-0 mobile:p-0">
          {status === 'loading' ? (
            <Spinner label="Loading saved prospects…" />
          ) : items.length === 0 ? (
            <p className="px-6 py-10 text-center text-muted">
              {total ? 'No saved prospects in this group yet.' : 'Nothing saved yet. On the Search tab, use “Save to…” on any business, or “Save all shown”.'}
            </p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="border-b border-line text-xs tracking-wider text-soft-violet uppercase">
                <tr>
                  <th className="px-4 py-3">Business</th>
                  <th className="px-4 py-3">Chance to sign up</th>
                  <th className="px-4 py-3">Website</th>
                  <th className="px-4 py-3">Social media</th>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Phone</th>
                  <th className="px-4 py-3">Group</th>
                </tr>
              </thead>
              <tbody>
                {items.map((p) => {
                  const open = p.id === selectedId;
                  return [
                    <tr
                      key={p.id}
                      onClick={() => select(p.id)}
                      aria-expanded={open}
                      className={`cursor-pointer border-b border-line/70 align-top hover:bg-lavender-mist/50 ${open ? 'bg-lavender-mist/60' : ''}`}
                    >
                      <td className="px-4 py-3">
                        <div className="font-semibold text-midnight-plum">{p.name}</div>
                        <div className="text-muted">{[p.category, p.city].filter(Boolean).join(' · ')}</div>
                        {p.note && <div className="mt-1 max-w-56 truncate text-xs text-soft-violet" title={p.note}>📝 {p.note}</div>}
                      </td>
                      <td className="px-4 py-3">
                        <Chance p={p} />
                      </td>
                      <td className="px-4 py-3">
                        <WebsiteCell p={p} />
                      </td>
                      <td className="px-4 py-3">
                        <SocialCell p={p} />
                      </td>
                      <td className="px-4 py-3">
                        <EmailCell p={p} />
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-midnight-plum">{p.phone || <span className="text-muted">—</span>}</td>
                      <td className="px-4 py-3">
                        <GroupSelect aria-label={`Group for ${p.name}`} className="w-40" value={groupValue(p.groupId)} groups={groups} withRemove disabled={busyId === p.id} onChange={(e) => move(p, e.target.value)} />
                      </td>
                    </tr>,
                    open && (
                      <tr key={`${p.id}-details`} className="border-b border-line/70">
                        <td colSpan={7} className="p-0">
                          <SavedDetails p={p} />
                        </td>
                      </tr>
                    ),
                  ];
                })}
              </tbody>
            </table>
          )}
        </Panel>
        <p className="mt-3 text-xs text-muted">Saved prospects keep the details and score from when they were saved. Saving one again from a new search updates it.</p>
      </div>
    </div>
  );
}
