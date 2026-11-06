import { useEffect, useMemo, useState } from 'react';
import { useDispatch } from 'react-redux';
import { site } from '../content/site.js';
import { Icon } from './ui/Icon.jsx';
import { fetchSlots } from '../store/leadFormSlice.js';
import {
  addMonths,
  dayNumber,
  describeHours,
  formatDay,
  formatMonth,
  formatTime,
  formatWhen,
  groupByDate,
  monthGrid,
  monthOf,
  periodOf,
  timeZoneOptions,
  weekdayNames,
} from '../lib/calendar.js';

const s = site.getStarted.schedule;
const PERIODS = ['night', 'morning', 'afternoon', 'evening'];
const REFRESH_MS = 30_000; // re-check booked times while the calendar is open
const fill = (text, values) => text.replace(/\{(\w+)\}/g, (_, k) => values[k] ?? '');

// The "Schedule" step: time zone, month calendar, then the open times on the chosen day.
// Times come from the API, shown in the visitor's time zone; booked ones are disabled and
// re-checked every REFRESH_MS. The chosen slot is the
// `meetingAt` form field (radio inputs), the time zone is the `timeZone` field (a select).
export function BookingCalendar({ c }) {
  const dispatch = useDispatch();
  const { slots } = c;
  const timeZone = c.values.timeZone;
  const selected = c.values.meetingAt;

  // Refresh when the step opens and every so often, so times booked meanwhile get disabled.
  useEffect(() => {
    dispatch(fetchSlots());
    const timer = setInterval(() => dispatch(fetchSlots()), REFRESH_MS);
    return () => clearInterval(timer);
  }, [dispatch]);

  const taken = useMemo(() => new Set(slots.taken), [slots.taken]);
  // If the chosen time was just booked by someone else, un-choose it.
  const { setValue } = c;
  useEffect(() => {
    if (selected && taken.has(selected)) setValue('meetingAt', '');
  }, [selected, taken, setValue]);

  const groups = useMemo(() => groupByDate(slots.items, timeZone), [slots.items, timeZone]);
  const openCount = (key) => (groups.get(key) ?? []).filter((iso) => !taken.has(iso)).length;
  const dates = [...groups.keys()].filter((key) => openCount(key) > 0); // days with an open time
  const selectedKey = selected && groups.size ? [...groups].find(([, list]) => list.includes(selected))?.[0] : undefined;

  // The day being looked at: the one clicked, else the chosen slot's day, else the first open day.
  const [pickedDay, setPickedDay] = useState(null);
  const activeDay = (pickedDay && dates.includes(pickedDay) && pickedDay) || selectedKey || dates[0];
  const [pickedMonth, setPickedMonth] = useState(null);
  const month = pickedMonth ?? (activeDay ? monthOf(activeDay) : null);
  const firstMonth = dates.length ? monthOf(dates[0]) : null;
  const lastMonth = dates.length ? monthOf(dates[dates.length - 1]) : null;

  const zones = useMemo(() => timeZoneOptions(timeZone), [timeZone]);
  const hours = slots.availability ? describeHours(slots.availability, timeZone) : null;
  const error = c.errorFor('meetingAt');
  const errorId = `${c.id('meetingAt')}-error`;

  return (
    <div className="grid gap-5">
      <div>
        <label htmlFor={c.id('timeZone')} className="mb-1 flex items-center gap-1.5 text-sm font-semibold">
          <Icon name="globe" className="size-4 text-soft-violet" strokeWidth={2} />
          {s.timeZoneLabel}
        </label>
        <select {...c.field('timeZone')} className={selectClass}>
          {zones.map((z) => (
            <option key={z.value} value={z.value}>
              {z.label}
            </option>
          ))}
        </select>
        {hours && <p className="mt-2 text-[13px] text-muted mobile:text-sm">{fill(s.hours, hours)}</p>}
      </div>

      {slots.status === 'error' && slots.items.length === 0 ? (
        <div role="alert" className="rounded-xl border border-danger/40 bg-gold-tint p-4 text-sm text-danger">
          {s.loadError}{' '}
          <button type="button" onClick={() => dispatch(fetchSlots())} className="cursor-pointer font-semibold underline underline-offset-2">
            {s.retry}
          </button>
        </div>
      ) : !month ? (
        <CalendarSkeleton />
      ) : (
        <>
          <MonthCalendar
            month={month}
            groups={groups}
            openCount={openCount}
            activeDay={activeDay}
            selectedKey={selectedKey}
            canPrev={month > firstMonth}
            canNext={month < lastMonth}
            onMonth={(n) => setPickedMonth(addMonths(month, n))}
            onDay={(key) => {
              setPickedDay(key);
              setPickedMonth(null);
            }}
          />
          <fieldset aria-describedby={error ? errorId : undefined}>
            <legend className="mb-3 flex items-center gap-1.5 text-sm font-semibold">
              <Icon name="clock" className="size-4 text-soft-violet" strokeWidth={2} />
              {fill(s.timesFor, { day: activeDay ? formatDay(activeDay) : '' })}
            </legend>
            {/* `key` replays the entrance animation when the day changes. */}
            <TimeSlots key={`${activeDay}-${timeZone}`} c={c} list={groups.get(activeDay) ?? []} taken={taken} timeZone={timeZone} />
            {error && (
              <p id={errorId} className="mt-2 text-sm text-danger motion-safe:animate-rise">
                {error}
              </p>
            )}
          </fieldset>
        </>
      )}

      {selected && (
        <p
          key={selected}
          className="flex items-center gap-2.5 rounded-xl bg-byte-purple px-4 py-3 text-[15px] font-semibold text-cream-dough motion-safe:animate-pop"
        >
          <Icon name="calendar" className="size-5 flex-none text-circuit-teal" strokeWidth={2} />
          {fill(s.selected, { when: formatWhen(selected, timeZone) })}
        </p>
      )}
    </div>
  );
}

