import { useDispatch, useSelector } from 'react-redux';
import { useLeadDrawer, useLeadEditForm } from '../hooks/admin/useLeadDrawer.js';
import { drawerModeChanged, editCancelled, editStarted, leadClosed, updateLead } from '../store/adminDataSlices.js';
import { channelLabel, originLabel } from '../lib/leadOrigin.js';
import { CancelPanel, ReschedulePanel } from './CallActions.jsx';

// Where-they-came-from details that most leads won't have: left out instead of showing "—".
const HIDE_WHEN_EMPTY = new Set(['Campaign', 'Referring site', 'Landing page', 'Form opened from']);
import { AdminButton, Badge, Checkboxes, Field, formatDateTime, Notice, SelectInput, Spinner, TextInput } from './ui.jsx';

export const statusTone = { new: 'gold', contacted: 'neutral', qualified: 'neutral', won: 'teal', lost: 'neutral', spam: 'danger' };

// The lead drawer. Opened from the Leads table and from calls on the Bookings page; rendered
// once by AdminLayout. Shows the details, the edit form, or the reschedule / cancel panel.
export function LeadDrawer() {
  const dispatch = useDispatch();
  const { selected: lead, selectedLoading, drawerMode } = useSelector((s) => s.adminLeads);
  useLeadDrawer(!!lead);
  if (!lead && !selectedLoading) return null;
  const close = () => dispatch(leadClosed());

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-midnight-plum/40" onClick={close} role="dialog" aria-modal="true" aria-label="Lead details">
      <aside className="flex h-full w-full max-w-lg flex-col bg-cream-dough shadow-2xl" onClick={(e) => e.stopPropagation()}>
        {!lead ? (
          <div className="p-6">
            <Spinner />
          </div>
        ) : (
          <>
            <header className="flex items-start justify-between gap-4 border-b border-line px-6 py-5">
              <div>
                <p className="text-xs font-bold tracking-widest text-soft-violet uppercase">Lead #{lead.id}</p>
                <h2 className="mt-1 text-xl font-bold text-midnight-plum">
                  {lead.firstName} {lead.lastName}
                </h2>
                <div className="mt-2">
                  <Badge tone={statusTone[lead.status]}>{lead.status}</Badge>
                </div>
              </div>
              <div className="flex gap-2">
                {drawerMode === 'view' && (
                  <AdminButton variant="outline" className="min-h-9 px-3.5 py-1.5 text-sm" onClick={() => dispatch(editStarted())}>
                    Edit
                  </AdminButton>
                )}
                <AdminButton variant="link" onClick={close} aria-label="Close">
                  Close
                </AdminButton>
              </div>
            </header>
            <div className="flex-1 overflow-y-auto px-6 py-5">
              {drawerMode === 'edit' ? (
                <LeadEditForm lead={lead} onCancel={() => dispatch(editCancelled())} />
              ) : drawerMode === 'reschedule' && lead.booking ? (
                <ReschedulePanel lead={lead} />
              ) : drawerMode === 'cancel' && lead.booking ? (
                <CancelPanel lead={lead} />
              ) : (
                <LeadDetails lead={lead} />
              )}
            </div>
          </>
        )}
      </aside>
    </div>
  );
}

