import { yupResolver } from '@hookform/resolvers/yup';
import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { useAddBookingMutation, useAdminAvailabilityQuery, useBookingsQuery, useCancelBookingMutation, useCheckInMutation, useMarkNoShowMutation, useMeQuery, useUndoCheckInMutation, useOverviewQuery, useRescheduleBookingMutation, useServicesQuery } from '../api.js';
import { SlotPicker } from '../components/SlotPicker.jsx';
import { addDays, fmtDate, fmtLongDate, fmtTime, todayIn } from '../lib/format.js';
import { bookingSchema } from '../lib/schemas.js';
import { bookingsBase } from '../lib/surface.js';
import { Badge, Button, Checkbox, Dialog, Empty, Field, Icon, IconButton, ICONS, Input, LinkButton, Loading, Notice, PageHeader, Select, Spinner, Textarea } from '../ui.jsx';
import { can } from './BookingsApp.jsx';
import { CheckInPage } from './CheckInPage.jsx';

const VIEWS = [
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'past', label: 'Past' },
  { key: 'unattended', label: 'Unattended' },
  { key: 'cancelled', label: 'Cancelled' },
];
const LAYOUTS = [
  { key: 'list', label: 'List', icon: ICONS.list },
  { key: 'calendar', label: 'Calendar', icon: ICONS.calendar },
];

/** List, calendar or check-in (the header's Check-in button), kept in the URL (#calendar, #check-in) so a reload or a shared link keeps it. */
function useLayout() {
  const [layout, setLayout] = useState(() => ['calendar', 'check-in'].find((k) => `#${k}` === window.location.hash) ?? 'list');
  const go = (key) => {
    setLayout(key);
    window.history.replaceState(null, '', key === 'list' ? window.location.pathname + window.location.search : `#${key}`);
  };
  return [layout, go];
}

