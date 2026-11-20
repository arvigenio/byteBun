import { yupResolver } from '@hookform/resolvers/yup';
import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { useBlockedQuery, useBlockMutation, useMeQuery, useSaveHoursMutation, useSaveSettingsMutation, useSettingsQuery, useUnblockMutation } from '../api.js';
import { fmtDate, fmtLongDate, fmtTime, fromTimeInput, timeZones, toTimeInput, todayIn, WEEKDAYS } from '../lib/format.js';
import { rulesSchema } from '../lib/schemas.js';
import { Button, Card, Checkbox, Dialog, Field, Input, Loading, Notice, PageHeader, Select } from '../ui.jsx';
import { can } from './BookingsApp.jsx';
import { RemindersCard } from './RemindersCard.jsx';

const ORDER = [1, 2, 3, 4, 5, 6, 0]; // Monday first

/** Bookings that no longer fit after a change (new rules apply to new bookings only). */
function OutsideHours({ list, tz }) {
  if (!list?.length) return null;
  return (
    <Notice tone="warn" title={`${list.length} upcoming booking${list.length === 1 ? '' : 's'} fall outside the new hours`} className="mt-4">
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

export function SchedulePage() {
  const { data: me } = useMeQuery();
  const q = useSettingsQuery();
  if (q.isLoading || !q.data) return <Loading />;
  const edit = can(me, 'bookings.settings');
  return (
    <>
      <PageHeader title="Schedule" description="When customers can book. Changes apply to new bookings only." />
      <div className="flex flex-col gap-5">
        <HoursCard data={q.data} edit={edit} />
        <RulesCard data={q.data} edit={edit} />
        <RemindersCard data={q.data} edit={edit} />
        <BlockedCard tz={q.data.settings.timeZone} edit={edit} />
      </div>
    </>
  );
}

function HoursCard({ data, edit }) {
  const initial = useMemo(() => {
    const days = {};
    for (const d of ORDER) {
      const h = data.hours.find((x) => x.weekday === d);
      days[d] = { open: !!h, start: h?.startMinute ?? 540, end: h?.endMinute ?? 1020, breaks: data.breaks.filter((b) => b.weekday === d).map((b) => ({ start: b.startMinute, end: b.endMinute })) };
    }
    return days;
  }, [data]);
  const [days, setDays] = useState(initial);
  useEffect(() => setDays(initial), [initial]);
  const [save, state] = useSaveHoursMutation();
  const [outside, setOutside] = useState(null);
  const set = (d, patch) => setDays((x) => ({ ...x, [d]: { ...x[d], ...patch } }));
  const copyToAll = (from) => setDays((x) => Object.fromEntries(ORDER.map((d) => [d, x[d].open || d === from ? { ...x[from], breaks: x[from].breaks.map((b) => ({ ...b })) } : x[d]])));
  const invalid = ORDER.some((d) => days[d].open && (days[d].end <= days[d].start || days[d].breaks.some((b) => b.end <= b.start || b.start < days[d].start || b.end > days[d].end)));

  const submit = async () => {
    const hours = ORDER.filter((d) => days[d].open).map((d) => ({ weekday: d, startMinute: days[d].start, endMinute: days[d].end }));
    const breaks = ORDER.filter((d) => days[d].open).flatMap((d) => days[d].breaks.map((b) => ({ weekday: d, startMinute: b.start, endMinute: b.end })));
    const r = await save({ hours, breaks });
    if (r.error) return toast.error(r.error.message);
    setOutside(r.data.outsideHours);
    toast.success('Hours saved');
  };

  return (
    <Card title="Opening hours" description="Per weekday, with optional breaks (e.g. lunch)." actions={edit && <Button onClick={submit} loading={state.isLoading} disabled={invalid}>Save hours</Button>}>
      <div className="flex flex-col divide-y divide-line">
        {ORDER.map((d) => {
          const day = days[d];
          return (
            <div key={d} className="flex flex-wrap items-start gap-3 py-3">
              <div className="w-32 pt-2">
                <Checkbox label={WEEKDAYS[d]} checked={day.open} disabled={!edit} onChange={(e) => set(d, { open: e.target.checked })} />
              </div>
              {day.open ? (
                <div className="flex flex-1 flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Input type="time" step={300} className="w-32" disabled={!edit} value={toTimeInput(day.start)} onChange={(e) => set(d, { start: fromTimeInput(e.target.value) })} aria-label={`${WEEKDAYS[d]} opens`} />
                    <span className="text-muted">to</span>
                    <Input type="time" step={300} className="w-32" disabled={!edit} value={toTimeInput(day.end)} onChange={(e) => set(d, { end: fromTimeInput(e.target.value) })} aria-label={`${WEEKDAYS[d]} closes`} />
                    {edit && (
                      <>
                        <Button size="sm" variant="ghost" onClick={() => set(d, { breaks: [...day.breaks, { start: Math.min(day.start + 180, day.end - 60), end: Math.min(day.start + 240, day.end) }] })}>
                          + Break
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => copyToAll(d)} title="Copy these hours and breaks to every open day">
                          Copy to all days
                        </Button>
                      </>
                    )}
                  </div>
                  {day.breaks.map((b, i) => (
                    <div key={i} className="flex flex-wrap items-center gap-2 pl-4 text-sm">
                      <span className="text-faint">Break</span>
                      <Input type="time" step={300} className="w-28" disabled={!edit} value={toTimeInput(b.start)} onChange={(e) => set(d, { breaks: day.breaks.map((x, j) => (j === i ? { ...x, start: fromTimeInput(e.target.value) } : x)) })} aria-label="Break starts" />
                      <span className="text-muted">to</span>
                      <Input type="time" step={300} className="w-28" disabled={!edit} value={toTimeInput(b.end)} onChange={(e) => set(d, { breaks: day.breaks.map((x, j) => (j === i ? { ...x, end: fromTimeInput(e.target.value) } : x)) })} aria-label="Break ends" />
                      {edit && (
                        <Button size="sm" variant="ghost" onClick={() => set(d, { breaks: day.breaks.filter((_, j) => j !== i) })}>
                          Remove
                        </Button>
                      )}
                    </div>
                  ))}
                  {(day.end <= day.start || day.breaks.some((b) => b.end <= b.start || b.start < day.start || b.end > day.end)) && <p className="text-[13px] text-danger">Check the times: closing after opening, breaks inside the hours.</p>}
                </div>
              ) : (
                <p className="pt-2 text-sm text-faint">Closed</p>
              )}
            </div>
          );
        })}
      </div>
      <OutsideHours list={outside} tz={data.settings.timeZone} />
    </Card>
  );
}

const INTERVALS = [15, 30, 45, 60];

function RulesCard({ data, edit }) {
  const s = data.settings;
  const zones = useMemo(() => timeZones(), []);
  const [save] = useSaveSettingsMutation();
  const [outside, setOutside] = useState(null);
  const defaults = {
    timeZone: s.timeZone,
    mode: s.mode,
    intervalMinutes: s.intervalMinutes,
    bookersPerSlot: s.bookersPerSlot,
    maxPerDay: s.maxPerDay,
    minNoticeMinutes: s.minNoticeMinutes,
    windowDays: s.windowDays,
    changeCutoffHours: s.changeCutoffHours,
  };
  const { register, handleSubmit, watch, setValue, reset, setError, formState } = useForm({ resolver: yupResolver(rulesSchema), defaultValues: defaults });
  useEffect(() => reset(defaults), [data]); // eslint-disable-line react-hooks/exhaustive-deps
  const mode = watch('mode');
  const interval = Number(watch('intervalMinutes'));
  const maxPerDay = watch('maxPerDay');
  const noLimit = maxPerDay === null || maxPerDay === '' || maxPerDay === undefined;
  const cutoff = watch('changeCutoffHours');
  const err = (k) => formState.errors[k]?.message;

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
    <Card title="Booking rules" actions={edit && <Button onClick={submit} loading={formState.isSubmitting}>Save rules</Button>}>
      <fieldset disabled={!edit} className="grid gap-5 desktop:grid-cols-2">
        <Field label="Time zone" hint="Customers see times in this zone." error={err('timeZone')} className="desktop:col-span-2">
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
        <Field label="How customers book" className="desktop:col-span-2">
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
            <Field label="Slot interval" hint="A new start time every…" error={err('intervalMinutes')}>
              {(a) => (
                <div className="flex gap-2">
                  <Select {...a} value={INTERVALS.includes(interval) ? interval : 'custom'} onChange={(e) => e.target.value !== 'custom' && setValue('intervalMinutes', Number(e.target.value), { shouldDirty: true })}>
                    {INTERVALS.map((i) => (
                      <option key={i} value={i}>
                        {i} minutes
                      </option>
                    ))}
                    <option value="custom">Custom</option>
                  </Select>
                  <Input type="number" min={5} max={480} className="w-24" aria-label="Custom interval in minutes" {...register('intervalMinutes')} />
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
            <div className="flex flex-col gap-2">
              <Checkbox label="No limit" checked={noLimit} onChange={(e) => setValue('maxPerDay', e.target.checked ? null : 10, { shouldDirty: true })} />
              {!noLimit && <Input {...a} type="number" min={1} max={1000} {...register('maxPerDay')} />}
            </div>
          )}
        </Field>
        <Field label="Minimum notice" hint="How soon before the appointment customers can still book." error={err('minNoticeMinutes')}>
          {(a) => (
            <Select {...a} {...register('minNoticeMinutes', { valueAsNumber: true })}>
              {[0, 30, 60, 120, 240, 720, 1440, 2880, 10080].map((m) => (
                <option key={m} value={m}>
                  {m === 0 ? 'None' : m < 60 ? `${m} minutes` : m < 1440 ? `${m / 60} hour${m === 60 ? '' : 's'}` : `${m / 1440} day${m === 1440 ? '' : 's'}`}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Booking window (days ahead)" hint="How far ahead customers can book." error={err('windowDays')}>
          {(a) => <Input {...a} type="number" min={1} max={365} {...register('windowDays')} />}
        </Field>
        <Field label="Online changes" hint="Inside this window, the customer’s link says “Please call” with your phone number." error={err('changeCutoffHours')}>
          {(a) => (
            <Select {...a} value={cutoff ?? ''} onChange={(e) => setValue('changeCutoffHours', e.target.value === '' ? null : Number(e.target.value), { shouldDirty: true })}>
              <option value="">Allowed until the appointment</option>
              {[1, 2, 4, 12, 24, 48, 72].map((h) => (
                <option key={h} value={h}>
                  No changes within {h} hour{h === 1 ? '' : 's'}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </fieldset>
      {mode === 'date' && noLimit && (
        <Notice tone="warn" className="mt-4" title="Date only + no limit">
          Customers can book a day with no cap, so a single day could fill up with more people than you can see. Consider a maximum per day.
        </Notice>
      )}
      <OutsideHours list={outside} tz={s.timeZone} />
    </Card>
  );
}

function BlockedCard({ tz, edit }) {
  const q = useBlockedQuery();
  const [block, state] = useBlockMutation();
  const [unblock] = useUnblockMutation();
  const today = todayIn(tz);
  const [form, setForm] = useState({ startDate: today, endDate: '', reason: '' });
  const [conflicts, setConflicts] = useState(null);

  const submit = async (existing = 'ask') => {
    const r = await block({ ...form, endDate: form.endDate || null, reason: form.reason || null, existing });
    if (r.error?.error === 'has_bookings') return setConflicts(r.error.conflicts);
    if (r.error) return toast.error(r.error.message);
    setConflicts(null);
    setForm({ startDate: today, endDate: '', reason: '' });
    toast.success(r.data.cancelled ? `Blocked. ${r.data.cancelled} booking(s) cancelled and the customers emailed.` : 'Dates blocked');
  };

  return (
    <Card title="Blocked dates" description="Holidays and days off. Customers can’t book these dates.">
      {edit && (
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <Field label="From">{(a) => <Input {...a} type="date" min={today} value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />}</Field>
          <Field label="To (optional)">{(a) => <Input {...a} type="date" min={form.startDate} value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />}</Field>
          <Field label="Reason (optional)" className="min-w-48 flex-1">
            {(a) => <Input {...a} value={form.reason} maxLength={200} placeholder="Holiday" onChange={(e) => setForm({ ...form, reason: e.target.value })} />}
          </Field>
          <Button onClick={() => submit()} loading={state.isLoading} disabled={!form.startDate}>
            Block
          </Button>
        </div>
      )}
      {!q.data?.length ? (
        <p className="text-sm text-faint">No blocked dates.</p>
      ) : (
        <ul className="divide-y divide-line rounded-btn border border-line">
          {q.data.map((b) => (
            <li key={b.id} className="flex items-center gap-3 px-3 py-2 text-sm">
              <span className="flex-1">
                {b.startDate === b.endDate ? fmtLongDate(b.startDate) : `${fmtDate(b.startDate)} – ${fmtDate(b.endDate)}`}
                {b.reason && <span className="text-faint"> · {b.reason}</span>}
              </span>
              {edit && (
                <Button size="sm" variant="ghost" onClick={() => unblock(b.id)}>
                  Remove
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <Dialog
        open={!!conflicts}
        onClose={() => setConflicts(null)}
        title="These dates have bookings"
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

