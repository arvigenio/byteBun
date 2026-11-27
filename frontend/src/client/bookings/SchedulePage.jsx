import { yupResolver } from '@hookform/resolvers/yup';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { CurrencyOptions } from '../components/Money.jsx';
import { useBlockedQuery, useBlockMutation, useMeQuery, useSaveHoursMutation, useSaveSettingsMutation, useServicesQuery, useSettingsQuery, useUnblockMutation } from '../api.js';
import { addDays, fmtDate, fmtLongDate, fmtTime, minuteLabel, timeZones, todayIn, WEEKDAYS } from '../lib/format.js';
import { rulesSchema } from '../lib/schemas.js';
import { Badge, Button, Card, Checkbox, Dialog, Field, IconButton, ICONS, Input, Loading, Notice, PageHeader, Select, useConfirm } from '../ui.jsx';
import { can } from './BookingsApp.jsx';
import { DateRangePicker, TimePicker } from '../components/Pickers.jsx';
import { RemindersCard } from './RemindersCard.jsx';

// The Schedule page: weekly hours, booking rules, time off and reminders, one tab each, with a
// summary of the saved setup on top. Tabs stay mounted, so unsaved edits survive a tab switch.

const ORDER = [1, 2, 3, 4, 5, 6, 0]; // Monday first
const SHORT = (d) => WEEKDAYS[d].slice(0, 3);
const WEEKDAY_SET = [1, 2, 3, 4, 5];
const WEEKEND_SET = [6, 0];

const TABS = [
  { key: 'hours', label: 'Weekly hours' },
  { key: 'rules', label: 'Booking rules' },
  { key: 'off', label: 'Time off' },
  { key: 'reminders', label: 'Reminders' },
];

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const range = (a, b) => `${minuteLabel(a)} – ${minuteLabel(b)}`;
const noticeLabel = (m) => (m === 0 ? 'None' : m < 60 ? `${m} minutes` : m < 1440 ? plural(m / 60, 'hour') : plural(m / 1440, 'day'));

/** Weekly hours from the API rows, keyed by weekday. */
function daysFrom(data) {
  const days = {};
  for (const d of ORDER) {
    const h = data.hours.find((x) => x.weekday === d);
    days[d] = { open: !!h, start: h?.startMinute ?? 540, end: h?.endMinute ?? 1020, breaks: data.breaks.filter((b) => b.weekday === d).map((b) => ({ start: b.startMinute, end: b.endMinute })) };
  }
  return days;
}

const dayError = (day) => {
  if (!day.open) return null;
  if (day.end <= day.start) return 'Closing time must be after opening time.';
  if (day.breaks.some((b) => b.end <= b.start)) return 'A break ends before it starts.';
  if (day.breaks.some((b) => b.start < day.start || b.end > day.end)) return 'Breaks must be inside the opening hours.';
  return null;
};

const sameHours = (a, b) => a.start === b.start && a.end === b.end && JSON.stringify(a.breaks) === JSON.stringify(b.breaks);

/** "Mon–Fri 9:00 AM – 5:00 PM · Sat 10:00 AM – 2:00 PM": consecutive days with the same hours grouped. */
function summarizeHours(days) {
  const groups = [];
  for (const d of ORDER) {
    const day = days[d];
    const last = groups.at(-1);
    if (day.open && last?.open && sameHours(last.day, day)) last.to = d;
    else groups.push({ open: day.open, day, from: d, to: d });
  }
  const open = groups.filter((g) => g.open);
  if (!open.length) return 'Closed every day';
  return open.map((g) => `${g.from === g.to ? SHORT(g.from) : `${SHORT(g.from)}–${SHORT(g.to)}`} ${range(g.day.start, g.day.end)}`).join(' · ');
}

const weeklyMinutes = (days) => ORDER.reduce((sum, d) => (days[d].open ? sum + days[d].end - days[d].start - days[d].breaks.reduce((s, b) => s + Math.max(0, b.end - b.start), 0) : sum), 0);
const hoursLabel = (min) => `${Math.round((min / 60) * 10) / 10} h`;

function useTab() {
  const read = () => (TABS.some((t) => `#${t.key}` === window.location.hash) ? window.location.hash.slice(1) : 'hours');
  const [tab, setTab] = useState(read);
  const go = (key) => {
    setTab(key);
    window.history.replaceState(null, '', `#${key}`);
  };
  return [tab, go];
}