export function BookingsList() {
  const { data: me } = useMeQuery();
  const overview = useOverviewQuery();
  const [layout, setLayout] = useLayout();
  const [view, setView] = useState('upcoming');
  const list = useBookingsQuery({ view }, { skip: layout !== 'list' });
  const [cancelling, setCancelling] = useState(null);
  const [moving, setMoving] = useState(null);
  const [adding, setAdding] = useState(false);
  const welcome = new URLSearchParams(window.location.search).get('welcome');
  const o = overview.data;
  const tz = o?.timeZone;
  const actions = { onCancel: setCancelling, onMove: setMoving };

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
            {can(me, 'bookings.manage') && (
              <Button variant={layout === 'check-in' ? 'primary' : 'secondary'} aria-pressed={layout === 'check-in'} onClick={() => setLayout(layout === 'check-in' ? 'list' : 'check-in')}>
                <Icon d={ICONS.qr} className="size-4" />
                Check-in
              </Button>
            )}
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

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex gap-1 rounded-btn bg-sunken p-1" role="tablist" aria-label="Layout">
          {LAYOUTS.map((l) => (
            <button
              key={l.key}
              type="button"
              role="tab"
              aria-selected={layout === l.key}
              onClick={() => setLayout(l.key)}
              className={`flex cursor-pointer items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium ${layout === l.key ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'}`}
            >
              <Icon d={l.icon} className="size-4" />
              {l.label}
            </button>
          ))}
        </div>
        {layout === 'list' && (
          <div className="flex flex-1 gap-1 rounded-btn bg-sunken p-1" role="tablist" aria-label="Which bookings">
            {VIEWS.map((v) => (
              <button key={v.key} type="button" role="tab" aria-selected={view === v.key} onClick={() => setView(v.key)} className={`flex-1 cursor-pointer rounded-md px-3 py-1.5 text-sm font-medium ${view === v.key ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'}`}>
                {v.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {!o ? (
        <Loading />
      ) : layout === 'check-in' ? (
        <CheckInPage />
      ) : layout === 'calendar' ? (
        <CalendarView me={me} tz={tz} actions={actions} />
      ) : list.isLoading ? (
        <Loading />
      ) : !groups.length ? (
        <Empty title={view === 'upcoming' ? 'No upcoming bookings yet' : view === 'unattended' ? 'No unattended appointments' : `No ${view} bookings`}>
          {view === 'upcoming' && 'Share your booking page link with customers, on your website, Google profile and social media.'}
          {view === 'unattended' && 'Past appointments that nobody checked in show here, so you can reschedule them or mark them as attended.'}
        </Empty>
      ) : (
        <div className="flex flex-col gap-5">
          {groups.map((g) => (
            <section key={g.date}>
              <h2 className="mb-2 text-sm font-semibold text-muted">{fmtLongDate(g.date)}</h2>
              <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
                {g.items.map((b) => (
                  <BookingRow key={b.id} b={b} me={me} tz={tz} {...actions} />
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

/** One booking: time, customer, service, badges and the action buttons. */
function BookingRow({ b, me, tz, onCancel, onMove }) {
  return (
    <li className={`flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 ${b.status === 'cancelled' ? 'bg-sunken/40' : ''}`}>
      <span className={`w-20 shrink-0 font-semibold tabular-nums ${b.status === 'cancelled' ? 'text-faint line-through' : ''}`}>{b.dateOnly ? 'Any time' : fmtTime(b.startsAt, tz)}</span>
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
      {b.status === 'cancelled' && <Badge>Cancelled</Badge>}
      {b.source === 'business' && <Badge>Added by team</Badge>}
      {b.noShowAt && <Badge tone="warn">No-show</Badge>}
      {b.checkedInAt && <Badge tone="ok">Attended</Badge>}
      <BookingActions b={b} me={me} tz={tz} onCancel={onCancel} onMove={onMove} />
    </li>
  );
}

/** Contact the customer; reschedule or cancel upcoming bookings; mark past ones as no-shows. */
function BookingActions({ b, me, tz, onCancel, onMove }) {
  const [markNoShow, noShowState] = useMarkNoShowMutation();
  const [checkIn, checkInState] = useCheckInMutation();
  const [undoCheckIn, undoState] = useUndoCheckInMutation();
  const manage = can(me, 'bookings.manage');
  const confirmed = b.status === 'confirmed';
  const upcoming = confirmed && new Date(b.endsAt) > new Date();
  const past = confirmed && !upcoming;
  const today = b.date === todayIn(tz);
  const attended = !!b.checkedInAt;
  const markAttended = async () => {
    const r = await checkIn({ id: b.id, force: true });
    if (r.error) return toast.error(r.error.message);
    toast.success(`${b.customer.name} checked in`);
  };
  const undoAttended = async () => {
    const r = await undoCheckIn(b.id);
    if (r.error) return toast.error(r.error.message);
    toast.success('Check-in undone');
  };
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-0.5">
      <IconLink href={`mailto:${b.customer.email}`} icon={ICONS.mail} label={`Email ${b.customer.name}`} />
      {b.customer.phone && <IconLink href={`tel:${b.customer.phone.replace(/[^+\d]/g, '')}`} icon={ICONS.phone} label={`Call ${b.customer.name}`} />}
      {manage && upcoming && (
        <>
          <span className="mx-1 h-5 w-px bg-line" aria-hidden="true" />
          {today && !attended && <IconButton icon={ICONS.check} label="Check in (mark as attended)" disabled={checkInState.isLoading} onClick={markAttended} />}
          {attended && <IconButton icon={ICONS.undo} label="Undo check-in" disabled={undoState.isLoading} onClick={undoAttended} />}
          <IconButton icon={ICONS.move} label="Reschedule" onClick={() => onMove(b)} />
          <IconButton icon={ICONS.xCircle} tone="danger" label="Cancel booking" onClick={() => onCancel(b)} />
        </>
      )}
      {manage && past && attended && (
        <>
          <span className="mx-1 h-5 w-px bg-line" aria-hidden="true" />
          <IconButton icon={ICONS.undo} label="Undo check-in" disabled={undoState.isLoading} onClick={undoAttended} />
        </>
      )}
      {manage && past && !attended && (
        <>
          <span className="mx-1 h-5 w-px bg-line" aria-hidden="true" />
          <IconButton icon={ICONS.check} label="Mark as attended" disabled={checkInState.isLoading} onClick={markAttended} />
          <IconButton
            icon={b.noShowAt ? ICONS.undo : ICONS.userX}
            label={b.noShowAt ? 'Undo no-show' : 'Mark as no-show'}
            disabled={noShowState.isLoading}
            onClick={async () => {
              const r = await markNoShow({ id: b.id, noShow: !b.noShowAt });
              if (r.error) toast.error(r.error.message);
              else toast.success(b.noShowAt ? 'No-show removed' : 'Marked as no-show');
            }}
          />
          {/* A missed appointment: move it to a new time (the customer is emailed). */}
          <Button size="sm" variant="secondary" className="ml-1" onClick={() => onMove(b)}>
            <Icon d={ICONS.move} className="size-4" />
            Reschedule
          </Button>
        </>
      )}
    </div>
  );
}

function IconLink({ href, icon, label }) {
  return (
    <a href={href} title={label} aria-label={label} className="inline-flex size-9 items-center justify-center rounded-btn text-muted transition hover:bg-sunken hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">
      <Icon d={icon} className="size-[18px]" />
    </a>
  );
}

// ---- Calendar ----

const pad2 = (n) => String(n).padStart(2, '0');
const shiftMonth = (ym, n) => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}`;
};
const monthTitle = (ym) => new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', month: 'long', year: 'numeric' }).format(new Date(`${ym}-15T12:00:00Z`));
const WEEKDAY_NAMES = Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', weekday: 'short' }).format(new Date(Date.UTC(2023, 0, 1 + i, 12)))); // 2023-01-01 was a Sunday

/** The month's weeks, Sunday first, with the neighbouring months' days to fill them. */
function monthGrid(ym) {
  const [y, m] = ym.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const start = addDays(`${ym}-01`, -first.getUTCDay());
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells = Math.ceil((first.getUTCDay() + count) / 7) * 7;
  return Array.from({ length: cells }, (_, i) => addDays(start, i));
}

function CalendarView({ me, tz, actions }) {
  const today = todayIn(tz);
  const [month, setMonth] = useState(today.slice(0, 7));
  const [day, setDay] = useState(today);
  const [showCancelled, setShowCancelled] = useState(false);
  const cells = useMemo(() => monthGrid(month), [month]);
  const q = useBookingsQuery({ view: 'all', from: cells[0], to: cells.at(-1) });
  const byDay = useMemo(() => {
    const map = new Map();
    for (const b of q.data ?? []) {
      if (b.status === 'cancelled' && !showCancelled) continue;
      if (!map.has(b.date)) map.set(b.date, []);
      map.get(b.date).push(b);
    }
    for (const list of map.values()) list.sort((a, b) => (a.dateOnly === b.dateOnly ? new Date(a.startsAt) - new Date(b.startsAt) : a.dateOnly ? -1 : 1));
    return map;
  }, [q.data, showCancelled]);
  const inMonth = (q.data ?? []).filter((b) => b.date.startsWith(month) && b.status === 'confirmed').length;
  const dayList = byDay.get(day) ?? [];
  const go = (ym) => {
    setMonth(ym);
    setDay(ym === today.slice(0, 7) ? today : `${ym}-01`);
  };

  return (
    <div className="flex flex-col gap-5">
      <section className="overflow-hidden rounded-card border border-line bg-surface">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div className="flex items-center gap-3">
            <h2 key={month} className="text-lg font-semibold text-ink motion-safe:animate-rise">
              {monthTitle(month)}
            </h2>
            {q.isFetching ? <Spinner className="size-4 text-faint" /> : <Badge tone="brand">{inMonth} booked</Badge>}
          </div>
          <div className="flex items-center gap-2">
            <Checkbox label="Show cancelled" checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} />
            <span className="mx-1 h-5 w-px bg-line" aria-hidden="true" />
            <IconButton icon={ICONS.chevronLeft} label="Previous month" onClick={() => go(shiftMonth(month, -1))} />
            <Button size="sm" variant="secondary" disabled={month === today.slice(0, 7) && day === today} onClick={() => go(today.slice(0, 7))}>
              Today
            </Button>
            <IconButton icon={ICONS.chevronRight} label="Next month" onClick={() => go(shiftMonth(month, 1))} />
          </div>
        </header>

        <div className="grid grid-cols-7 border-b border-line bg-sunken/50 text-center text-xs font-semibold tracking-wide text-muted uppercase">
          {WEEKDAY_NAMES.map((n) => (
            <div key={n} className="py-2">
              {n}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7" role="grid" aria-label={`Bookings in ${monthTitle(month)}`}>
          {cells.map((date) => {
            const list = byDay.get(date) ?? [];
            const outside = !date.startsWith(month);
            const sel = date === day;
            const isToday = date === today;
            return (
              <button
                key={date}
                type="button"
                role="gridcell"
                aria-selected={sel}
                aria-label={`${fmtLongDate(date)}: ${list.length ? `${list.length} booking${list.length === 1 ? '' : 's'}` : 'no bookings'}`}
                onClick={() => {
                  setDay(date);
                  if (outside) setMonth(date.slice(0, 7));
                }}
                className={`flex min-h-28 cursor-pointer flex-col gap-1 border-r border-b border-line p-1.5 text-left transition-colors nth-[7n]:border-r-0 mobile:min-h-16 ${
                  sel ? 'bg-brand-soft ring-2 ring-brand ring-inset' : outside ? 'bg-sunken/40 hover:bg-sunken' : 'hover:bg-sunken/60'
                }`}
              >
                <span className="flex items-center justify-between">
                  <span className={`inline-flex size-7 items-center justify-center rounded-full text-[13px] font-semibold tabular-nums ${isToday ? 'bg-brand text-brand-ink' : outside ? 'text-faint' : 'text-ink'}`}>{Number(date.slice(8))}</span>
                  {list.length > 0 && <span className="hidden text-[11px] font-semibold text-faint mobile:inline">{list.length}</span>}
                </span>
                <span className="flex flex-col gap-0.5 mobile:hidden">
                  {list.slice(0, 3).map((b) => (
                    <span
                      key={b.id}
                      className={`truncate rounded-md border-l-[3px] px-1.5 py-0.5 text-xs ${
                        b.status === 'cancelled' ? 'border-line bg-sunken text-faint line-through' : new Date(b.endsAt) < new Date() ? 'border-line-strong bg-sunken text-muted' : 'border-brand bg-surface text-ink shadow-sm'
                      }`}
                    >
                      <span className="font-semibold tabular-nums">{b.dateOnly ? 'Day' : fmtTime(b.startsAt, tz)}</span> {b.customer.name}
                    </span>
                  ))}
                  {list.length > 3 && <span className="px-1.5 text-[11px] font-semibold text-brand">+{list.length - 3} more</span>}
                </span>
                {list.length > 0 && (
                  <span className="hidden flex-wrap gap-0.5 mobile:flex" aria-hidden="true">
                    {list.slice(0, 4).map((b) => (
                      <span key={b.id} className={`size-1.5 rounded-full ${b.status === 'cancelled' ? 'bg-line-strong' : 'bg-brand'}`} />
                    ))}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </section>

      <section aria-live="polite">
        <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-muted">
          {fmtLongDate(day)}
          {day === today && <Badge tone="brand">Today</Badge>}
        </h2>
        {!dayList.length ? (
          <p className="rounded-card border border-dashed border-line-strong bg-surface px-4 py-6 text-center text-sm text-faint">No bookings on this day.</p>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
            {dayList.map((b) => (
              <BookingRow key={b.id} b={b} me={me} tz={tz} {...actions} />
            ))}
          </ul>
        )}
      </section>
    </div>
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
      dirty={!!reason.trim()}
      busy={state.isLoading}
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
      dirty={!!pick}
      busy={state.isLoading}
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
      dirty={!!pick || formState.isDirty}
      busy={formState.isSubmitting}
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

