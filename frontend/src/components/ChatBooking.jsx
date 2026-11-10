import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { yupResolver } from '@hookform/resolvers/yup';
import { useDispatch, useSelector } from 'react-redux';
import { site } from '../content/site.js';
import { leadSchema } from '../lib/leadSchema.js';
import { leadHref, onRouteLinkClick } from '../lib/router.js';
import { dateKey, detectTimeZone, formatWhen, timeZoneOptions } from '../lib/calendar.js';
import { fetchSlots } from '../store/leadFormSlice.js';
import { bookFromChat, bookingErrorCleared } from '../store/chatSlice.js';
import { SlotCalendar } from './SlotCalendar.jsx';
import { Icon } from './ui/Icon.jsx';

const b = site.chat.booking;
const REFRESH_MS = 30_000; // re-check booked times while the card is on screen
const fill = (text, values) => text.replace(/\{(\w+)\}/g, (_, k) => values[k] ?? '');

// The card fields only: the rest of the lead (business type, goals, ...) comes from the chat.
const schema = leadSchema.pick(['firstName', 'lastName', 'email', 'phone', 'meetingAt', 'timeZone', 'website']);

// The booking calendar inside the chat: pick a day on the month calendar (SlotCalendar.jsx, compact),
// pick a time, add name and email, book.
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
  const hasOpenTime = slots.items.some((iso) => !taken.has(iso));
  // "Change" goes back to the calendar on the day of the time they had chosen.
  const [lastDay, setLastDay] = useState(null);

  // A time someone else just booked is un-chosen.
  useEffect(() => {
    if (meetingAt && taken.has(meetingAt)) setValue('meetingAt', '');
  }, [meetingAt, taken, setValue]);

  // The time the visitor already chose in the chat starts picked, once the slots show it's still open.
  const suggested = prefill?.meetingAt;
  const [suggestionUsed, setSuggestionUsed] = useState(false);
  useEffect(() => {
    if (suggestionUsed || !suggested || !slots.items.length) return;
    setSuggestionUsed(true);
    if (slots.items.includes(suggested) && !taken.has(suggested)) setValue('meetingAt', suggested, { shouldValidate: true });
  }, [suggestionUsed, suggested, slots.items, taken, setValue]);

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
      ) : !hasOpenTime ? (
        <p className="mt-3 text-sm text-muted">{b.noTimes}</p>
      ) : !meetingAt ? (
        <>
          <p className="mt-3 mb-1.5 text-xs font-semibold tracking-wide text-soft-violet uppercase">{b.pickTime}</p>
          <SlotCalendar
            compact
            items={slots.items}
            taken={slots.taken}
            timeZone={timeZone}
            selected={meetingAt}
            defaultDay={lastDay}
            radio={register('meetingAt')}
            error={fieldError('meetingAt') && (error || fieldError('meetingAt'))}
            errorId="chat-booking-time-error"
          />
        </>
      ) : (
        <form onSubmit={onSubmit} noValidate className="mt-3 grid gap-2">
          <div className="flex items-center justify-between gap-2 rounded-xl border-2 border-honey-gold/60 bg-gold-tint px-2.5 py-2 text-sm font-semibold text-midnight-plum motion-safe:animate-pop">
            <span>{fill(b.pickedLabel, { when: formatWhen(meetingAt, timeZone) })}</span>
            <button
              type="button"
              className="flex-none cursor-pointer text-xs font-semibold text-byte-purple underline"
              onClick={() => {
                setLastDay(dateKey(meetingAt, timeZone));
                setValue('meetingAt', '');
              }}
            >
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
        <a href={leadHref('chat-link')} onClick={onRouteLinkClick} className="font-semibold text-byte-purple underline">
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
        className={`min-h-10 w-full min-w-0 rounded-xl border-2 bg-lavender-mist/40 px-2.5 text-sm font-normal text-midnight-plum transition-colors outline-none focus:border-soft-violet focus:bg-cream-dough ${error ? 'border-danger' : 'border-line'}`}
        {...input}
      />
      {error && <span className="font-normal text-danger">{error}</span>}
    </label>
  );
}