function MonthCalendar({ month, groups, openCount, activeDay, selectedKey, canPrev, canNext, onMonth, onDay }) {
  const weeks = monthGrid(month);
  const names = weekdayNames();
  return (
    <div className="rounded-xl border border-line bg-cream-dough p-4 mobile:p-3">
      <div className="mb-3 flex items-center justify-between">
        <MonthButton label={s.prevMonth} icon="chevronLeft" disabled={!canPrev} onClick={() => onMonth(-1)} />
        <p key={month} aria-live="polite" className="font-bold text-byte-purple motion-safe:animate-rise">
          {formatMonth(month)}
        </p>
        <MonthButton label={s.nextMonth} icon="chevronRight" disabled={!canNext} onClick={() => onMonth(1)} />
      </div>
      <table className="w-full table-fixed border-separate border-spacing-1 text-center">
        <thead>
          <tr>
            {names.map((n) => (
              <th key={n} scope="col" className="pb-1 text-xs font-semibold text-muted">
                {n}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week, i) => (
            <tr key={i}>
              {week.map((key, j) => (
                <td key={key ?? `empty-${j}`} className="p-0">
                  {key && <DayButton dayKey={key} count={openCount(key)} full={groups.has(key) && openCount(key) === 0} active={key === activeDay} chosen={key === selectedKey} onDay={onDay} />}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DayButton({ dayKey, count, full, active, chosen, onDay }) {
  const open = count > 0;
  const label = `${formatDay(dayKey)}${open ? `, ${count} times available` : full ? ', fully booked' : ', unavailable'}`;
  return (
    <button
      type="button"
      disabled={!open}
      aria-pressed={active}
      aria-label={label}
      onClick={() => onDay(dayKey)}
      className={`relative mx-auto grid aspect-square w-full max-w-11 place-items-center rounded-full text-sm font-semibold transition-[background-color,color,transform] duration-200 ${
        active
          ? 'bg-byte-purple text-cream-dough motion-safe:scale-105'
          : open
            ? 'cursor-pointer bg-lavender-mist text-byte-purple hover:bg-line motion-safe:hover:scale-105'
            : full
              ? 'cursor-not-allowed text-muted/50 line-through'
              : 'cursor-default text-muted/40'
      }`}
    >
      {dayNumber(dayKey)}
      {chosen && <span aria-hidden="true" className="absolute bottom-1 size-1.5 rounded-full bg-circuit-teal" />}
    </button>
  );
}

function MonthButton({ label, icon, disabled, onClick }) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="grid size-11 cursor-pointer place-items-center rounded-full text-byte-purple hover:bg-lavender-mist disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent"
    >
      <Icon name={icon} className="size-5" strokeWidth={2.2} />
    </button>
  );
}

function TimeSlots({ c, list, taken, timeZone }) {
  if (list.length === 0) return <p className="text-sm text-muted">{s.noTimes}</p>;
  const byPeriod = PERIODS.map((p) => [p, list.filter((iso) => periodOf(iso, timeZone) === p)]).filter(([, items]) => items.length);
  let n = 0; // for the staggered entrance
  return (
    <div className="grid gap-4">
      {byPeriod.map(([period, items]) => (
        <div key={period}>
          <p className="mb-2 text-xs font-bold tracking-[0.08em] text-muted uppercase">{s.periods[period]}</p>
          <div className="grid grid-cols-4 gap-2 mobile:grid-cols-3">
            {items.map((iso) => {
              const booked = taken.has(iso);
              return (
                <label
                  key={iso}
                  className={`relative flex min-h-11 flex-col items-center justify-center rounded-btn border-2 px-2 text-sm font-semibold leading-tight transition-[background-color,border-color,color,opacity,transform] motion-safe:animate-rise ${
                    booked
                      ? 'cursor-not-allowed border-dashed border-line bg-transparent text-muted/60'
                      : 'cursor-pointer border-line bg-cream-dough text-byte-purple hover:border-soft-violet has-checked:border-byte-purple has-checked:bg-byte-purple has-checked:text-cream-dough has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-midnight-plum motion-safe:active:scale-95'
                  }`}
                  style={{ animationDelay: `${Math.min(n++, 12) * 25}ms` }}
                >
                  <input
                    type="radio"
                    value={iso}
                    disabled={booked}
                    {...c.register('meetingAt')}
                    aria-invalid={c.errorFor('meetingAt') ? true : undefined}
                    className="sr-only"
                  />
                  <span className={booked ? 'line-through' : ''}>{formatTime(iso, timeZone)}</span>
                  {booked && <span className="text-[11px] font-bold tracking-wide uppercase">{s.booked}</span>}
                </label>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function CalendarSkeleton() {
  return (
    <div aria-hidden="true" className="grid gap-4 motion-safe:animate-pulse">
      <div className="h-[300px] rounded-xl bg-cream-dough" />
      <div className="grid grid-cols-4 gap-2">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="h-11 rounded-btn bg-cream-dough" />
        ))}
      </div>
    </div>
  );
}

const selectClass =
  'block min-h-11 w-full cursor-pointer rounded-btn border border-line bg-cream-dough px-3 py-2 text-base text-midnight-plum focus:border-soft-violet focus:ring-4 focus:ring-soft-violet/20 focus-visible:outline-soft-violet';
