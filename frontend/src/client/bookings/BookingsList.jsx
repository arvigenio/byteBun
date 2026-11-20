import { yupResolver } from '@hookform/resolvers/yup';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { useAddBookingMutation, useAdminAvailabilityQuery, useBookingsQuery, useCancelBookingMutation, useMarkNoShowMutation, useMeQuery, useOverviewQuery, useRescheduleBookingMutation, useServicesQuery } from '../api.js';
import { SlotPicker } from '../components/SlotPicker.jsx';
import { fmtDate, fmtLongDate, fmtTime, todayIn } from '../lib/format.js';
import { bookingSchema } from '../lib/schemas.js';
import { bookingsBase } from '../lib/surface.js';
import { Badge, Button, Checkbox, Dialog, Empty, Field, Input, LinkButton, Loading, Notice, PageHeader, Select, Textarea } from '../ui.jsx';
import { can } from './BookingsApp.jsx';

const VIEWS = [
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'past', label: 'Past' },
  { key: 'cancelled', label: 'Cancelled' },
];

export function BookingsList() {
  const { data: me } = useMeQuery();
  const overview = useOverviewQuery();
  const [view, setView] = useState('upcoming');
  const list = useBookingsQuery({ view });
  const [cancelling, setCancelling] = useState(null);
  const [moving, setMoving] = useState(null);
  const [adding, setAdding] = useState(false);
  const [markNoShow] = useMarkNoShowMutation();
  const welcome = new URLSearchParams(window.location.search).get('welcome');
  const o = overview.data;
  const tz = o?.timeZone;

  // Group by day.
  const groups = [];
  for (const b of list.data ?? []) {
    const last = groups.at(-1);
    if (last?.date === b.date) last.items.push(b);
    else groups.push({ date: b.date, items: [b] });
  }

  return (
    <>
      <PageHeader
        title="Bookings"
        description={o ? `${o.upcoming} upcoming · ${o.today} today · times in ${tz.replace(/_/g, ' ')}` : ' '}
        actions={
          <>
            {can(me, 'bookings.settings') && (
              <a href="/api/client/bookings/export.csv" className="inline-flex min-h-10 items-center rounded-btn border border-line-strong bg-surface px-4 text-sm font-semibold hover:bg-sunken">
                Export CSV
              </a>
            )}
            {can(me, 'bookings.manage') && o?.services > 0 && <Button onClick={() => setAdding(true)}>Add booking</Button>}
          </>
        }
      />
      {welcome && o && (
        <Notice tone="info" title="Your booking page is live!" className="mb-5">
          Share <a className="font-medium underline" href={o.publicUrl} target="_blank" rel="noreferrer">{o.publicUrl.replace(/^https?:\/\//, '')}</a>. Next: add your services and check your hours.
        </Notice>
      )}
      {o?.usage.limit !== null && o && <UsageBar used={o.usage.used} limit={o.usage.limit} />}
      {o?.retentionDays && (
        <p className="-mt-2 mb-5 text-[13px] text-faint">
          Free plan: bookings are deleted {o.retentionDays} days after the appointment date. Owners get an email a week before, with a CSV download. Upgrading keeps everything.
        </p>
      )}
      {o && o.services === 0 && (
        <Notice tone="warn" title="Add a service to start taking bookings" className="mb-5">
          Customers pick a service first.{' '}
          <a href={`${bookingsBase}/services`} className="font-medium underline">
            Add your first service
          </a>
        </Notice>
      )}

      <div className="mb-4 flex gap-1 rounded-btn bg-sunken p-1" role="tablist">
        {VIEWS.map((v) => (
          <button key={v.key} type="button" role="tab" aria-selected={view === v.key} onClick={() => setView(v.key)} className={`flex-1 cursor-pointer rounded-md px-3 py-1.5 text-sm font-medium ${view === v.key ? 'bg-surface text-ink shadow-sm' : 'text-muted'}`}>
            {v.label}
          </button>
        ))}
      </div>

      {list.isLoading || !o ? (
        <Loading />
      ) : !groups.length ? (
        <Empty title={view === 'upcoming' ? 'No upcoming bookings yet' : `No ${view} bookings`}>{view === 'upcoming' && 'Share your booking page link with customers, on your website, Google profile and social media.'}</Empty>
      ) : (
        <div className="flex flex-col gap-5">
          {groups.map((g) => (
            <section key={g.date}>
              <h2 className="mb-2 text-sm font-semibold text-muted">{fmtLongDate(g.date)}</h2>
              <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
                {g.items.map((b) => (
                  <li key={b.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                    <span className="w-20 shrink-0 font-semibold tabular-nums">{b.dateOnly ? 'Any time' : fmtTime(b.startsAt, tz)}</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">
                        {b.customer.name} <span className="font-normal text-muted">· {b.service.name}</span>
                      </p>
                      <p className="truncate text-sm text-faint">
                        {b.customer.email}
                        {b.customer.phone && ` · ${b.customer.phone}`}
                        {b.note && ` · “${b.note}”`}
                      </p>
                      {b.status === 'cancelled' && (
                        <p className="text-xs text-faint">
                          Cancelled by {b.cancelledBy === 'customer' ? 'the customer' : 'your team'}
                          {b.cancelReason ? `: ${b.cancelReason}` : ''}
                        </p>
                      )}
                    </div>
                    {b.source === 'business' && <Badge>Added by team</Badge>}
                    {b.noShowAt && <Badge tone="warn">No-show</Badge>}
                    {view === 'past' && can(me, 'bookings.manage') && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={async () => {
                          const r = await markNoShow({ id: b.id, noShow: !b.noShowAt });
                          if (r.error) toast.error(r.error.message);
                          else toast.success(b.noShowAt ? 'No-show removed' : 'Marked as no-show');
                        }}
                      >
                        {b.noShowAt ? 'Undo no-show' : 'Mark no-show'}
                      </Button>
                    )}
                    {view === 'upcoming' && can(me, 'bookings.manage') && (
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setMoving(b)}>
                          Reschedule
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setCancelling(b)}>
                          Cancel
                        </Button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
      <CancelDialog booking={cancelling} tz={tz} onClose={() => setCancelling(null)} />
      {moving && <RescheduleDialog booking={moving} tz={tz} onClose={() => setMoving(null)} />}
      {adding && <AddBookingDialog tz={tz} onClose={() => setAdding(false)} />}
    </>
  );
}

function UsageBar({ used, limit }) {
  const pct = Math.min(100, Math.round((used / limit) * 100));
  const tone = used >= limit ? 'danger' : pct >= 80 ? 'warn' : 'info';
  return (
    <Notice tone={tone} className="mb-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>
          <strong>
            {used} of {limit}
          </strong>{' '}
          free bookings used this month{used >= limit ? ': your booking page is paused until the 1st.' : ' (cancelled bookings count too).'}
        </span>
        <LinkButton href={`${bookingsBase}/plan`} size="sm">
          Upgrade
        </LinkButton>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/60">
        <div className="h-full rounded-full bg-current" style={{ width: `${pct}%` }} />
      </div>
    </Notice>
  );
}

function CancelDialog({ booking, tz, onClose }) {
  const [cancel, state] = useCancelBookingMutation();
  const [reason, setReason] = useState('');
  const [notify, setNotify] = useState(true);
  return (
    <Dialog
      open={!!booking}
      onClose={onClose}
      title="Cancel booking"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Keep it
          </Button>
          <Button
            variant="danger"
            loading={state.isLoading}
            onClick={async () => {
              const r = await cancel({ id: booking.id, reason: reason || null, notify });
              if (r.error) return toast.error(r.error.message);
              toast.success('Booking cancelled');
              setReason('');
              onClose();
            }}
          >
            Cancel booking
          </Button>
        </>
      }
    >
      {booking && (
        <div className="flex flex-col gap-4">
          <p className="text-sm">
            <strong>{booking.customer.name}</strong> · {booking.service.name} · {fmtDate(booking.date)}
            {!booking.dateOnly && `, ${fmtTime(booking.startsAt, tz)}`}
          </p>
          <Field label="Reason (shown to the customer)">{(a) => <Textarea {...a} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />}</Field>
          <Checkbox label="Email the customer" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
        </div>
      )}
    </Dialog>
  );
}

function RescheduleDialog({ booking, tz, onClose }) {
  const today = todayIn(tz);
  const [from, setFrom] = useState(today);
  const [pick, setPick] = useState(null);
  const q = useAdminAvailabilityQuery({ serviceId: booking.service.id, from, exclude: booking.id });
  const [move, state] = useRescheduleBookingMutation();
  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={`Reschedule ${booking.customer.name}`}
      footer={
        <Button
          disabled={!pick}
          loading={state.isLoading}
          onClick={async () => {
            const r = await move({ id: booking.id, ...(pick.startsAt ? { startsAt: pick.startsAt } : { date: pick.date }) });
            if (r.error) return toast.error(r.error.message);
            toast.success('Booking moved. The customer was emailed.');
            onClose();
          }}
        >
          Move booking
        </Button>
      }
    >
      <SlotPicker data={q.data} loading={q.isFetching} from={from} onFromChange={setFrom} today={today} value={pick} onChange={setPick} />
    </Dialog>
  );
}

function AddBookingDialog({ tz, onClose }) {
  const services = useServicesQuery();
  const active = (services.data?.services ?? []).filter((s) => s.active);
  const [serviceId, setServiceId] = useState(null);
  const sid = serviceId ?? active[0]?.id;
  const today = todayIn(tz);
  const [from, setFrom] = useState(today);
  const [pick, setPick] = useState(null);
  const q = useAdminAvailabilityQuery({ serviceId: sid, from }, { skip: !sid });
  const [add] = useAddBookingMutation();
  const { register, handleSubmit, setError, formState } = useForm({ resolver: yupResolver(bookingSchema) });
  const submit = handleSubmit(async (v) => {
    const r = await add({ serviceId: sid, ...(pick.startsAt ? { startsAt: pick.startsAt } : { date: pick.date }), ...v });
    if (r.error) {
      for (const [k, m] of Object.entries(r.error.fields ?? {})) setError(k, { message: m });
      return toast.error(r.error.message);
    }
    toast.success('Booking added. The customer gets a confirmation email.');
    onClose();
  });
  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title="Add a booking"
      footer={
        <Button onClick={submit} disabled={!pick} loading={formState.isSubmitting}>
          Add booking
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Service">
          {(a) => (
            <Select {...a} value={sid ?? ''} onChange={(e) => (setServiceId(Number(e.target.value)), setPick(null))}>
              {active.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <SlotPicker data={q.data} loading={q.isFetching} from={from} onFromChange={setFrom} today={today} value={pick} onChange={setPick} />
        <div className="grid gap-3 desktop:grid-cols-2">
          <Field label="Customer name" error={formState.errors.name?.message}>
            {(a) => <Input {...a} {...register('name')} />}
          </Field>
          <Field label="Email" error={formState.errors.email?.message}>
            {(a) => <Input {...a} type="email" {...register('email')} />}
          </Field>
          <Field label="Phone" error={formState.errors.phone?.message}>
            {(a) => <Input {...a} type="tel" {...register('phone')} />}
          </Field>
          <Field label="Note" error={formState.errors.note?.message}>
            {(a) => <Input {...a} {...register('note')} />}
          </Field>
        </div>
      </div>
    </Dialog>
  );
}

