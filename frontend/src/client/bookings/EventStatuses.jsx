import { BulkHeader, bulkBlocks } from './BulkGroups.jsx';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { useEventCheckInMutation, useUndoEventCheckInMutation } from '../api.js';
import { fmtTime } from '../lib/format.js';
import { Button, Icon, IconButton, ICONS, Input, useConfirm } from '../ui.jsx';

// Onsite events: who's in and who has claimed what, at a glance. One row per registration
// (confirmed, or a code given but not used yet), a column for Attendance and one per claimable:
// a check (with the time) when admitted or claimed, a pending mark when not. Attendance is also
// where staff check people in by hand (with a confirmation) or undo it. Live: the event page
// refreshes on every scan (useEventLive).

const PENDING = 'M12 7v5l3 2M21 12a9 9 0 11-18 0 9 9 0 0118 0z';

function Cell({ at, tz, label }) {
  return at ? (
    <span className="inline-flex items-center gap-1.5 text-ok" title={`${label}: ${fmtTime(at, tz)}`}>
      <span className="grid size-6 place-items-center rounded-full bg-ok text-white">
        <Icon d={ICONS.check} className="size-3.5" />
      </span>
      <span className="text-xs font-medium tabular-nums mobile:hidden">{fmtTime(at, tz)}</span>
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 text-faint" title={`${label}: not yet`}>
      <span className="grid size-6 place-items-center rounded-full border-2 border-dashed border-line-strong">
        <Icon d={PENDING} className="size-3.5" />
      </span>
      <span className="text-xs mobile:hidden">Pending</span>
    </span>
  );
}

export function EventStatuses({ e, tickets, claimables, tz }) {
  const [query, setQuery] = useState('');
  const [checkIn, checkInState] = useEventCheckInMutation();
  const [undo] = useUndoEventCheckInMutation();
  const confirm = useConfirm();
  const admit = async (t) => {
    const ok = await confirm({
      title: `Check in ${t.name}?`,
      body: `${t.email} · ${t.code}${t.status === 'pending' ? '. Their code wasn’t used to register yet: checking in registers them too.' : '.'} They’re emailed that they checked in.`,
      action: 'Check in',
    });
    if (!ok) return;
    const r = await checkIn({ id: e.id, ticketId: t.id, force: true });
    if (r.error) toast.error(r.error.message);
    else toast.success(`${t.name} checked in`);
  };
  const unadmit = async (t) => {
    if (!(await confirm({ title: `Undo ${t.name}’s check-in?`, body: 'They’re shown as not admitted again.', action: 'Undo check-in' }))) return;
    const r = await undo({ id: e.id, ticketId: t.id });
    if (r.error) toast.error(r.error.message);
    else toast.success('Check-in undone');
  };
  const rows = useMemo(() => tickets.filter((t) => t.status === 'confirmed' || t.status === 'pending').sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id), [tickets]);
  const q = query.trim().toLowerCase();
  const qCode = q.replace(/[^a-z0-9]/g, '');
  const shown = rows.filter((t) => !q || t.name.toLowerCase().includes(q) || (qCode.length >= 2 && (t.code ?? '').replace('-', '').toLowerCase().includes(qCode)));
  const claimedAt = (t, id) => (t.claims ?? []).find((c) => c.claimableId === id)?.claimedAt ?? null;
  const admitted = rows.filter((t) => t.checkedInAt).length;

  return (
    <section className="overflow-hidden rounded-card border border-line bg-surface">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div>
          <h2 className="font-semibold">Statuses</h2>
          <p className="text-xs text-muted">Attendance and claimables for everyone registered. Check people in by hand here; it updates live as people are scanned.</p>
        </div>
        <div className="relative w-full desktop:w-80">
          <Icon d="M21 21l-4.3-4.3M17 10.5a6.5 6.5 0 11-13 0 6.5 6.5 0 0113 0z" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
          <Input type="search" value={query} onChange={(x) => setQuery(x.target.value)} placeholder="Search by name or code" className="pl-9" aria-label="Search by name or code" />
        </div>
      </header>
      {!rows.length ? (
        <p className="px-4 py-8 text-center text-sm text-faint">Nobody is registered yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-max text-sm">
            <thead>
              <tr className="border-b border-line bg-sunken/50 text-left text-xs font-semibold tracking-wide text-muted uppercase">
                <th className="sticky left-0 bg-sunken/95 px-4 py-2.5">Name</th>
                <th className="px-4 py-2.5">
                  Attendance
                  <span className="ml-1.5 font-normal tracking-normal normal-case tabular-nums">
                    {admitted}/{rows.length}
                  </span>
                </th>
                {claimables.map((k) => (
                  <th key={k.id} className="px-4 py-2.5">
                    {k.name}
                    <span className="ml-1.5 font-normal tracking-normal normal-case tabular-nums">
                      {rows.filter((t) => claimedAt(t, k.id)).length}/{rows.length}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {!shown.length && (
                <tr>
                  <td colSpan={2 + claimables.length} className="px-4 py-8 text-center text-faint">
                    Nobody matches “{query.trim()}”.
                  </td>
                </tr>
              )}
              {bulkBlocks(shown).flatMap((blk) => {
                const bulk = blk.groupId && rows.filter((x) => x.groupId === blk.groupId).length > 1;
                const head = bulk ? (
                  <tr key={blk.key} className="bg-brand-soft/50">
                    <td colSpan={2 + claimables.length} className="sticky left-0 border-l-4 border-l-brand px-4 py-2">
                      <BulkHeader name={blk.items[0].name} spots={rows.filter((x) => x.groupId === blk.groupId).length} facts={[`${rows.filter((x) => x.groupId === blk.groupId && x.checkedInAt).length} admitted`, ...claimables.map((k) => `${rows.filter((x) => x.groupId === blk.groupId && claimedAt(x, k.id)).length} ${k.name}`)]} />
                    </td>
                  </tr>
                ) : null;
                return [head, ...blk.items.map((t, i) => (
                <tr key={t.id} className={bulk ? 'bg-brand-soft/15 hover:bg-brand-soft/30' : 'hover:bg-sunken/40'}>
                  <td className={bulk ? 'sticky left-0 border-l-4 border-l-brand bg-surface px-4 py-2.5 pl-8' : 'sticky left-0 bg-surface px-4 py-2.5'}>
                    {bulk && <p className="text-[11px] font-semibold tracking-wide text-brand uppercase">Spot {i + 1}</p>}
                    <p className="font-medium">{t.name}</p>
                    <p className="font-mono text-xs tracking-wider text-faint">
                      {t.code}
                      {t.status === 'pending' && <span className="ml-1.5 font-sans tracking-normal">· code not used yet</span>}
                    </p>
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="flex items-center gap-2">
                      <Cell at={t.checkedInAt} tz={tz} label="Admitted" />
                      {t.checkedInAt ? (
                        <IconButton icon={ICONS.undo} label="Undo check-in" onClick={() => unadmit(t)} />
                      ) : (
                        <Button size="sm" variant="secondary" onClick={() => admit(t)} loading={checkInState.isLoading && checkInState.originalArgs?.ticketId === t.id}>
                          <Icon d={ICONS.check} className="size-4" /> Check in
                        </Button>
                      )}
                    </span>
                  </td>
                  {claimables.map((k) => (
                    <td key={k.id} className="px-4 py-2.5">
                      <Cell at={claimedAt(t, k.id)} tz={tz} label={k.name} />
                    </td>
                  ))}
                </tr>
              ))].filter(Boolean);
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