function LeadDetails({ lead }) {
  const dispatch = useDispatch();
  const options = useSelector((s) => s.adminLeads.options);
  const call = lead.booking
    ? `${formatDateTime(lead.booking.startsAt)} (your time)${lead.booking.timeZone ? `\n${formatDateTime(lead.booking.startsAt, lead.booking.timeZone)} in ${lead.booking.timeZone} (theirs)` : ''}`
    : 'No call booked';
  const upcoming = lead.booking && new Date(lead.booking.startsAt) > new Date();
  const rows = [
    ['Email', lead.email],
    ['Phone', lead.phone],
    ['Business', lead.businessName],
    ['Type', lead.businessType],
    ['Goals', lead.goals.join('\n')],
    ['Features', lead.features.join('\n')],
    ['Message', lead.message],
    ['Call', call],
    ['Booked via', channelLabel(lead.channel)],
    ['Found us through', originLabel(lead)],
    ['Campaign', [lead.utmCampaign, lead.utmSource && `source: ${lead.utmSource}`, lead.utmMedium && `medium: ${lead.utmMedium}`].filter(Boolean).join('\n')],
    ['Referring site', lead.referrerHost],
    ['Landing page', lead.landingPath],
    ['Form opened from', lead.channel === 'web_form' ? lead.source : null],
    ['Received', formatDateTime(lead.createdAt)],
  ];
  return (
    <>
      <label className="mb-1.5 block text-sm font-semibold text-midnight-plum" htmlFor="lead-status">
        Status
      </label>
      <SelectInput id="lead-status" value={lead.status} onChange={(e) => dispatch(updateLead({ id: lead.id, fields: { status: e.target.value } }))} className="mb-6">
        {(options?.statuses ?? [lead.status]).map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </SelectInput>
      {upcoming && (
        <div className="mb-6 rounded-card border border-line bg-lavender-mist/60 p-4">
          <div className="text-xs font-bold tracking-wider text-soft-violet uppercase">Booked call</div>
          <div className="mt-0.5 font-semibold text-midnight-plum">{formatDateTime(lead.booking.startsAt)}</div>
          <div className="mt-3 flex flex-wrap gap-2">
            <AdminButton className="min-h-9 px-3.5 py-1.5 text-sm" onClick={() => dispatch(drawerModeChanged('reschedule'))}>
              Reschedule
            </AdminButton>
            <AdminButton variant="danger" className="min-h-9 px-3.5 py-1.5 text-sm" onClick={() => dispatch(drawerModeChanged('cancel'))}>
              Cancel call
            </AdminButton>
          </div>
          <p className="mt-2 text-xs text-muted">The lead and the other admins are emailed about any change.</p>
        </div>
      )}
      <dl className="divide-y divide-line border-y border-line">
        {rows.filter(([k, v]) => v || !HIDE_WHEN_EMPTY.has(k)).map(([k, v]) => (
          <div key={k} className="grid grid-cols-[96px_1fr] gap-3 py-2.5 text-sm">
            <dt className="font-semibold text-soft-violet">{k}</dt>
            <dd className="break-words whitespace-pre-wrap text-midnight-plum">{v || '—'}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}

function LeadEditForm({ lead, onCancel }) {
  const { form, options, onSubmit, saving, error, wantsOther } = useLeadEditForm(lead);
  const { register, formState } = form;
  const err = (name) => formState.errors[name]?.message;
  if (!options) return <Spinner label="Loading choices…" />;

  return (
    <form onSubmit={onSubmit} noValidate>
      {error && <Notice tone="danger">{error}</Notice>}
      <div className="grid grid-cols-2 gap-x-4 mobile:grid-cols-1">
        <Field label="First name" id="e-first" error={err('firstName')}>
          <TextInput id="e-first" error={err('firstName')} {...register('firstName')} />
        </Field>
        <Field label="Last name" id="e-last" error={err('lastName')}>
          <TextInput id="e-last" error={err('lastName')} {...register('lastName')} />
        </Field>
      </div>
      <Field label="Email" id="e-email" error={err('email')}>
        <TextInput id="e-email" type="email" error={err('email')} {...register('email')} />
      </Field>
      <Field label="Phone" id="e-phone" error={err('phone')} hint="Optional">
        <TextInput id="e-phone" type="tel" error={err('phone')} {...register('phone')} />
      </Field>
      <div className="grid grid-cols-2 gap-x-4 mobile:grid-cols-1">
        <Field label="Business name" id="e-bname" error={err('businessName')} hint="Optional">
          <TextInput id="e-bname" error={err('businessName')} {...register('businessName')} />
        </Field>
        <Field label="Type of business" id="e-btype" error={err('businessType')}>
          <TextInput id="e-btype" error={err('businessType')} {...register('businessType')} />
        </Field>
      </div>
      <Field label="Status" id="e-status" error={err('status')}>
        <SelectInput id="e-status" {...register('status')}>
          {options.statuses.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </SelectInput>
      </Field>

      <Checkboxes label="Goals" name="goals" items={options.goals} register={register} error={err('goals')} />
      {wantsOther && (
        <Field label='Describe the "Other" goal' id="e-gother" error={err('goalsOther')}>
          <TextInput id="e-gother" error={err('goalsOther')} {...register('goalsOther')} />
        </Field>
      )}
      <Checkboxes label="Features" name="features" items={options.features} register={register} error={err('features')} />

      <Field label="Message / notes" id="e-msg" error={err('message')}>
        <textarea
          id="e-msg"
          rows={4}
          className="block w-full rounded-btn border-2 border-line bg-cream-dough px-3.5 py-2.5 text-[15px] text-midnight-plum outline-none focus:border-soft-violet"
          {...register('message')}
        />
      </Field>

      <p className="mb-4 text-xs text-muted">The booked call is changed from the Bookings page.</p>
      <div className="sticky bottom-0 -mx-6 flex gap-3 border-t border-line bg-cream-dough px-6 py-4">
        <AdminButton type="submit" busy={saving}>
          Save changes
        </AdminButton>
        <AdminButton variant="outline" onClick={onCancel} disabled={saving}>
          Cancel
        </AdminButton>
      </div>
    </form>
  );
}

