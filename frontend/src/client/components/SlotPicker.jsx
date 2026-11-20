import { useEffect, useMemo, useState } from 'react';
import { addDays, fmtDate, fmtTime, zoneName } from '../lib/format.js';
import { Loading } from '../ui.jsx';

// Pick a day, then a time (time slots mode) — or just a day (date-only mode, with spots left).
// `days` come from an availability endpoint: [{ date, status: open|full|closed, slots, spotsLeft }].
// Times are shown in the business's time zone.
export function SlotPicker({ data, loading, from, onFromChange, today, value, onChange }) {
  const days = data?.days ?? [];
  const mode = data?.mode ?? 'slots';
  const tz = data?.timeZone;
  const firstOpen = days.find((d) => d.status === 'open')?.date;
  const [day, setDay] = useState(null);
  const selectedDay = days.find((d) => d.date === day && d.status === 'open') ? day : firstOpen;
  useEffect(() => setDay(null), [from]);
  const current = days.find((d) => d.date === selectedDay);
  const visible = useMemo(() => days.slice(0, 28), [days]);

  if (loading && !data) return <Loading label="Finding open times…" />;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <button type="button" className="cursor-pointer rounded-md px-2 py-1 text-sm text-muted hover:bg-sunken disabled:cursor-default disabled:opacity-40" disabled={from <= today} onClick={() => onFromChange(addDays(from, -28) < today ? today : addDays(from, -28))}>
          ← Earlier
        </button>
        {tz && <span className="text-xs text-faint">Times in {zoneName(tz)} ({tz.replace(/_/g, ' ')})</span>}
        <button type="button" className="cursor-pointer rounded-md px-2 py-1 text-sm text-muted hover:bg-sunken" onClick={() => onFromChange(addDays(from, 28))}>
          Later →
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1.5 mobile:grid-cols-4" role="listbox" aria-label="Day">
        {visible.map((d) => {
          const open = d.status === 'open';
          const sel = d.date === selectedDay;
          const [w, ...rest] = fmtDate(d.date).split(' ');
          return (
            <button
              key={d.date}
              type="button"
              role="option"
              aria-selected={sel}
              disabled={!open}
              onClick={() => {
                setDay(d.date);
                if (mode === 'date') onChange({ date: d.date });
              }}
              className={`flex cursor-pointer flex-col items-center rounded-btn border px-1 py-2 text-xs transition disabled:cursor-not-allowed ${
                sel ? 'border-brand bg-brand text-brand-ink' : open ? 'border-line bg-surface hover:border-brand' : 'border-transparent bg-sunken/60 text-faint line-through'
              }`}
            >
              <span className="font-semibold">{w.replace(',', '')}</span>
              <span>{rest.join(' ')}</span>
              {mode === 'date' && open && d.spotsLeft !== null && <span className={sel ? '' : 'text-faint'}>{d.spotsLeft} left</span>}
            </button>
          );
        })}
      </div>
      {!firstOpen && !loading && <p className="rounded-btn bg-sunken px-4 py-3 text-sm text-muted">No open times in these weeks. Try later dates.</p>}
      {mode === 'slots' && current && (
        <div>
          <p className="mb-2 text-sm font-medium">{fmtDate(current.date)}</p>
          <div className="grid grid-cols-4 gap-2 mobile:grid-cols-3" role="listbox" aria-label="Time">
            {current.slots.map((s) => {
              const sel = value?.startsAt === s.startsAt;
              return (
                <button
                  key={s.startsAt}
                  type="button"
                  role="option"
                  aria-selected={sel}
                  onClick={() => onChange({ startsAt: s.startsAt, date: current.date })}
                  className={`cursor-pointer rounded-btn border px-2 py-2 text-sm font-medium transition ${sel ? 'border-brand bg-brand text-brand-ink' : 'border-line bg-surface hover:border-brand'}`}
                >
                  {fmtTime(s.startsAt, tz)}
                </button>
              );
            })}
          </div>
        </div>
      )}
      {mode === 'date' && current && value?.date === current.date && (
        <p className="text-sm text-muted">
          {fmtDate(current.date)} · first come, first served{current.spotsLeft !== null ? ` · ${current.spotsLeft} spot${current.spotsLeft === 1 ? '' : 's'} left` : ''}
        </p>
      )}
    </div>
  );
}
