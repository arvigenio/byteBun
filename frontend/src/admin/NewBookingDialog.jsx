import { useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { toast } from 'sonner';
import { SlotCalendar } from '../components/SlotCalendar.jsx';
import { useAdminForm } from '../hooks/admin/useAdminForm.js';
import { useOpenSlots } from '../hooks/admin/useCallActions.js';
import { formatWhen } from '../lib/calendar.js';
import { adminBookingSchema, ORIGIN_KEYS } from '../lib/adminSchemas.js';
import { ORIGIN_LABELS } from '../lib/leadOrigin.js';
import { createBookingAdmin, fetchBookingSlots, fetchLead, fetchLeadOptions } from '../store/adminDataSlices.js';
import { Dialog } from './dialogs.jsx';
import { AdminButton, Checkboxes, Field, Notice, SelectInput, Spinner, TextInput } from './ui.jsx';

// "New booking" on the Bookings page: an admin books an open call time for someone who reached the
// team another way (a phone call, a message, in person). Only the name, email and time are needed;
// their line of business, what they want (goals, features) and notes help the team prepare.
// The time is picked on the same month calendar as the lead page and the chat (SlotCalendar.jsx).
// Same rules as the lead page (open slots only, one upcoming call per email). The person gets the
// usual confirmation email and reminder; the other admin is emailed and sees it live.
// Server: POST /api/admin/bookings (backend/src/leads/leads.service.ts bookByAdmin).

const TEXTAREA =
  'block w-full rounded-btn border-2 border-line bg-cream-dough px-3.5 py-2.5 text-[15px] text-midnight-plum outline-none transition-colors placeholder:text-muted/60 focus:border-soft-violet aria-[invalid=true]:border-danger';

// Suggestions for "Line of business": the lead page's types (backend/src/chat/knowledge.ts BUSINESS_TYPES).
const BUSINESS_TYPES = ['Dental clinic', 'Veterinary clinic', 'Aesthetic clinic'];

const PH = 'Asia/Manila';
const browserZone = () => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || PH;
  } catch {
    return PH;
  }
};
// Offered first: where most clients are.
const COMMON_ZONES = [PH, 'Asia/Singapore', 'Asia/Dubai', 'Europe/London', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Australia/Sydney'];

const offsetOf = (zone) => {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'shortOffset' }).formatToParts(new Date()).find((p) => p.type === 'timeZoneName')?.value ?? '';
  } catch {
    return '';
  }
};
const zoneLabel = (zone) => `${zone.replace(/_/g, ' ')}${offsetOf(zone) ? ` (${offsetOf(zone)})` : ''}${zone === PH ? ' · Philippines' : ''}`;

/** Every time zone the browser knows, the common ones (and yours) first. */
function useZones(mine) {
  return useMemo(() => {
    let all = [];
    try {
      all = Intl.supportedValuesOf('timeZone');
    } catch {
      all = [];
    }
    const common = [...new Set([mine, ...COMMON_ZONES])];
    const rest = [...new Set([...all, mine, PH])].filter((z) => !common.includes(z)).sort();
    return { common, rest };
  }, [mine]);
}

const fmt = (iso, timeZone) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', ...(timeZone && { timeZone }) }).format(new Date(iso));

