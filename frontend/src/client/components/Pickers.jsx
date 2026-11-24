import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { fmtDate, fmtLongDate, minuteLabel } from '../lib/format.js';
import { Icon, ICONS } from '../ui.jsx';

// The client apps' date and time pickers, styled like the booking calendar (SlotPicker.jsx), for
// every settings page (Bookings and the apps to come). Values stay plain: dates are 'YYYY-MM-DD',
// times are minutes after midnight (like the API).
//
//   <DatePicker value onChange min max />                       one date
//   <DateRangePicker start end onChange={({ start, end }) …} min />   one date or a range ('' end = one day)
//   <TimePicker value onChange step={5} />                      a time of day
//
// Each takes the props a <Field> hands its child ({ id, aria-* }) and `disabled`.

const cx = (...c) => c.filter(Boolean).join(' ');
const pad = (n) => String(n).padStart(2, '0');
const monthOf = (date) => date.slice(0, 7);
const shiftMonth = (ym, n) => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
};
const monthTitle = (ym) => new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(new Date(`${ym}-15T12:00:00Z`));
const WEEKDAY_SHORT = Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', weekday: 'narrow' }).format(new Date(Date.UTC(2023, 0, 1 + i, 12))));
const withYear = (date) => new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(`${date}T12:00:00Z`));
const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

function monthWeeks(ym) {
  const [y, m] = ym.split('-').map(Number);
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const cells = [...Array(lead).fill(null), ...Array.from({ length: count }, (_, i) => `${ym}-${pad(i + 1)}`)];
  while (cells.length % 7) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7));
}

/** Open/close, closing on a click outside or Escape (focus goes back to the trigger). */
function usePopover() {
  const [open, setOpen] = useState(false);
  const root = useRef(null);
  const trigger = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const outside = (e) => !root.current?.contains(e.target) && setOpen(false);
    const key = (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation(); // don't close a surrounding dialog
      e.preventDefault();
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener('mousedown', outside);
    root.current?.addEventListener('keydown', key);
    const node = root.current;
    return () => {
      document.removeEventListener('mousedown', outside);
      node?.removeEventListener('keydown', key);
    };
  }, [open]);
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };
  return { open, setOpen, close, root, trigger };
}

const TRIGGER =
  'flex min-h-10 w-full cursor-pointer items-center gap-2 rounded-btn border border-line-strong bg-surface px-3 py-2 text-left text-[15px] text-ink transition hover:border-brand focus-visible:border-brand focus-visible:outline-2 focus-visible:outline-brand/25 aria-[invalid=true]:border-danger disabled:cursor-not-allowed disabled:bg-sunken disabled:hover:border-line-strong';
const PANEL = 'absolute left-0 z-30 mt-1.5 rounded-xl border border-line bg-surface p-3 shadow-lg motion-safe:animate-[fade-swap_0.18s_ease_both]';

// ---- Dates ----

