import { useEffect, useMemo, useState } from 'react';
import { fmtLongDate, fmtTime, zoneName } from '../lib/format.js';
import { Icon, ICONS, Loading, Spinner } from '../ui.jsx';

// Pick a day on a month calendar, then a time (time slots mode) — or just a day (date-only mode,
// with spots left). Styled like the website's call picker (/get-started, components/SlotCalendar.jsx)
// in the client tokens, so the business's brand color carries it.
// `days` come from an availability endpoint: [{ date, status: open|full|closed, slots, spotsLeft }];
// it returns 31 days from `from`, so asking from the 1st (or today) covers the month. Times are in
// the business's time zone.

const pad = (n) => String(n).padStart(2, '0');
const monthOf = (date) => date.slice(0, 7); // "2026-12"
const firstOf = (ym) => `${ym}-01`;
const shiftMonth = (ym, n) => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
};
const monthTitle = (ym) => new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(new Date(`${ym}-15T12:00:00Z`));
const weekdayNames = (style) => Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', weekday: style }).format(new Date(Date.UTC(2023, 0, 1 + i, 12)))); // 2023-01-01 was a Sunday

/** The month as weeks (Sunday first): null for the blanks around it. */
function monthWeeks(ym) {
  const [y, m] = ym.split('-').map(Number);
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const cells = [...Array(lead).fill(null), ...Array.from({ length: count }, (_, i) => `${ym}-${pad(i + 1)}`)];
  while (cells.length % 7) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7));
}

const PERIODS = [
  ['night', 'Early morning'],
  ['morning', 'Morning'],
  ['afternoon', 'Afternoon'],
  ['evening', 'Evening'],
];
function periodOf(iso, timeZone) {
  const hour = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone }).format(new Date(iso)));
  return hour < 5 ? 'night' : hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
}

