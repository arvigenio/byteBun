import { useMemo, useState } from 'react';
import { site } from '../content/site.js';
import { Icon } from './ui/Icon.jsx';
import { addMonths, dayNumber, formatDay, formatMonth, formatTime, groupByDate, monthGrid, monthOf, periodOf, weekdayNames } from '../lib/calendar.js';

// The call-time picker everywhere a call is booked: a month calendar (days with an open time can
// be clicked), then that day's times grouped by part of day. Used by the lead page and the
// reschedule page (BookingCalendar.jsx), the chat (ChatBooking.jsx) and the admin's "New booking"
// (admin/NewBookingDialog.jsx).
//
//   items     every call time (ISO), from the slots API
//   taken     the ones already booked (shown struck through, can't be picked)
//   timeZone  the zone the days and times are shown in
//   selected  the chosen time (ISO), or ''
//   radio     the form field's props for the time radios, e.g. register('meetingAt')
//   error     a message for the field (shown under the times), errorId its element id
//   compact   smaller, for narrow places (the chat)
//   defaultDay  'YYYY-MM-DD' to show first (else the chosen time's day, else the first open day)
const s = site.getStarted.schedule;
const PERIODS = ['night', 'morning', 'afternoon', 'evening'];

export function SlotCalendar({ items, taken: takenList = [], timeZone, selected = '', radio, error, errorId, compact = false, defaultDay = null }) {
  const taken = useMemo(() => new Set(takenList), [takenList]);
  const groups = useMemo(() => groupByDate(items, timeZone), [items, timeZone]);
  const openCount = (key) => (groups.get(key) ?? []).filter((iso) => !taken.has(iso)).length;
  const dates = [...groups.keys()].filter((key) => openCount(key) > 0); // days with an open time
  const selectedKey = selected && groups.size ? [...groups].find(([, list]) => list.includes(selected))?.[0] : undefined;

  // The day being looked at: the one clicked, else the chosen slot's day, else the first open day.
  const [pickedDay, setPickedDay] = useState(defaultDay);
  const activeDay = (pickedDay && dates.includes(pickedDay) && pickedDay) || selectedKey || dates[0];
  const [pickedMonth, setPickedMonth] = useState(null);
  const month = pickedMonth ?? (activeDay ? monthOf(activeDay) : null);
  const firstMonth = dates.length ? monthOf(dates[0]) : null;
  const lastMonth = dates.length ? monthOf(dates[dates.length - 1]) : null;

  if (!month) return null;
  return (
    <div className={compact ? 'grid gap-3' : 'grid gap-5'}>
      <MonthCalendar
        month={month}
        groups={groups}
        openCount={openCount}
        activeDay={activeDay}
        selectedKey={selectedKey}
        canPrev={month > firstMonth}
        canNext={month < lastMonth}
        compact={compact}
        onMonth={(n) => setPickedMonth(addMonths(month, n))}
        onDay={(key) => {
          setPickedDay(key);
          setPickedMonth(null);
        }}
      />
      <fieldset aria-describedby={error && errorId ? errorId : undefined}>
        <legend className={`flex items-center gap-1.5 font-semibold ${compact ? 'mb-2 text-xs' : 'mb-3 text-sm'}`}>
          <Icon name="clock" className={`${compact ? 'size-3.5' : 'size-4'} text-soft-violet`} strokeWidth={2} />
          {s.timesFor.replace('{day}', activeDay ? formatDay(activeDay) : '')}
        </legend>
        {/* `key` replays the entrance animation when the day changes. */}
        <TimeSlots key={`${activeDay}-${timeZone}`} list={groups.get(activeDay) ?? []} taken={taken} timeZone={timeZone} radio={radio} invalid={!!error} compact={compact} />
        {error && (
          <p id={errorId} className={`mt-2 text-danger motion-safe:animate-rise ${compact ? 'text-xs' : 'text-sm'}`}>
            {error}
          </p>
        )}
      </fieldset>
    </div>
  );
}