export function NewBookingDialog({ onClose }) {
  const dispatch = useDispatch();
  const mine = browserZone();
  const zones = useZones(mine);
  const slots = useOpenSlots();
  const hasOpenTime = useMemo(() => {
    const taken = new Set(slots.taken);
    return slots.items.some((iso) => !taken.has(iso));
  }, [slots.items, slots.taken]);
  const [error, setError] = useState('');
  const form = useAdminForm(adminBookingSchema, {
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    businessName: '',
    businessType: '',
    origin: '',
    goals: [],
    goalsOther: '',
    features: [],
    message: '',
    startsAt: '',
    timeZone: mine,
  });
  const { register, formState, watch } = form;
  const err = (name) => formState.errors[name]?.message;
  const [startsAt, timeZone, goals] = watch(['startsAt', 'timeZone', 'goals']);

  // The goal and feature choices (the same as the lead page), loaded once.
  const options = useSelector((s) => s.adminLeads.options);
  useEffect(() => {
    dispatch(fetchLeadOptions());
  }, [dispatch]);
  const wantsOther = (goals ?? []).includes(options?.otherGoal ?? 'other');

  const onSubmit = form.handleSubmit(async (values) => {
    setError('');
    const result = await dispatch(createBookingAdmin(values));
    if (createBookingAdmin.fulfilled.match(result)) {
      const { lead } = result.payload;
      toast.success(`Call booked with ${lead.firstName} ${lead.lastName}`, {
        description: `${fmt(values.startsAt)} (your time). ${lead.firstName} has been emailed a confirmation.`,
        action: { label: 'Open', onClick: () => dispatch(fetchLead(lead.id)) },
      });
      onClose();
      return;
    }
    form.applyServerErrors(result.payload);
    // A field's own message shows under it; the box at the top is for everything else.
    if (!Object.keys(result.payload?.fields ?? {}).length) setError(result.payload?.message || 'The call was not booked. Please try again.');
    // Someone took that time a moment ago: show the times that are still open.
    if (result.payload?.fields?.startsAt) {
      form.setValue('startsAt', '');
      dispatch(fetchBookingSlots());
    }
  });

  return (
    <Dialog
      eyebrow="Bookings"
      title="Book a call"
      stripe="bg-bun-orange"
      wide
      onClose={onClose}
      footer={
        <div className="ml-auto flex flex-wrap gap-3">
          <AdminButton variant="outline" onClick={onClose} disabled={formState.isSubmitting}>
            Cancel
          </AdminButton>
          <AdminButton type="submit" form="new-booking-form" busy={formState.isSubmitting}>
            Book the call
          </AdminButton>
        </div>
      }
    >
      <form id="new-booking-form" onSubmit={onSubmit} noValidate className="px-6 pt-5 pb-1 mobile:px-5">
        <p className="mb-5 text-[15px] text-muted">
          For someone who called, messaged or met you. They get the usual confirmation email, with a calendar invite and their own link to reschedule or cancel, and a reminder before the call. The other admin is emailed too.
        </p>
        {error && <Notice tone="danger">{error}</Notice>}

        <Section title="Client">
          <div className="grid grid-cols-2 gap-x-4 mobile:grid-cols-1">
            <Field label="First name" id="nb-first" error={err('firstName')}>
              <TextInput id="nb-first" autoFocus autoComplete="off" error={formState.errors.firstName} {...register('firstName')} />
            </Field>
            <Field label="Last name" id="nb-last" error={err('lastName')}>
              <TextInput id="nb-last" autoComplete="off" error={formState.errors.lastName} {...register('lastName')} />
            </Field>
            <Field label="Email" id="nb-email" hint="The confirmation goes here." error={err('email')}>
              <TextInput id="nb-email" type="email" inputMode="email" autoComplete="off" error={formState.errors.email} {...register('email')} />
            </Field>
            <Field label="Phone (optional)" id="nb-phone" error={err('phone')}>
              <TextInput id="nb-phone" type="tel" inputMode="tel" autoComplete="off" error={formState.errors.phone} {...register('phone')} />
            </Field>
            <Field label="Business name (optional)" id="nb-business" error={err('businessName')}>
              <TextInput id="nb-business" autoComplete="off" error={formState.errors.businessName} {...register('businessName')} />
            </Field>
            <Field label="Line of business (optional)" id="nb-type" error={err('businessType')}>
              <TextInput id="nb-type" list="nb-type-options" autoComplete="off" placeholder="e.g. Dental clinic" error={formState.errors.businessType} {...register('businessType')} />
              <datalist id="nb-type-options">
                {BUSINESS_TYPES.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </Field>
          </div>

          <Field label="How they found us (optional)" id="nb-origin" error={err('origin')}>
            <SelectInput id="nb-origin" {...register('origin')}>
              <option value="">Not known</option>
              {ORIGIN_KEYS.map((k) => (
                <option key={k} value={k}>
                  {ORIGIN_LABELS[k]}
                </option>
              ))}
            </SelectInput>
          </Field>
        </Section>

        <Section title="What they want" hint="Optional. Helps whoever takes the call come prepared.">
          {options ? (
            <>
              <Checkboxes label="What they want to achieve" name="goals" items={options.goals} register={register} error={err('goals')} />
              {wantsOther && (
                <Field label='Describe the "Other" goal' id="nb-goal-other" error={err('goalsOther')}>
                  <TextInput id="nb-goal-other" autoComplete="off" placeholder="e.g. Take cake orders online" error={formState.errors.goalsOther} {...register('goalsOther')} />
                </Field>
              )}
              <Checkboxes label="Features they're interested in" name="features" items={options.features} register={register} error={err('features')} />
            </>
          ) : (
            <Spinner label="Loading the choices…" />
          )}
          <Field label="Notes for the team" id="nb-notes" hint="Their situation, what they asked about, anything to prepare. Saved with the lead; not sent to them." error={err('message')}>
            <textarea
              id="nb-notes"
              rows={4}
              className={TEXTAREA}
              aria-invalid={formState.errors.message ? 'true' : 'false'}
              placeholder="e.g. Runs two branches, uses Google Calendar, misses calls at lunch. Wants a quote for online ordering."
              {...register('message')}
            />
          </Field>
        </Section>

        <Section title="The call">
          <Field label="Their time zone" id="nb-zone" hint="Their emails show the call in this time zone." error={err('timeZone')}>
            <SelectInput id="nb-zone" {...register('timeZone')}>
              <optgroup label="Common">
                {zones.common.map((z) => (
                  <option key={z} value={z}>
                    {zoneLabel(z)}
                    {z === mine ? ' · yours' : ''}
                  </option>
                ))}
              </optgroup>
              <optgroup label="All time zones">
                {zones.rest.map((z) => (
                  <option key={z} value={z}>
                    {zoneLabel(z)}
                  </option>
                ))}
              </optgroup>
            </SelectInput>
          </Field>

          <fieldset className="mb-4">
            <legend className="mb-2 text-sm font-semibold text-midnight-plum">Day and time (shown in your time zone)</legend>
            {slots.status === 'error' && !slots.items.length ? (
              <Notice tone="danger">
                {slots.error || 'Could not load the open times.'}{' '}
                <AdminButton variant="link" onClick={slots.retry}>
                  Try again
                </AdminButton>
              </Notice>
            ) : !slots.items.length ? (
              <Spinner label="Loading open times…" />
            ) : !hasOpenTime ? (
              <p className="text-sm text-muted">No open times right now.</p>
            ) : (
              <SlotCalendar items={slots.items} taken={slots.taken} timeZone={mine} selected={startsAt} radio={register('startsAt')} error={err('startsAt')} errorId="nb-time-error" />
            )}
            {startsAt && (
              <p className="mt-3 rounded-btn bg-lavender-mist px-3.5 py-2.5 text-sm font-semibold text-midnight-plum">
                Chosen: {formatWhen(startsAt, mine)}
                {timeZone && timeZone !== mine && <span className="block font-normal text-muted">For them: {formatWhen(startsAt, timeZone)}</span>}
              </p>
            )}
          </fieldset>
        </Section>
      </form>
    </Dialog>
  );
}

/** A titled part of the form. */
function Section({ title, hint, children }) {
  return (
    <section className="mb-2 border-t border-line pt-4 first-of-type:border-t-0 first-of-type:pt-0">
      <h3 className="mb-0.5 text-xs font-bold tracking-wider text-soft-violet uppercase">{title}</h3>
      {hint ? <p className="mb-3 text-[13px] text-muted">{hint}</p> : <div className="mb-3" />}
      {children}
    </section>
  );
}