export function SchedulePage() {
  const { data: me } = useMeQuery();
  const q = useSettingsQuery();
  const blocked = useBlockedQuery();
  const [tab, setTab] = useTab();
  if (q.isLoading || !q.data) return <Loading />;
  const edit = can(me, 'bookings.settings');
  const s = q.data.settings;
  const savedDays = daysFrom(q.data);
  const today = todayIn(s.timeZone);
  const upcomingOff = (blocked.data ?? []).filter((b) => b.endDate >= today);

  const summary = [
    { tab: 'hours', label: 'Open', value: summarizeHours(savedDays) },
    { tab: 'rules', label: 'Booking', value: s.mode === 'slots' ? `Every ${s.intervalMinutes} min${s.bookersPerSlot > 1 ? `, ${s.bookersPerSlot} per slot` : ''}` : 'Date only' },
    { tab: 'rules', label: 'Window', value: `${noticeLabel(s.minNoticeMinutes)} notice · ${plural(s.windowDays, 'day')} ahead` },
    { tab: 'off', label: 'Time off', value: upcomingOff.length ? plural(upcomingOff.length, 'upcoming block') : 'None planned' },
  ];

  return (
    <>
      <PageHeader title="Schedule" description={`When customers can book, in ${s.timeZone.replace(/_/g, ' ')}. Changes apply to new bookings only.`} />

      <dl className="mb-5 grid gap-px overflow-hidden rounded-card border border-line bg-line desktop:grid-cols-4">
        {summary.map((x) => (
          <button key={x.label} type="button" onClick={() => setTab(x.tab)} className="cursor-pointer bg-surface px-4 py-3 text-left hover:bg-sunken">
            <dt className="text-xs font-semibold tracking-wide text-faint uppercase">{x.label}</dt>
            <dd className="mt-0.5 text-sm font-medium text-ink">{x.value}</dd>
          </button>
        ))}
      </dl>

      <div className="mb-5 flex gap-1 overflow-x-auto rounded-btn bg-sunken p-1" role="tablist" aria-label="Schedule sections">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 cursor-pointer rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap ${tab === t.key ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div hidden={tab !== 'hours'}>
        <HoursCard data={q.data} edit={edit} />
      </div>
      <div hidden={tab !== 'rules'}>
        <RulesCard data={q.data} edit={edit} />
      </div>
      <div hidden={tab !== 'off'}>
        <BlockedCard tz={s.timeZone} mode={s.mode} edit={edit} />
      </div>
      <div hidden={tab !== 'reminders'}>
        <RemindersCard data={q.data} edit={edit} />
      </div>
    </>
  );
}

/** Bookings that no longer fit after a change (new rules apply to new bookings only). */
function OutsideHours({ list, tz }) {
  if (!list?.length) return null;
  return (
    <Notice tone="warn" title={`${plural(list.length, 'upcoming booking')} fall outside the new hours`} className="mt-4">
      They stay booked. Contact these customers or cancel them from Bookings if needed:
      <ul className="mt-1 list-disc pl-5">
        {list.slice(0, 8).map((b) => (
          <li key={b.id}>
            {b.customer.name} · {fmtDate(b.date)}
            {!b.dateOnly && `, ${fmtTime(b.startsAt, tz)}`}
          </li>
        ))}
      </ul>
    </Notice>
  );
}

/** Save / discard for a card with unsaved edits. */
function SaveBar({ dirty, onDiscard, onSave, loading, disabled, label = 'Save' }) {
  return (
    <div className="flex items-center gap-2">
      {dirty && <span className="text-[13px] text-warn">Unsaved changes</span>}
      {dirty && (
        <Button variant="ghost" size="sm" onClick={onDiscard}>
          Discard
        </Button>
      )}
      <Button onClick={onSave} loading={loading} disabled={disabled || !dirty}>
        {label}
      </Button>
    </div>
  );
}

const PRESETS = [
  { label: 'Mon–Fri, 9–5', days: WEEKDAY_SET, start: 540, end: 1020 },
  { label: 'Mon–Sat, 9–6', days: [...WEEKDAY_SET, 6], start: 540, end: 1080 },
  { label: 'Every day, 9–5', days: ORDER, start: 540, end: 1020 },
];

/** A default break: lunch (12–1) when it fits, else an hour in the middle of the day. */
function newBreak(day) {
  if (day.start <= 720 && day.end >= 780 && !day.breaks.some((b) => b.start < 780 && b.end > 720)) return { start: 720, end: 780 };
  const mid = Math.round((day.start + day.end) / 2 / 15) * 15;
  return { start: Math.max(day.start, mid - 30), end: Math.min(day.end, mid + 30) };
}

function HoursCard({ data, edit }) {
  const initial = useMemo(() => daysFrom(data), [data]);
  const [days, setDays] = useState(initial);
  useEffect(() => setDays(initial), [initial]);
  const [save, state] = useSaveHoursMutation();
  const [outside, setOutside] = useState(null);
  const set = (d, patch) => setDays((x) => ({ ...x, [d]: { ...x[d], ...patch } }));
  const copyTo = (from, targets) => setDays((x) => ({ ...x, ...Object.fromEntries(targets.map((d) => [d, { ...x[from], open: true, breaks: x[from].breaks.map((b) => ({ ...b })) }])) }));
  const applyPreset = (p) => setDays((x) => Object.fromEntries(ORDER.map((d) => [d, p.days.includes(d) ? { open: true, start: p.start, end: p.end, breaks: [] } : { ...x[d], open: false }])));
  const invalid = ORDER.some((d) => dayError(days[d]));
  const dirty = JSON.stringify(days) !== JSON.stringify(initial);
  const openCount = ORDER.filter((d) => days[d].open).length;

  // One scale for every day's bar: the earliest opening to the latest closing (at least 8–18).
  const scale = useMemo(() => {
    const open = ORDER.filter((d) => days[d].open && days[d].end > days[d].start).map((d) => days[d]);
    const lo = Math.floor(Math.min(480, ...open.map((d) => d.start)) / 60) * 60;
    const hi = Math.ceil(Math.max(1080, ...open.map((d) => d.end)) / 60) * 60;
    return { lo, hi };
  }, [days]);

  const submit = async () => {
    const hours = ORDER.filter((d) => days[d].open).map((d) => ({ weekday: d, startMinute: days[d].start, endMinute: days[d].end }));
    const breaks = ORDER.filter((d) => days[d].open).flatMap((d) => days[d].breaks.map((b) => ({ weekday: d, startMinute: b.start, endMinute: b.end })));
    const r = await save({ hours, breaks });
    if (r.error) return toast.error(r.error.message);
    setOutside(r.data.outsideHours);
    toast.success('Hours saved');
  };

  return (
    <Card
      title="Weekly hours"
      description={openCount ? `Open ${plural(openCount, 'day')} · ${hoursLabel(weeklyMinutes(days))} a week, breaks excluded` : 'Closed every day: customers can’t book until you open at least one day.'}
      actions={edit && <SaveBar dirty={dirty} onDiscard={() => setDays(initial)} onSave={submit} loading={state.isLoading} disabled={invalid} label="Save hours" />}
    >
      {edit && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <span className="text-[13px] text-faint">Quick start:</span>
          {PRESETS.map((p) => (
            <Button key={p.label} size="sm" variant="secondary" onClick={() => applyPreset(p)}>
              {p.label}
            </Button>
          ))}
        </div>
      )}

      <div className="flex flex-col divide-y divide-line rounded-btn border border-line">
        {ORDER.map((d) => {
          const day = days[d];
          const error = dayError(day);
          return (
            <div key={d} className={`grid gap-x-4 gap-y-2 px-3 py-3 desktop:grid-cols-[7.5rem_minmax(0,1fr)_12rem_auto] desktop:items-start ${day.open ? '' : 'bg-sunken/50'}`}>
              <div className="flex min-h-10 items-center">
                <Checkbox label={WEEKDAYS[d]} checked={day.open} disabled={!edit} onChange={(e) => set(d, { open: e.target.checked })} />
              </div>

              {day.open ? (
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <TimePicker className="w-36" disabled={!edit} value={day.start} onChange={(m) => set(d, { start: m })} aria-label={`${WEEKDAYS[d]} opens`} />
                    <span className="text-muted">to</span>
                    <TimePicker className="w-36" disabled={!edit} value={day.end} onChange={(m) => set(d, { end: m })} aria-label={`${WEEKDAYS[d]} closes`} />
                  </div>
                  {day.breaks.map((b, i) => (
                    <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
                      <Badge>Break</Badge>
                      <TimePicker className="w-36" disabled={!edit} value={b.start} onChange={(m) => set(d, { breaks: day.breaks.map((x, j) => (j === i ? { ...x, start: m } : x)) })} aria-label={`${WEEKDAYS[d]} break starts`} />
                      <span className="text-muted">to</span>
                      <TimePicker className="w-36" disabled={!edit} value={b.end} onChange={(m) => set(d, { breaks: day.breaks.map((x, j) => (j === i ? { ...x, end: m } : x)) })} aria-label={`${WEEKDAYS[d]} break ends`} />
                      {edit && (
                        <button type="button" onClick={() => set(d, { breaks: day.breaks.filter((_, j) => j !== i) })} className="cursor-pointer rounded-md p-1 text-faint hover:bg-sunken hover:text-danger" aria-label="Remove break">
                          <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                            <path d="M6 6l12 12M18 6L6 18" />
                          </svg>
                        </button>
                      )}
                    </div>
                  ))}
                  {error && <p className="text-[13px] text-danger">{error}</p>}
                </div>
              ) : (
                <p className="flex min-h-10 items-center text-sm text-faint">Closed</p>
              )}

              <DayBar day={day} scale={scale} />

              {edit && day.open ? (
                <div className="flex flex-wrap items-center gap-1 desktop:min-h-10 desktop:justify-end">
                  <Button size="sm" variant="ghost" onClick={() => set(d, { breaks: [...day.breaks, newBreak(day)] })}>
                    + Break
                  </Button>
                  <CopyMenu from={d} onApply={(targets) => copyTo(d, targets)} />
                </div>
              ) : (
                <span className="hidden desktop:block" />
              )}
            </div>
          );
        })}
      </div>
      <OutsideHours list={outside} tz={data.settings.timeZone} />
    </Card>
  );
}

