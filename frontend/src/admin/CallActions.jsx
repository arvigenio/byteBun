import { useCancelCall, useReschedule } from '../hooks/admin/useCallActions.js';
import { AdminButton, Field, formatDateTime, Notice, Spinner } from './ui.jsx';

const TEXTAREA =
  'block w-full rounded-btn border-2 border-line bg-cream-dough px-3.5 py-2.5 text-[15px] text-midnight-plum outline-none focus:border-soft-violet aria-[invalid=true]:border-danger';

function CurrentCall({ lead }) {
  return (
    <div className="mb-5 rounded-card border border-line bg-lavender-mist/60 px-4 py-3 text-sm">
      <div className="text-xs font-bold tracking-wider text-soft-violet uppercase">Current time</div>
      <div className="mt-0.5 font-semibold text-midnight-plum">{formatDateTime(lead.booking.startsAt)}</div>
      {lead.booking.timeZone && (
        <div className="text-muted">
          Their time: {formatDateTime(lead.booking.startsAt, lead.booking.timeZone)} ({lead.booking.timeZone})
        </div>
      )}
    </div>
  );
}

function NoteField({ register, error, hint }) {
  return (
    <Field label="Note to the lead (optional)" id="call-note" hint={hint} error={error}>
      <textarea id="call-note" rows={3} className={TEXTAREA} aria-invalid={error ? 'true' : 'false'} placeholder="e.g. Sorry, something came up on our side." {...register('note')} />
    </Field>
  );
}

/** Move the lead's call to another open time. */
export function ReschedulePanel({ lead }) {
  const { form, days, selected, slotsStatus, slotsError, retrySlots, onSubmit, error, back } = useReschedule(lead);
  const { register, formState } = form;
  return (
    <form onSubmit={onSubmit} noValidate>
      <h3 className="mb-1 text-lg font-bold text-midnight-plum">Reschedule the call</h3>
      <p className="mb-4 text-sm text-muted">Pick a new open time (shown in your time zone). The lead gets an email with the new time and an updated calendar invite; the other admins are told too.</p>
      <CurrentCall lead={lead} />
      {error && <Notice tone="danger">{error}</Notice>}

      <fieldset className="mb-4">
        <legend className="mb-2 text-sm font-semibold text-midnight-plum">New time</legend>
        {slotsStatus === 'loading' && !days.length ? (
          <Spinner label="Loading open times…" />
        ) : slotsStatus === 'error' ? (
          <Notice tone="danger">
            {slotsError || 'Could not load the open times.'}{' '}
            <AdminButton variant="link" onClick={retrySlots}>
              Try again
            </AdminButton>
          </Notice>
        ) : !days.length ? (
          <p className="text-sm text-muted">No open times right now.</p>
        ) : (
          <div className="max-h-72 space-y-3 overflow-y-auto rounded-card border border-line p-3">
            {days.map(([day, times]) => (
              <div key={day}>
                <div className="mb-1.5 text-xs font-bold tracking-wider text-soft-violet uppercase">{day}</div>
                <div className="flex flex-wrap gap-2">
                  {times.map((s) => (
                    <label
                      key={s.iso}
                      className={`cursor-pointer rounded-btn border-2 px-3 py-1.5 text-sm font-semibold transition-colors ${
                        s.current
                          ? 'cursor-not-allowed border-line bg-lavender-mist text-muted line-through'
                          : selected === s.iso
                            ? 'border-byte-purple bg-byte-purple text-cream-dough'
                            : 'border-line bg-cream-dough text-midnight-plum hover:border-soft-violet'
                      }`}
                      title={s.current ? 'The current time' : undefined}
                    >
                      <input type="radio" value={s.iso} disabled={s.current} className="sr-only" {...register('startsAt')} />
                      {s.time}
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        {formState.errors.startsAt && <p className="mt-1.5 text-[13px] font-medium text-danger">{formState.errors.startsAt.message}</p>}
      </fieldset>

      <NoteField register={register} error={formState.errors.note?.message} hint="Shown to the lead in the email, e.g. why the time changed." />
      <div className="flex flex-wrap gap-3">
        <AdminButton type="submit" busy={formState.isSubmitting}>
          Move the call
        </AdminButton>
        <AdminButton variant="outline" onClick={back} disabled={formState.isSubmitting}>
          Keep the current time
        </AdminButton>
      </div>
    </form>
  );
}

/** Cancel the lead's call (the lead stays). */
export function CancelPanel({ lead }) {
  const { form, onSubmit, error, back } = useCancelCall(lead);
  const { register, formState } = form;
  return (
    <form onSubmit={onSubmit} noValidate>
      <h3 className="mb-1 text-lg font-bold text-midnight-plum">Cancel the call?</h3>
      <p className="mb-4 text-sm text-muted">
        The slot opens again and the lead stays in the list. {lead.firstName} gets an apology email with a button to pick a new time, and the other admins are told.
      </p>
      <CurrentCall lead={lead} />
      {error && <Notice tone="danger">{error}</Notice>}
      <NoteField register={register} error={formState.errors.note?.message} hint="Shown to the lead in the email." />
      <div className="flex flex-wrap gap-3">
        <AdminButton type="submit" variant="danger" busy={formState.isSubmitting}>
          Yes, cancel the call
        </AdminButton>
        <AdminButton variant="outline" onClick={back} disabled={formState.isSubmitting}>
          No, keep it
        </AdminButton>
      </div>
    </form>
  );
}
