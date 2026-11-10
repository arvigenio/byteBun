import { useEffect, useMemo } from 'react';
import { useDispatch } from 'react-redux';
import { site } from '../content/site.js';
import { Icon } from './ui/Icon.jsx';
import { SlotCalendar } from './SlotCalendar.jsx';
import { fetchSlots } from '../store/leadFormSlice.js';
import { describeHours, formatWhen, timeZoneOptions } from '../lib/calendar.js';

const s = site.getStarted.schedule;
const REFRESH_MS = 30_000; // re-check booked times while the calendar is open
const fill = (text, values) => text.replace(/\{(\w+)\}/g, (_, k) => values[k] ?? '');

// The "Schedule" step (lead page, reschedule page): time zone, then the month calendar and the
// open times on the chosen day (SlotCalendar.jsx). Times come from the API, shown in the visitor's
// time zone; booked ones are disabled and re-checked every REFRESH_MS. The chosen slot is the
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

  const hasOpenTime = slots.items.some((iso) => !taken.has(iso));

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
      ) : !hasOpenTime ? (
        <CalendarSkeleton />
      ) : (
        <SlotCalendar items={slots.items} taken={slots.taken} timeZone={timeZone} selected={selected} radio={c.register('meetingAt')} error={error} errorId={errorId} />
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