/** A day at a glance: open hours as a bar, breaks as gaps, on the week's shared scale. */
function DayBar({ day, scale }) {
  const span = scale.hi - scale.lo;
  const pct = (m) => `${((Math.min(Math.max(m, scale.lo), scale.hi) - scale.lo) / span) * 100}%`;
  const width = (a, b) => `${(Math.max(0, Math.min(b, scale.hi) - Math.max(a, scale.lo)) / span) * 100}%`;
  return (
    <div className="hidden desktop:flex desktop:min-h-10 desktop:flex-col desktop:justify-center" aria-hidden="true">
      <div className="relative h-2.5 rounded-full bg-sunken">
        {day.open && day.end > day.start && (
          <>
            <div className="absolute inset-y-0 rounded-full bg-brand" style={{ left: pct(day.start), width: width(day.start, day.end) }} />
            {day.breaks.map((b, i) => (
              <div key={i} className="absolute inset-y-0 bg-surface/80" style={{ left: pct(b.start), width: width(b.start, b.end) }} />
            ))}
          </>
        )}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-faint tabular-nums">
        <span>{minuteLabel(scale.lo).replace(':00', '')}</span>
        <span>{minuteLabel(scale.hi).replace(':00', '')}</span>
      </div>
    </div>
  );
}

/** "Copy to…": pick the days that get this day's hours and breaks. */
function CopyMenu({ from, onApply }) {
  const [open, setOpen] = useState(false);
  const others = ORDER.filter((d) => d !== from);
  const [picked, setPicked] = useState([]);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => !ref.current?.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const toggle = (d, on) => setPicked((p) => (on ? [...p, d] : p.filter((x) => x !== d)));
  const pick = (set) => setPicked(others.filter((d) => set.includes(d)));
  return (
    <div className="relative" ref={ref}>
      <Button
        size="sm"
        variant="ghost"
        aria-expanded={open}
        onClick={() => {
          setPicked(others.filter((d) => (WEEKDAY_SET.includes(from) ? WEEKDAY_SET : WEEKEND_SET).includes(d)));
          setOpen((o) => !o);
        }}
      >
        Copy to…
      </Button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-60 rounded-card border border-line bg-surface p-3 shadow-lg">
          <p className="mb-2 text-[13px] font-semibold">Copy {WEEKDAYS[from]}’s hours to</p>
          <div className="mb-2 flex gap-1">
            {[
              ['Weekdays', WEEKDAY_SET],
              ['Weekend', WEEKEND_SET],
              ['All', ORDER],
            ].map(([label, set]) => (
              <button key={label} type="button" onClick={() => pick(set)} className="cursor-pointer rounded-md bg-sunken px-2 py-1 text-xs font-medium text-muted hover:text-ink">
                {label}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            {others.map((d) => (
              <Checkbox key={d} label={WEEKDAYS[d]} checked={picked.includes(d)} onChange={(e) => toggle(d, e.target.checked)} />
            ))}
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={!picked.length}
              onClick={() => {
                onApply(picked);
                setOpen(false);
              }}
            >
              Copy to {picked.length || ''} {picked.length === 1 ? 'day' : 'days'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

const INTERVALS = [15, 30, 45, 60];
const NOTICES = [0, 30, 60, 120, 240, 720, 1440, 2880, 10080];
const WINDOWS = [7, 14, 30, 60, 90, 180, 365];

function Section({ title, description, children, first = false }) {
  return (
    <div className={first ? '' : 'border-t border-line pt-5'}>
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
      <div className="mt-3 grid gap-5 desktop:grid-cols-2">{children}</div>
    </div>
  );
}

/** A row of choices, like radio buttons. */
function Segmented({ value, options, onChange, label }) {
  return (
    <div className="flex flex-wrap gap-1 rounded-btn bg-sunken p-1" role="radiogroup" aria-label={label}>
      {options.map(([v, text]) => (
        <button key={v} type="button" role="radio" aria-checked={value === v} onClick={() => onChange(v)} className={`flex-1 cursor-pointer rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap disabled:cursor-not-allowed ${value === v ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'}`}>
          {text}
        </button>
      ))}
    </div>
  );
}

function RulesCard({ data, edit }) {
  const s = data.settings;
  const zones = useMemo(() => timeZones(), []);
  const [save] = useSaveSettingsMutation();
  const [outside, setOutside] = useState(null);
  const defaults = {
    timeZone: s.timeZone,
    currency: s.currency ?? 'PHP',
    mode: s.mode,
    intervalMinutes: s.intervalMinutes,
    bookersPerSlot: s.bookersPerSlot,
    maxPerDay: s.maxPerDay,
    minNoticeMinutes: s.minNoticeMinutes,
    windowDays: s.windowDays,
    changeCutoffHours: s.changeCutoffHours,
  };
  const { register, handleSubmit, watch, setValue, reset, setError, formState } = useForm({ resolver: yupResolver(rulesSchema), defaultValues: defaults });
  const [customInterval, setCustomInterval] = useState(!INTERVALS.includes(s.intervalMinutes));
  const discard = () => {
    reset(defaults);
    setCustomInterval(!INTERVALS.includes(s.intervalMinutes));
  };
  useEffect(discard, [data]); // eslint-disable-line react-hooks/exhaustive-deps
  const mode = watch('mode');
  const interval = Number(watch('intervalMinutes'));
  const maxPerDay = watch('maxPerDay');
  const noLimit = maxPerDay === null || maxPerDay === '' || maxPerDay === undefined;
  const cutoff = watch('changeCutoffHours');
  const windowDays = Number(watch('windowDays'));
  const err = (k) => formState.errors[k]?.message;
  const dirtyOpts = { shouldDirty: true };

  const submit = handleSubmit(async (v) => {
    const r = await save({ ...v, maxPerDay: noLimit ? null : v.maxPerDay, changeCutoffHours: v.changeCutoffHours ?? null });
    if (r.error) {
      for (const [k, m] of Object.entries(r.error.fields ?? {})) setError(k, { message: m });
      return toast.error(r.error.message);
    }
    setOutside(r.data.outsideHours);
    toast.success('Booking rules saved');
  });

  return (
    <Card
      title="Booking rules"
      description="How customers pick a time, and how far ahead and how late they can book or change."
      actions={edit && <SaveBar dirty={formState.isDirty} onDiscard={discard} onSave={submit} loading={formState.isSubmitting} label="Save rules" />}
    >
      <fieldset disabled={!edit} className="flex flex-col gap-5">
        <Section first title="How customers book">
          <Field label="Booking style" className="desktop:col-span-2">
            {() => (
              <div className="grid gap-2 desktop:grid-cols-2">
                {[
                  ['slots', 'Time slots', 'Customers pick a day and a time.'],
                  ['date', 'Date only', 'Customers pick a day; first come, first served.'],
                ].map(([v, label, hint]) => (
                  <label key={v} className={`flex cursor-pointer gap-3 rounded-btn border p-3 ${mode === v ? 'border-brand bg-brand-soft' : 'border-line'}`}>
                    <input type="radio" value={v} {...register('mode')} className="mt-1 accent-[var(--color-brand)]" />
                    <span>
                      <span className="block text-sm font-semibold">{label}</span>
                      <span className="text-[13px] text-muted">{hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            )}
          </Field>
          {mode === 'slots' && (
            <>
              <Field label="Start times every" hint="How often a new slot starts." error={err('intervalMinutes')}>
                {() => (
                  <div className="flex flex-col gap-2">
                    <Segmented
                      label="Slot interval"
                      value={customInterval ? 'custom' : interval}
                      options={[...INTERVALS.map((i) => [i, `${i} min`]), ['custom', 'Custom']]}
                      onChange={(v) => {
                        setCustomInterval(v === 'custom');
                        if (v !== 'custom') setValue('intervalMinutes', v, dirtyOpts);
                      }}
                    />
                    {customInterval && (
                      <div className="flex items-center gap-2">
                        <Input type="number" min={5} max={480} className="w-24" aria-label="Custom interval in minutes" {...register('intervalMinutes')} />
                        <span className="text-sm text-muted">minutes</span>
                      </div>
                    )}
                  </div>
                )}
              </Field>
              <Field label="Bookers per slot" hint="How many people can book the same time." error={err('bookersPerSlot')}>
                {(a) => <Input {...a} type="number" min={1} max={100} {...register('bookersPerSlot')} />}
              </Field>
            </>
          )}
          <Field label="Maximum bookings per day" error={err('maxPerDay')}>
            {(a) => (
              <div className="flex min-h-10 flex-wrap items-center gap-3">
                <Checkbox label="No limit" checked={noLimit} onChange={(e) => setValue('maxPerDay', e.target.checked ? null : 10, dirtyOpts)} />
                {!noLimit && <Input {...a} type="number" min={1} max={1000} className="w-28" {...register('maxPerDay')} />}
              </div>
            )}
          </Field>
        </Section>

        {mode === 'date' && noLimit && (
          <Notice tone="warn" title="Date only + no limit">
            Customers can book a day with no cap, so a single day could fill up with more people than you can see. Consider a maximum per day.
          </Notice>
        )}

        <Section title="Booking window" description="The earliest and latest a customer can book.">
          <Field label="Minimum notice" hint="How soon before the appointment customers can still book." error={err('minNoticeMinutes')}>
            {(a) => (
              <Select {...a} {...register('minNoticeMinutes', { valueAsNumber: true })}>
                {NOTICES.map((m) => (
                  <option key={m} value={m}>
                    {noticeLabel(m)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Book up to" hint="How far ahead customers can book." error={err('windowDays')}>
            {(a) => (
              <div className="flex items-center gap-2">
                <Select aria-label="Booking window preset" className="flex-1" value={WINDOWS.includes(windowDays) ? windowDays : ''} onChange={(e) => e.target.value && setValue('windowDays', Number(e.target.value), dirtyOpts)}>
                  {!WINDOWS.includes(windowDays) && <option value="">Custom</option>}
                  {WINDOWS.map((w) => (
                    <option key={w} value={w}>
                      {w === 7 ? '1 week' : w === 14 ? '2 weeks' : w === 365 ? '1 year' : w < 60 ? `${w} days` : `${w / 30} months`} ahead
                    </option>
                  ))}
                </Select>
                <Input {...a} type="number" min={1} max={365} className="w-20" aria-label="Booking window in days" {...register('windowDays')} />
                <span className="text-sm text-muted">days</span>
              </div>
            )}
          </Field>
        </Section>

        <Section title="Changes and cancellations">
          <Field label="Online changes" hint="Inside this window, the customer’s link says “Please call” with your phone number." error={err('changeCutoffHours')} className="desktop:col-span-2">
            {(a) => (
              <Select {...a} value={cutoff ?? ''} onChange={(e) => setValue('changeCutoffHours', e.target.value === '' ? null : Number(e.target.value), dirtyOpts)}>
                <option value="">Allowed until the appointment</option>
                {[1, 2, 4, 12, 24, 48, 72].map((h) => (
                  <option key={h} value={h}>
                    No changes within {plural(h, 'hour')}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </Section>

        <Section title="Time zone and currency">
          <Field label="Business time zone" hint="Customers see times in this zone. New events start in it too." error={err('timeZone')}>
            {(a) => (
              <Select {...a} {...register('timeZone')}>
                {zones.map((z) => (
                  <option key={z} value={z}>
                    {z.replace(/_/g, ' ')}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Currency" hint="The default for event prices and refunds. You can still pick another each time." error={err('currency')}>
            {(a) => (
              <Select {...a} {...register('currency')}>
                <CurrencyOptions />
              </Select>
            )}
          </Field>
        </Section>
      </fieldset>
      <OutsideHours list={outside} tz={s.timeZone} />
    </Card>
  );
}

/** Next Saturday and Sunday (this weekend if today is one of them). */
function weekendOf(today) {
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
  if (dow === 0) return [today, today];
  const sat = addDays(today, 6 - dow);
  return [sat, addDays(sat, 1)];
}

function BlockedCard({ tz, mode, edit }) {
  const q = useBlockedQuery();
  const servicesQ = useServicesQuery();
  const services = servicesQ.data?.services ?? [];
  const [block, state] = useBlockMutation();
  const [unblock] = useUnblockMutation();
  const confirm = useConfirm();
  // "Dec 3 – Dec 5 · 12:00 PM – 2:00 PM": the dates, then the time window when it's part of a day.
  const when = (b) => `${b.startDate === b.endDate ? fmtLongDate(b.startDate) : `${fmtDate(b.startDate)} – ${fmtDate(b.endDate)}`}${b.startMinute != null ? ` · ${range(b.startMinute, b.endMinute)}` : ''}`;
  const today = todayIn(tz);
  const timesAllowed = mode !== 'date'; // date-only bookings hold no time, so only whole days apply
  const empty = { startDate: today, endDate: '', reason: '', part: 'day', start: 720, end: 780, serviceId: '' };
  const [form, setForm] = useState(empty);
  const [conflicts, setConflicts] = useState(null);
  const upcoming = (q.data ?? []).filter((b) => b.endDate >= today);
  const [wkStart, wkEnd] = weekendOf(today);
  const quick = [
    ['Today', today, ''],
    ['Tomorrow', addDays(today, 1), ''],
    ['This weekend', wkStart, wkEnd === wkStart ? '' : wkEnd],
    ['Next 7 days', today, addDays(today, 6)],
  ];
  const days = form.endDate && form.endDate > form.startDate ? Math.round((Date.parse(form.endDate) - Date.parse(form.startDate)) / 86_400_000) + 1 : 1;
  const hoursPart = timesAllowed && form.part === 'hours';
  const badTimes = hoursPart && form.end <= form.start;
  const serviceName = services.find((x) => String(x.id) === String(form.serviceId))?.name;
  const blockLabel = `Block ${hoursPart ? `${range(form.start, form.end)}${days > 1 ? ` on ${plural(days, 'day')}` : ''}` : plural(days, 'day')}${serviceName ? ` for ${serviceName}` : ''}`;

  const submit = async (existing = 'ask') => {
    const r = await block({
      startDate: form.startDate,
      endDate: form.endDate || null,
      startMinute: hoursPart ? form.start : null,
      endMinute: hoursPart ? form.end : null,
      serviceId: form.serviceId ? Number(form.serviceId) : null,
      reason: form.reason || null,
      existing,
    });
    if (r.error?.error === 'has_bookings') return setConflicts(r.error.conflicts);
    if (r.error) return toast.error(r.error.message);
    setConflicts(null);
    setForm(empty);
    toast.success(r.data.cancelled ? `Blocked. ${plural(r.data.cancelled, 'booking')} cancelled and the customers emailed.` : 'Time off added');
  };

  const row = (b) => (
    <li key={b.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
      <span className="flex-1">
        <span className="font-medium">{when(b)}</span>
        {b.reason && <span className="text-faint"> · {b.reason}</span>}
      </span>
      <Badge tone={b.service ? 'brand' : 'neutral'}>{b.service ? b.service.name : 'All services'}</Badge>
      {b.startDate <= today && b.endDate >= today && <Badge tone="warn">Now</Badge>}
      {edit && (
        <IconButton
          icon={ICONS.trash}
          tone="danger"
          label={`Remove time off ${when(b)}`}
          onClick={async () => {
            const sure = await confirm({
              title: 'Remove this time off?',
              body: `${when(b)}${b.reason ? ` (${b.reason})` : ''} opens for booking again${b.service ? ` for ${b.service.name}` : ''}, following your weekly hours.`,
              action: 'Remove time off',
            });
            if (!sure) return;
            const r = await unblock(b.id);
            if (r.error) return toast.error(r.error.message);
            toast.success('Time off removed');
          }}
        />
      )}
    </li>
  );

  return (
    <Card title="Time off" description={timesAllowed ? 'Holidays, days off and blocked hours, for the whole business or one service. Customers can’t book them.' : 'Holidays and days off, for the whole business or one service. Customers can’t book these dates.'}>
      {edit && (
        <div className="mb-5 rounded-btn border border-line bg-sunken/40 p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="text-[13px] text-faint">Quick pick:</span>
            {quick.map(([label, start, end]) => (
              <Button key={label} size="sm" variant={form.startDate === start && form.endDate === end ? 'primary' : 'secondary'} onClick={() => setForm({ ...form, startDate: start, endDate: end })}>
                {label}
              </Button>
            ))}
          </div>
          <div className="mb-3 grid gap-3 desktop:grid-cols-2">
            {timesAllowed && (
              <Field label="Block">
                {() => (
                  <Segmented
                    label="Whole day or specific hours"
                    value={form.part}
                    options={[
                      ['day', 'Whole day'],
                      ['hours', 'Specific hours'],
                    ]}
                    onChange={(v) => setForm({ ...form, part: v })}
                  />
                )}
              </Field>
            )}
            <Field label="For" hint={form.serviceId ? 'Only this service is blocked; others stay bookable.' : undefined}>
              {(a) => (
                <Select {...a} value={form.serviceId} onChange={(e) => setForm({ ...form, serviceId: e.target.value })}>
                  <option value="">All services</option>
                  {services.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name}
                      {x.active ? '' : ' (hidden)'}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Dates" className="w-full desktop:w-72">
              {(a) => <DateRangePicker {...a} min={today} start={form.startDate} end={form.endDate} onChange={({ start, end }) => setForm({ ...form, startDate: start, endDate: end })} />}
            </Field>
            {hoursPart && (
              <>
                <Field label="Start time">{(a) => <TimePicker {...a} className="w-36" value={form.start} onChange={(m) => setForm({ ...form, start: m })} />}</Field>
                <Field label="End time">{(a) => <TimePicker {...a} className="w-36" value={form.end} onChange={(m) => setForm({ ...form, end: m })} />}</Field>
              </>
            )}
            <Field label="Reason (optional)" className="min-w-48 flex-1">
              {(a) => <Input {...a} value={form.reason} maxLength={200} placeholder={hoursPart ? 'Staff meeting' : 'Holiday'} onChange={(e) => setForm({ ...form, reason: e.target.value })} />}
            </Field>
            <Button onClick={() => submit()} loading={state.isLoading} disabled={!form.startDate || badTimes}>
              {blockLabel}
            </Button>
          </div>
          {badTimes && <p className="mt-2 text-[13px] text-danger">The end time must be after the start time.</p>}
          {hoursPart && days > 1 && !badTimes && <p className="mt-2 text-[13px] text-muted">Blocks {range(form.start, form.end)} on each day from {fmtDate(form.startDate)} to {fmtDate(form.endDate)}.</p>}
        </div>
      )}

      <h3 className="mb-2 text-sm font-semibold">Upcoming</h3>
      {!upcoming.length ? <p className="text-sm text-faint">No time off planned.</p> : <ul className="divide-y divide-line rounded-btn border border-line">{upcoming.map(row)}</ul>}

      <Dialog
        open={!!conflicts}
        onClose={() => setConflicts(null)}
        busy={state.isLoading}
        title={hoursPart ? 'These times have bookings' : 'These dates have bookings'}
        footer={
          <>
            <Button variant="secondary" onClick={() => submit('keep')}>
              Block, keep bookings
            </Button>
            <Button variant="danger" onClick={() => submit('cancel')}>
              Block and cancel them
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted">Cancelling emails each customer (with your reason) and frees their time. Or keep them and contact the customers yourself.</p>
        <ul className="mt-3 list-disc pl-5 text-sm">
          {conflicts?.map((b) => (
            <li key={b.id}>
              {b.customer.name} · {b.service.name} · {fmtDate(b.date)}
              {!b.dateOnly && `, ${fmtTime(b.startsAt, tz)}`}
            </li>
          ))}
        </ul>
      </Dialog>
    </Card>
  );
}