function MonthCalendar({ month, groups, openCount, activeDay, selectedKey, canPrev, canNext, compact, onMonth, onDay }) {
  const weeks = monthGrid(month);
  const names = weekdayNames();
  return (
    <div className={`rounded-xl border border-line bg-cream-dough ${compact ? 'p-2' : 'p-4 mobile:p-3'}`}>
      <div className={`flex items-center justify-between ${compact ? 'mb-1' : 'mb-3'}`}>
        <MonthButton label={s.prevMonth} icon="chevronLeft" disabled={!canPrev} compact={compact} onClick={() => onMonth(-1)} />
        <p key={month} aria-live="polite" className={`font-bold text-byte-purple motion-safe:animate-rise ${compact ? 'text-sm' : ''}`}>
          {formatMonth(month)}
        </p>
        <MonthButton label={s.nextMonth} icon="chevronRight" disabled={!canNext} compact={compact} onClick={() => onMonth(1)} />
      </div>
      <table className={`w-full table-fixed border-separate text-center ${compact ? 'border-spacing-0.5' : 'border-spacing-1'}`}>
        <thead>
          <tr>
            {names.map((n) => (
              <th key={n} scope="col" className={`pb-1 font-semibold text-muted ${compact ? 'text-[11px]' : 'text-xs'}`}>
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
                  {key && <DayButton dayKey={key} count={openCount(key)} full={groups.has(key) && openCount(key) === 0} active={key === activeDay} chosen={key === selectedKey} compact={compact} onDay={onDay} />}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DayButton({ dayKey, count, full, active, chosen, compact, onDay }) {
  const open = count > 0;
  const label = `${formatDay(dayKey)}${open ? `, ${count} times available` : full ? ', fully booked' : ', unavailable'}`;
  return (
    <button
      type="button"
      disabled={!open}
      aria-pressed={active}
      aria-label={label}
      onClick={() => onDay(dayKey)}
      className={`relative mx-auto grid aspect-square w-full place-items-center rounded-full font-semibold transition-[background-color,color,transform] duration-200 ${compact ? 'max-w-9 text-xs' : 'max-w-11 text-sm'} ${
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
      {chosen && <span aria-hidden="true" className={`absolute rounded-full bg-circuit-teal ${compact ? 'bottom-0.5 size-1' : 'bottom-1 size-1.5'}`} />}
    </button>
  );
}

function MonthButton({ label, icon, disabled, compact, onClick }) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`grid cursor-pointer place-items-center rounded-full text-byte-purple hover:bg-lavender-mist disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent ${compact ? 'size-9' : 'size-11'}`}
    >
      <Icon name={icon} className={compact ? 'size-4' : 'size-5'} strokeWidth={2.2} />
    </button>
  );
}

function TimeSlots({ list, taken, timeZone, radio, invalid, compact }) {
  if (list.length === 0) return <p className={`text-muted ${compact ? 'text-xs' : 'text-sm'}`}>{s.noTimes}</p>;
  const byPeriod = PERIODS.map((p) => [p, list.filter((iso) => periodOf(iso, timeZone) === p)]).filter(([, items]) => items.length);
  let n = 0; // for the staggered entrance
  return (
    <div className={compact ? 'grid gap-2.5' : 'grid gap-4'}>
      {byPeriod.map(([period, items]) => (
        <div key={period}>
          <p className={`font-bold tracking-[0.08em] text-muted uppercase ${compact ? 'mb-1 text-[10px]' : 'mb-2 text-xs'}`}>{s.periods[period]}</p>
          <div className={`grid gap-2 ${compact ? 'grid-cols-3 gap-1.5' : 'grid-cols-4 mobile:grid-cols-3'}`}>
            {items.map((iso) => {
              const booked = taken.has(iso);
              return (
                <label
                  key={iso}
                  className={`relative flex flex-col items-center justify-center rounded-btn border-2 px-2 font-semibold leading-tight transition-[background-color,border-color,color,opacity,transform] motion-safe:animate-rise ${compact ? 'min-h-9 text-[13px]' : 'min-h-11 text-sm'} ${
                    booked
                      ? 'cursor-not-allowed border-dashed border-line bg-transparent text-muted/60'
                      : 'cursor-pointer border-line bg-cream-dough text-byte-purple hover:border-soft-violet has-checked:border-byte-purple has-checked:bg-byte-purple has-checked:text-cream-dough has-focus-visible:outline-3 has-focus-visible:outline-offset-2 has-focus-visible:outline-midnight-plum motion-safe:active:scale-95'
                  }`}
                  style={{ animationDelay: `${Math.min(n++, 12) * 25}ms` }}
                >
                  <input type="radio" value={iso} disabled={booked} {...radio} aria-invalid={invalid ? true : undefined} className="sr-only" />
                  <span className={booked ? 'line-through' : ''}>{formatTime(iso, timeZone)}</span>
                  {booked && <span className={`font-bold tracking-wide uppercase ${compact ? 'text-[9px]' : 'text-[11px]'}`}>{s.booked}</span>}
                </label>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