export function SlotPicker({ data, loading, from, onFromChange, today, value, onChange }) {
  const ym = monthOf(from);
  const byDate = useMemo(() => new Map((data?.days ?? []).map((d) => [d.date, d])), [data]);
  const mode = data?.mode ?? 'slots';
  const tz = data?.timeZone;
  const weeks = useMemo(() => monthWeeks(ym), [ym]);
  const monthDays = weeks.flat().filter(Boolean).map((date) => byDate.get(date)).filter(Boolean);
  const firstOpen = monthDays.find((d) => d.status === 'open')?.date;
  const [day, setDay] = useState(null);
  useEffect(() => setDay(null), [from]);
  const selectedDay = byDate.get(day)?.status === 'open' ? day : firstOpen;
  const current = byDate.get(selectedDay);
  const chosenDay = value?.date ?? null;
  const fetched = monthDays.length > 0; // this month's data is in (the query keeps the last month's while loading)
  const paused = data?.status === 'month_full';

  const goMonth = (n) => {
    const next = shiftMonth(ym, n);
    onFromChange(next === monthOf(today) ? today : firstOf(next));
  };

  if (loading && !data) return <Loading label="Finding open times…" />;
  return (
    <div className="grid gap-5">
      <div className="w-full rounded-xl border border-line bg-surface p-3">
        <div className="mb-2 flex items-center justify-between">
          <MonthButton label="Previous month" d="M15 6l-6 6 6 6" disabled={ym <= monthOf(today)} onClick={() => goMonth(-1)} />
          <p key={ym} aria-live="polite" className="flex items-center gap-2 font-bold text-brand motion-safe:animate-rise">
            {monthTitle(ym)}
            {loading && <Spinner className="size-4 text-faint" />}
          </p>
          <MonthButton label="Next month" d="M9 6l6 6-6 6" onClick={() => goMonth(1)} />
        </div>

        <table className="w-full table-fixed border-separate border-spacing-0.5 text-center">
          <thead>
            <tr>
              {weekdayNames('short').map((n, i) => (
                <th key={n} scope="col" abbr={weekdayNames('long')[i]} className="pb-1 text-[11px] font-semibold text-muted">
                  {n}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {weeks.map((week, i) => (
              <tr key={i}>
                {week.map((date, j) => (
                  <td key={date ?? `empty-${i}-${j}`} className="p-0">
                    {date && (
                      <DayButton
                        date={date}
                        day={byDate.get(date)}
                        mode={mode}
                        active={date === selectedDay}
                        chosen={date === chosenDay}
                        isToday={date === today}
                        dim={!fetched}
                        onPick={() => {
                          setDay(date);
                          if (mode === 'date') onChange({ date });
                        }}
                      />
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>

        {tz && <p className="mt-2 text-center text-[11px] text-faint">Times in {zoneName(tz)} ({tz.replace(/_/g, ' ')})</p>}
      </div>

      {paused && <p className="rounded-btn bg-sunken px-4 py-3 text-center text-sm text-muted">Online booking is paused until next month, so dates and times can’t be picked.</p>}

      {fetched && !firstOpen && !loading && !paused && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-btn bg-sunken px-4 py-3 text-sm text-muted">
          <span>No open times left in {monthTitle(ym)}.</span>
          <button type="button" onClick={() => goMonth(1)} className="cursor-pointer font-medium text-brand underline">
            See {monthTitle(shiftMonth(ym, 1))}
          </button>
        </div>
      )}

      {mode === 'slots' && current && (
        /* `key` replays the entrance animation when the day changes. */
        <TimesCard key={`${current.date}-${tz}`} day={current} tz={tz} value={value} onPick={(s) => onChange({ startsAt: s.startsAt, date: current.date })} />
      )}
      {mode === 'date' && current && value?.date === current.date && (
        <p className="text-sm text-muted">
          {fmtLongDate(current.date)} · first come, first served{current.spotsLeft !== null ? ` · ${current.spotsLeft} spot${current.spotsLeft === 1 ? '' : 's'} left` : ''}
        </p>
      )}
    </div>
  );
}

function DayButton({ date, day, mode, active, chosen, isToday, dim, onPick }) {
  const open = day?.status === 'open';
  const full = day?.status === 'full';
  const left = mode === 'date' && open && day.spotsLeft !== null ? `, ${day.spotsLeft} spots left` : '';
  const label = `${fmtLongDate(date)}${open ? `${left}` : full ? ', fully booked' : ', unavailable'}${isToday ? ' (today)' : ''}`;
  return (
    <button
      type="button"
      disabled={!open}
      aria-pressed={active}
      aria-label={label}
      onClick={onPick}
      className={`relative mx-auto grid aspect-square w-full max-w-10 place-items-center rounded-full text-sm font-semibold tabular-nums transition-[background-color,color,transform] duration-200 ${
        active
          ? 'bg-brand text-brand-ink motion-safe:scale-105'
          : open
            ? 'cursor-pointer bg-brand-soft text-brand hover:bg-line motion-safe:hover:scale-105'
            : full
              ? 'cursor-not-allowed text-faint/60 line-through'
              : `cursor-default text-faint/50 ${dim ? 'opacity-50' : ''}`
      } ${isToday && !active ? 'ring-1 ring-brand/50' : ''}`}
    >
      {Number(date.slice(8))}
      {chosen && <span aria-hidden="true" className={`absolute bottom-0.5 size-1 rounded-full ${active ? 'bg-brand-ink' : 'bg-ok'}`} />}
    </button>
  );
}

function MonthButton({ label, d, disabled = false, onClick }) {
  return (
    <button type="button" aria-label={label} disabled={disabled} onClick={onClick} className="grid size-9 cursor-pointer place-items-center rounded-full text-brand hover:bg-brand-soft disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent">
      <Icon d={d} className="size-4" />
    </button>
  );
}

const PERIOD_ICON = {
  night: 'M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z',
  morning: 'M12 3v2M5.6 5.6l1.4 1.4M3 13h2M19 13h2M17 7l1.4-1.4M7 13a5 5 0 0110 0M3 17h18M8 21h8',
  afternoon: 'M12 3v2M12 19v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M3 12h2M19 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4M12 16a4 4 0 100-8 4 4 0 000 8z',
  evening: 'M3 17h18M7 13a5 5 0 0110 0M12 3v4M9 6l3 3 3-3M8 21h8',
};
const dayParts = (date) => {
  const d = new Date(`${date}T12:00:00Z`);
  const f = (o) => new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', ...o }).format(d);
  return { weekday: f({ weekday: 'long' }), month: f({ month: 'short' }), day: d.getUTCDate(), long: f({ month: 'long', day: 'numeric', year: 'numeric' }) };
};

/** The chosen day's times, in their own card: the date as a tear-off calendar page, then pills by part of day. */
function TimesCard({ day, tz, value, onPick }) {
  const slots = day.slots;
  const parts = dayParts(day.date);
  const byPeriod = PERIODS.map(([p, label]) => [p, label, slots.filter((s) => periodOf(s.startsAt, tz) === p)]).filter(([, , list]) => list.length);
  const chosen = slots.find((s) => s.startsAt === value?.startsAt);
  let n = 0; // for the staggered entrance
  return (
    <section className="overflow-hidden rounded-2xl bg-brand-soft shadow-[0_1px_2px_rgba(16,24,40,0.06)] motion-safe:animate-rise" aria-label={`Times on ${fmtLongDate(day.date)}`}>
      <header className="flex items-center gap-3.5 px-4 pt-4 pb-3">
        <div className="w-14 shrink-0 overflow-hidden rounded-xl bg-surface text-center shadow-sm" aria-hidden="true">
          <div className="bg-brand py-0.5 text-[10px] font-bold tracking-[0.12em] text-brand-ink uppercase">{parts.month}</div>
          <div className="py-1 text-2xl leading-none font-bold text-ink tabular-nums">{parts.day}</div>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold tracking-wide text-brand uppercase">{parts.weekday}</p>
          <p className="truncate font-bold text-ink">{parts.long}</p>
        </div>
        <span className="shrink-0 rounded-full bg-surface px-2.5 py-1 text-xs font-semibold text-brand">
          {slots.length} {slots.length === 1 ? 'time' : 'times'}
        </span>
      </header>

      <div className="mx-1.5 mb-1.5 grid gap-4 rounded-xl bg-surface p-4 mobile:p-3" role="listbox" aria-label="Time">
        {!slots.length && <p className="text-sm text-muted">No times left on this day. Please pick another date.</p>}
        {byPeriod.map(([p, label, list]) => (
          <div key={p}>
            <p className="mb-2 flex items-center gap-1.5 text-xs font-bold tracking-[0.08em] text-muted uppercase">
              <Icon d={PERIOD_ICON[p]} className="size-4 text-brand" />
              {label}
              <span className="font-semibold tracking-normal text-faint normal-case">· {list.length}</span>
            </p>
            <div className="flex flex-wrap gap-2">
              {list.map((s) => {
                const sel = value?.startsAt === s.startsAt;
                return (
                  <button
                    key={s.startsAt}
                    type="button"
                    role="option"
                    aria-selected={sel}
                    onClick={() => onPick(s)}
                    style={{ animationDelay: `${Math.min(n++, 12) * 25}ms` }}
                    className={`inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-full px-4 text-sm font-semibold tabular-nums transition-[background-color,color,box-shadow,transform] motion-safe:animate-rise motion-safe:active:scale-95 ${
                      sel ? 'bg-brand text-brand-ink shadow-md' : 'bg-sunken text-ink hover:bg-brand-soft hover:text-brand hover:shadow-[inset_0_0_0_1.5px_var(--color-brand)]'
                    }`}
                  >
                    {sel && <Icon d={ICONS.check} className="size-4" />}
                    {fmtTime(s.startsAt, tz)}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {chosen && (
        <p className="px-4 pt-1 pb-3 text-center text-[13px] font-medium text-brand" aria-live="polite">
          {parts.weekday}, {fmtTime(chosen.startsAt, tz)} selected
        </p>
      )}
    </section>
  );
}