function Calendar({ month, onMonth, min, max, isSelected, inRange, isEdge, onPick, onHover }) {
  const today = localToday();
  return (
    <div className="w-[17.5rem] max-w-[calc(100vw-56px)]">
      <div className="mb-1 flex items-center justify-between">
        <button type="button" onClick={() => onMonth(-1)} disabled={!!min && month <= monthOf(min)} className="grid size-8 cursor-pointer place-items-center rounded-full text-brand hover:bg-brand-soft disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent" aria-label="Previous month">
          <Icon d="M15 6l-6 6 6 6" className="size-4" />
        </button>
        <p key={month} className="text-sm font-bold text-brand motion-safe:animate-rise" aria-live="polite">
          {monthTitle(month)}
        </p>
        <button type="button" onClick={() => onMonth(1)} disabled={!!max && month >= monthOf(max)} className="grid size-8 cursor-pointer place-items-center rounded-full text-brand hover:bg-brand-soft disabled:cursor-default disabled:opacity-30 disabled:hover:bg-transparent" aria-label="Next month">
          <Icon d="M9 6l6 6-6 6" className="size-4" />
        </button>
      </div>
      <table className="w-full table-fixed border-collapse text-center" role="grid">
        <thead>
          <tr>
            {WEEKDAY_SHORT.map((n, i) => (
              <th key={i} scope="col" className="pb-1 text-[11px] font-semibold text-muted">
                {n}
              </th>
            ))}
          </tr>
        </thead>
        <tbody onMouseLeave={() => onHover?.(null)}>
          {monthWeeks(month).map((week, i) => (
            <tr key={i}>
              {week.map((date, j) => {
                if (!date) return <td key={`e${i}${j}`} />;
                const off = (min && date < min) || (max && date > max);
                const sel = isSelected(date);
                const band = inRange?.(date);
                const edge = isEdge?.(date);
                return (
                  <td key={date} className={cx('p-0 py-0.5', band && 'bg-brand-soft', edge === 'start' && 'rounded-l-full', edge === 'end' && 'rounded-r-full')}>
                    <button
                      type="button"
                      disabled={off}
                      aria-pressed={sel}
                      aria-label={fmtLongDate(date)}
                      onClick={() => onPick(date)}
                      onMouseEnter={() => onHover?.(date)}
                      onFocus={() => onHover?.(date)}
                      className={cx(
                        'mx-auto grid size-9 place-items-center rounded-full text-sm font-semibold tabular-nums transition-[background-color,color,transform] duration-150',
                        sel ? 'bg-brand text-brand-ink motion-safe:scale-105' : off ? 'cursor-not-allowed text-faint/50' : 'cursor-pointer text-ink hover:bg-brand-soft hover:text-brand',
                        date === today && !sel && 'ring-1 ring-brand/50',
                      )}
                    >
                      {Number(date.slice(8))}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One date. */
export function DatePicker({ value, onChange, min, max, disabled, placeholder = 'Choose a date', className, ...field }) {
  const p = usePopover();
  const [month, setMonth] = useState(monthOf(value || min || localToday()));
  useEffect(() => {
    if (p.open) setMonth(monthOf(value || min || localToday()));
  }, [p.open]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className={cx('relative', className)} ref={p.root}>
      <button type="button" ref={p.trigger} {...field} disabled={disabled} aria-haspopup="dialog" aria-expanded={p.open} onClick={() => p.setOpen((o) => !o)} className={TRIGGER}>
        <Icon d={ICONS.calendar} className="size-4 text-brand" />
        <span className={cx('flex-1 truncate', !value && 'text-faint')}>{value ? withYear(value) : placeholder}</span>
      </button>
      {p.open && (
        <div className={PANEL} role="dialog" aria-label="Choose a date">
          <Calendar
            month={month}
            onMonth={(n) => setMonth(shiftMonth(month, n))}
            min={min}
            max={max}
            isSelected={(d) => d === value}
            onPick={(d) => {
              onChange(d);
              p.close();
            }}
          />
        </div>
      )}
    </div>
  );
}

/** One date or a range: the first click sets the start, the second the end. */
export function DateRangePicker({ start, end, onChange, min, max, disabled, placeholder = 'Choose dates', className, ...field }) {
  const p = usePopover();
  const [month, setMonth] = useState(monthOf(start || min || localToday()));
  const [picking, setPicking] = useState(false); // waiting for the end date
  const [hover, setHover] = useState(null);
  useEffect(() => {
    if (p.open) {
      setMonth(monthOf(start || min || localToday()));
      setPicking(false);
    }
  }, [p.open]); // eslint-disable-line react-hooks/exhaustive-deps
  const shownEnd = picking && hover && start && hover > start ? hover : end && end > start ? end : '';
  const days = start && shownEnd ? Math.round((Date.parse(shownEnd) - Date.parse(start)) / 86_400_000) + 1 : start ? 1 : 0;
  const label = !start ? placeholder : end && end > start ? `${monthOf(start) === monthOf(end) ? fmtDate(start) : withYear(start)} – ${withYear(end)}` : withYear(start);

  const pick = (d) => {
    if (!picking || !start || d < start) {
      onChange({ start: d, end: '' });
      setPicking(true);
      return;
    }
    onChange({ start, end: d === start ? '' : d });
    setPicking(false);
    p.close();
  };

  return (
    <div className={cx('relative', className)} ref={p.root}>
      <button type="button" ref={p.trigger} {...field} disabled={disabled} aria-haspopup="dialog" aria-expanded={p.open} onClick={() => p.setOpen((o) => !o)} className={TRIGGER}>
        <Icon d={ICONS.calendar} className="size-4 text-brand" />
        <span className={cx('flex-1 truncate', !start && 'text-faint')}>{label}</span>
        {start && end && end > start && <span className="shrink-0 rounded-full bg-brand-soft px-2 py-0.5 text-xs font-semibold text-brand">{days} days</span>}
      </button>
      {p.open && (
        <div className={PANEL} role="dialog" aria-label="Choose dates">
          <Calendar
            month={month}
            onMonth={(n) => setMonth(shiftMonth(month, n))}
            min={min}
            max={max}
            isSelected={(d) => d === start || d === shownEnd}
            inRange={(d) => !!shownEnd && d >= start && d <= shownEnd}
            isEdge={(d) => (shownEnd && d === start ? 'start' : shownEnd && d === shownEnd ? 'end' : null)}
            onPick={pick}
            onHover={picking ? setHover : undefined}
          />
          <div className="mt-2 flex items-center justify-between gap-2 border-t border-line pt-2">
            <p className="text-xs text-muted" aria-live="polite">
              {picking ? 'Now pick the last day, or Done for one day.' : days > 1 ? `${days} days` : start ? 'One day. Pick again to change.' : 'Pick the first day.'}
            </p>
            <button type="button" onClick={() => (setPicking(false), p.close())} className="cursor-pointer rounded-btn bg-brand px-3 py-1 text-xs font-semibold text-brand-ink hover:brightness-110">
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Times ----

/** A column of choices that scrolls the chosen one into view when it opens. */
function Column({ label, items, value, onPick }) {
  const list = useRef(null);
  useLayoutEffect(() => {
    const el = list.current?.querySelector('[aria-selected="true"]');
    if (el && list.current) list.current.scrollTop = el.offsetTop - list.current.clientHeight / 2 + el.clientHeight / 2;
  }, []);
  return (
    <div className="flex flex-col">
      <p className="mb-1 text-center text-[10px] font-bold tracking-[0.08em] text-muted uppercase">{label}</p>
      <div ref={list} role="listbox" aria-label={label} className="flex max-h-48 flex-col gap-0.5 overflow-y-auto overscroll-contain px-0.5 [scrollbar-width:thin]">
        {items.map(([v, text]) => (
          <button
            key={v}
            type="button"
            role="option"
            aria-selected={v === value}
            onClick={() => onPick(v)}
            className={cx('min-w-12 cursor-pointer rounded-btn px-2.5 py-1.5 text-sm font-semibold tabular-nums transition', v === value ? 'bg-brand text-brand-ink' : 'text-ink hover:bg-brand-soft hover:text-brand')}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

const HOURS = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((h) => [h, String(h)]);

/** A time of day (minutes after midnight): hour, minute and AM/PM columns. */
export function TimePicker({ value, onChange, step = 5, disabled, className, ...field }) {
  const p = usePopover();
  const id = useId();
  const v = Number.isFinite(value) ? Math.min(Math.max(value, 0), 1439) : 540;
  const h24 = Math.floor(v / 60);
  const minute = v % 60;
  const pm = h24 >= 12;
  const h12 = h24 % 12 || 12;
  const minutes = useMemo(() => {
    const list = Array.from({ length: Math.ceil(60 / step) }, (_, i) => i * step);
    if (!list.includes(minute)) list.push(minute); // keep an off-grid saved value pickable
    return list.sort((a, b) => a - b).map((m) => [m, pad(m)]);
  }, [step, minute]);
  const set = (hour12, min, isPm) => onChange(((hour12 % 12) + (isPm ? 12 : 0)) * 60 + min);

  return (
    <div className={cx('relative', className)} ref={p.root}>
      <button type="button" ref={p.trigger} {...field} disabled={disabled} aria-haspopup="dialog" aria-expanded={p.open} onClick={() => p.setOpen((o) => !o)} className={cx(TRIGGER, 'tabular-nums')}>
        <Icon d={ICONS.clock} className="size-4 text-brand" />
        <span className="flex-1 whitespace-nowrap">{minuteLabel(v)}</span>
      </button>
      {p.open && (
        <div className={PANEL} role="dialog" aria-labelledby={`${id}-t`}>
          <p id={`${id}-t`} className="mb-2 text-center text-lg font-bold text-brand tabular-nums">
            {minuteLabel(v)}
          </p>
          <div className="flex gap-1.5">
            <Column label="Hour" items={HOURS} value={h12} onPick={(h) => set(h, minute, pm)} />
            <Column label="Min" items={minutes} value={minute} onPick={(m) => set(h12, m, pm)} />
            <div className="flex flex-col">
              <p className="mb-1 text-center text-[10px] font-bold tracking-[0.08em] text-muted uppercase">&nbsp;</p>
              <div className="flex flex-col gap-0.5" role="radiogroup" aria-label="AM or PM">
                {[
                  [false, 'AM'],
                  [true, 'PM'],
                ].map(([isPm, text]) => (
                  <button
                    key={text}
                    type="button"
                    role="radio"
                    aria-checked={pm === isPm}
                    onClick={() => set(h12, minute, isPm)}
                    className={cx('cursor-pointer rounded-btn px-2.5 py-1.5 text-sm font-semibold transition', pm === isPm ? 'bg-brand text-brand-ink' : 'text-ink hover:bg-brand-soft hover:text-brand')}
                  >
                    {text}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="mt-2 flex justify-end border-t border-line pt-2">
            <button type="button" onClick={p.close} className="cursor-pointer rounded-btn bg-brand px-3 py-1 text-xs font-semibold text-brand-ink hover:brightness-110">
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
