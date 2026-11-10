import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { yupResolver } from '@hookform/resolvers/yup';
import { useDispatch, useSelector } from 'react-redux';
import { site } from '../content/site.js';
import { leadSchema } from '../lib/leadSchema.js';
import { leadHref, onRouteLinkClick } from '../lib/router.js';
import { dateKey, detectTimeZone, formatTime, formatWhen, groupByDate, timeZoneOptions } from '../lib/calendar.js';
import { fetchSlots } from '../store/leadFormSlice.js';
import { bookFromChat, bookingErrorCleared } from '../store/chatSlice.js';
import { Icon } from './ui/Icon.jsx';

const b = site.chat.booking;
const REFRESH_MS = 30_000; // re-check booked times while the card is on screen
const fill = (text, values) => text.replace(/\{(\w+)\}/g, (_, k) => values[k] ?? '');

// The card fields only: the rest of the lead (business type, goals, ...) comes from the chat.
const schema = leadSchema.pick(['firstName', 'lastName', 'email', 'phone', 'meetingAt', 'timeZone', 'website']);

const dayFormat = (key, opts) => new Intl.DateTimeFormat(undefined, { ...opts, timeZone: 'UTC' }).format(new Date(`${key}T12:00:00Z`));

// The booking calendar inside the chat: pick a day, pick a time, add name and email, book.
// `prefill` is what the assistant learned in the chat (backend/src/chat/chat.service.ts).
export function ChatBooking({ prefill }) {
  const dispatch = useDispatch();
  const slots = useSelector((s) => s.leadForm.slots);
  const { status, error, fields } = useSelector((s) => s.chat.booking);
  const booked = useSelector((s) => s.chat.booked);

  useEffect(() => {
    if (booked) return undefined;
    dispatch(fetchSlots());
    const timer = setInterval(() => dispatch(fetchSlots()), REFRESH_MS);
    return () => clearInterval(timer);
  }, [dispatch, booked]);

  const form = useForm({
    resolver: yupResolver(schema),
    defaultValues: { firstName: '', lastName: '', email: '', phone: '', meetingAt: '', timeZone: detectTimeZone(), website: '' },
  });
  const { register, handleSubmit, watch, setValue, setError, formState } = form;
  const timeZone = watch('timeZone');
  const meetingAt = watch('meetingAt');

  // Errors from the server go next to their field.
  useEffect(() => {
    for (const [name, msg] of Object.entries(fields)) if (name in schema.fields) setError(name, { message: msg });
    if (fields.meetingAt) {
      setValue('meetingAt', '');
      dispatch(fetchSlots());
    }
  }, [fields, setError, setValue, dispatch]);

  const taken = useMemo(() => new Set(slots.taken), [slots.taken]);
  const groups = useMemo(() => groupByDate(slots.items.filter((iso) => !taken.has(iso)), timeZone), [slots.items, taken, timeZone]);
  const days = [...groups.keys()];
  const [pickedDay, setPickedDay] = useState(null);
  const activeDay = (pickedDay && groups.has(pickedDay) && pickedDay) || (meetingAt && dateKey(meetingAt, timeZone)) || days[0];

  // A time someone else just booked is un-chosen.
  useEffect(() => {
    if (meetingAt && taken.has(meetingAt)) setValue('meetingAt', '');
  }, [meetingAt, taken, setValue]);

  const zones = useMemo(() => timeZoneOptions(timeZone), [timeZone]);

  if (booked) {
    return (
      <Card>
        <p className="flex items-start gap-2 text-sm font-semibold text-midnight-plum">
          <span className="mt-0.5 inline-grid size-5 flex-none place-items-center rounded-full bg-circuit-teal motion-safe:animate-pop">
            <Icon name="check" className="size-3" strokeWidth={3} />
          </span>
          {formatWhen(booked.meetingAt, booked.timeZone)}
        </p>
      </Card>
    );
  }

  const onSubmit = handleSubmit((values) => {
    dispatch(bookingErrorCleared());
    dispatch(bookFromChat({ prefill, values }));
  });
  const fieldError = (name) => formState.errors[name]?.message;
  const sending = status === 'sending';

  return (
    <Card>
      <p className="-mx-3 -mt-3 mb-1 flex items-center gap-2 rounded-t-card bg-linear-to-r from-bun-orange via-honey-gold to-bun-orange bg-size-[200%_100%] px-3 py-2.5 text-sm font-bold text-midnight-plum motion-safe:animate-gradient-pan">
        <span className="grid size-7 place-items-center rounded-full bg-cream-dough/70 motion-safe:animate-float">
          <Icon name="calendar" className="size-4" strokeWidth={2.2} />
        </span>
        {b.title}
      </p>

      <label className="mt-2 flex items-center gap-1.5 text-xs text-muted">
        <Icon name="globe" className="size-3.5 flex-none" strokeWidth={2} />
        <span className="flex-none">{b.timeZoneLabel}</span>
        <select {...register('timeZone')} className="min-w-0 flex-1 truncate rounded-md border border-line bg-cream-dough px-1.5 py-1 text-xs text-midnight-plum">
          {zones.map((z) => (
            <option key={z.value} value={z.value}>
              {z.label}
            </option>
          ))}
        </select>
      </label>

      {slots.status === 'error' && !slots.items.length ? (
        <p className="mt-3 text-sm text-danger">
          {b.loadError}{' '}
          <button type="button" className="cursor-pointer font-semibold underline" onClick={() => dispatch(fetchSlots())}>
            {b.retry}
          </button>
        </p>
      ) : !slots.items.length ? (
        <p className="mt-3 text-sm text-muted">{b.loading}</p>
      ) : !days.length ? (
        <p className="mt-3 text-sm text-muted">{b.noTimes}</p>
      ) : !meetingAt ? (
        <>
          <p className="mt-3 mb-1.5 text-xs font-semibold tracking-wide text-soft-violet uppercase">{b.pickTime}</p>
          <div data-lenis-prevent className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1.5" role="tablist" aria-label="Days">
            {days.map((key) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={key === activeDay}
                onClick={() => setPickedDay(key)}
                className={`flex w-12 flex-none cursor-pointer flex-col items-center rounded-xl border-2 py-1.5 text-xs transition-all ${
                  key === activeDay
                    ? 'scale-105 border-transparent bg-linear-to-b from-byte-purple to-soft-violet text-cream-dough shadow-md'
                    : 'border-line bg-lavender-mist/50 text-midnight-plum hover:border-soft-violet motion-safe:hover:-translate-y-0.5'
                }`}
              >
                <span>{dayFormat(key, { weekday: 'short' })}</span>
                <span className="text-base font-bold">{Number(key.slice(8))}</span>
                <span className="opacity-80">{dayFormat(key, { month: 'short' })}</span>
              </button>
            ))}
          </div>
          <div className="mt-1.5 grid grid-cols-3 gap-1.5" role="radiogroup" aria-label={`Times on ${dayFormat(activeDay, { weekday: 'long', month: 'long', day: 'numeric' })}`}>
            {(groups.get(activeDay) ?? []).map((iso, i) => (
              <button
                key={`${activeDay}-${iso}`}
                type="button"
                role="radio"
                aria-checked={false}
                onClick={() => setValue('meetingAt', iso, { shouldValidate: true })}
                style={{ animationDelay: `${i * 40}ms` }}
                className="cursor-pointer rounded-xl border-2 border-circuit-teal/40 bg-circuit-teal/10 py-2 text-sm font-semibold text-midnight-plum transition-all hover:border-circuit-teal hover:bg-circuit-teal/25 motion-safe:animate-pop motion-safe:hover:scale-105"
              >
                {formatTime(iso, timeZone)}
              </button>
            ))}
          </div>
          {fieldError('meetingAt') && <p className="mt-2 text-xs text-danger">{error || fieldError('meetingAt')}</p>}
        </>
      ) : (
        <form onSubmit={onSubmit} noValidate className="mt-3 grid gap-2">
          <div className="flex items-center justify-between gap-2 rounded-xl border-2 border-honey-gold/60 bg-gold-tint px-2.5 py-2 text-sm font-semibold text-midnight-plum motion-safe:animate-pop">
            <span>{fill(b.pickedLabel, { when: formatWhen(meetingAt, timeZone) })}</span>
            <button type="button" className="flex-none cursor-pointer text-xs font-semibold text-byte-purple underline" onClick={() => setValue('meetingAt', '')}>
              {b.changeTime}
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field label={b.firstName} error={fieldError('firstName')} autoComplete="given-name" {...register('firstName')} />
            <Field label={b.lastName} error={fieldError('lastName')} autoComplete="family-name" {...register('lastName')} />
          </div>
          <Field label={b.email} type="email" error={fieldError('email')} autoComplete="email" inputMode="email" {...register('email')} />
          <Field label={b.phone} type="tel" error={fieldError('phone')} autoComplete="tel" inputMode="tel" {...register('phone')} />
          {/* Honeypot: hidden from people, often filled by bots. */}
          <input type="text" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hidden" {...register('website')} />
          <p className="text-[11px] text-muted">{b.privacy}</p>
          {error && (
            <p role="alert" className="text-xs text-danger">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={sending}
            className="min-h-11 cursor-pointer rounded-btn bg-linear-to-r from-bun-orange via-honey-gold to-bun-orange bg-size-[200%_100%] px-4 font-bold text-midnight-plum shadow-md transition-transform motion-safe:animate-gradient-pan motion-safe:hover:-translate-y-0.5 disabled:cursor-wait disabled:opacity-70"
          >
            {sending ? b.sending : b.submit}
          </button>
        </form>
      )}

      <p className="mt-2.5 text-[11px] text-muted">
        {b.fullFormLabel}{' '}
        <a href={leadHref('chatbot')} onClick={onRouteLinkClick} className="font-semibold text-byte-purple underline">
          {site.chat.offlineCta}
        </a>
      </p>
    </Card>
  );
}

function Card({ children }) {
  return <div className="mt-2 w-full overflow-hidden rounded-card border-2 border-honey-gold/50 bg-cream-dough p-3 shadow-lg motion-safe:animate-rise">{children}</div>;
}

function Field({ label, error, ref, ...input }) {
  return (
    <label className="grid gap-0.5 text-xs font-semibold text-midnight-plum">
      {label}
      <input
        ref={ref}
        aria-invalid={!!error}
        className={`min-h-10 rounded-xl border-2 bg-lavender-mist/40 px-2.5 text-sm font-normal text-midnight-plum transition-colors outline-none focus:border-soft-violet focus:bg-cream-dough ${error ? 'border-danger' : 'border-line'}`}
        {...input}
      />
      {error && <span className="font-normal text-danger">{error}</span>}
    </label>
  );
}
