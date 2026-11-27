import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useDispatch } from 'react-redux';
import { toast } from 'sonner';
import { navigate } from '../../lib/router.js';
import {
  api,
  useCheckVoucherMutation,
  useClaimHereMutation,
  useUnclaimHereMutation,
  useAddClaimableMutation,
  useCreateEventScannerMutation,
  useDeleteClaimableMutation,
  useRenameClaimableMutation,
  useDeleteEventScannerMutation,
  useEventScannersQuery,
  useNewScannerCodeMutation,
  useRevokeScannerCodeMutation,
  useCreateEventMutation,
  useDeleteEventCodeMutation,
  useDeleteEventMutation,
  useRequestEventDeleteMutation,
  useEventCheckInMutation,
  useEventQuery,
  useEventsQuery,
  useIssueEventCodeMutation,
  useMeQuery,
  useOverviewQuery,
  useRevokeEventTicketMutation,
  useUndoEventCheckInMutation,
  useUpdateEventMutation,
  useAddPaymentChannelMutation,
  useUpdatePaymentChannelMutation,
  useDeletePaymentChannelMutation,
} from '../api.js';
import { FilePicker } from '../components/Payments.jsx';
import { fmtMoney, MoneyField } from '../components/Money.jsx';
import { ChannelDrafts, draftForm } from './ChannelDrafts.jsx';
import { EventStatuses } from './EventStatuses.jsx';
import { EventCollections, ManualRegisterButton } from './EventCollections.jsx';
import { ActivityDialog } from './TicketActivity.jsx';
import { RowMenu } from '../components/RowMenu.jsx';
import { PromoCodesCard } from './PromoCodes.jsx';
import { EventAffiliatesTab } from './EventAffiliates.jsx';
import { EventTeamTab } from './EventTeam.jsx';
import { PriorityTabs } from '../components/PriorityTabs.jsx';
import { EventMediaCard } from './EventMedia.jsx';
import { refundableLeft, RefundRequestsTab, SendRefundRequestDialog } from './RefundRequests.jsx';

/** "Nov 26, 2:14 PM", in the event's time zone. */
const regWhen = (iso, tz) => new Intl.DateTimeFormat(undefined, { timeZone: tz, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
import { PaymentsSummary, usePaymentReview } from './PaymentReview.jsx';
import { ShowCodesButton, TicketCodesDialog } from './TicketCodes.jsx';
import { BulkHeader, bulkBlocks } from './BulkGroups.jsx';
import { compressImage, fileProblem, fmtBytes, IMAGE_ACCEPT, MAX_UPLOAD_MB } from '../lib/upload.js';
import { DatePicker, TimePicker } from '../components/Pickers.jsx';
import { RichText } from '../components/RichText.jsx';
import { detectTimeZone, fmtLongDate, fmtTime, minuteLabel, slugify, timeZones, todayIn } from '../lib/format.js';
import { bookingsBase } from '../lib/surface.js';
import { Badge, Button, Card, Checkbox, Dialog, Empty, Field, Icon, IconButton, ICONS, Input, LinkButton, Loading, Notice, PageHeader, Select, Spinner, Textarea, useConfirm, usePrompt } from '../ui.jsx';
import { can } from './BookingsApp.jsx';
import { ResultCard, Scanner } from './CheckInPage.jsx';

// Events: one-time seminars and webinars (backend: booking/events.ts).
//   /events            the list
//   /events/new        the step-by-step creator
//   /events/:id        attendees (codes for paid events, revoke for free ones) and details
//   /events/:id/scan   this event's full-screen check-in scanner (its codes only)
//
// Limits (me.business.limits): events.participants (every plan: 50 included; more needs a voucher
// from Byte Bun, bought per event: 51-300 $10, up to 500 $20, more: custom) and events.per_day (free: 1).

// The map (Leaflet) loads only when an event's location is being set.
const LocationPicker = lazy(() => import('../components/LocationPicker.jsx'));
function Location({ f, set, error }) {
  return (
    <Suspense fallback={<div className="grid h-80 place-items-center rounded-xl border border-line"><Spinner /></div>}>
      <div className="flex flex-col gap-4">
        <LocationPicker address={f.address} lat={f.latitude} lng={f.longitude} timeZone={f.timeZone} error={error} onChange={({ address, latitude, longitude }) => set({ address, latitude, longitude })} />
        <Field label="Complete address (optional)" hint="Floor, unit, building or landmark, or the full address if the map can’t find the place. Shown with the address.">
          {(a) => <Textarea {...a} rows={2} maxLength={300} value={f.addressDetails ?? ''} onChange={(e) => set({ addressDetails: e.target.value })} placeholder="e.g. 2nd floor, Unit 5, beside the main gate" />}
        </Field>
      </div>
    </Suspense>
  );
}

export const EVENT_SIZES = [
  { upTo: 300, price: '$10' },
  { upTo: 500, price: '$20' },
];
/** Events without a voucher are deleted this long after they end (backend: event-retention.ts). */
const RETENTION_MONTHS = 3;
const plusMonths = (date, months) => {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
};
const sizePrice = (n) => EVENT_SIZES.find((s) => n <= s.upTo)?.price ?? 'Custom pricing';
const range = (a, b) => `${minuteLabel(a)} – ${minuteLabel(b % 1440 === 0 && b ? 1439 : b)}`;
const zoneLabel = (z) => (z ? z.replace(/_/g, ' ').replace(/^.*\//, '') : '');
const when = (e) => `${fmtLongDate(e.date)} · ${range(e.startMinute, e.endMinute)}${e.timeZone ? ` (${zoneLabel(e.timeZone)})` : ''}`;

/** The event's time zone: every zone the browser knows, grouped by region. */
function TimeZoneField({ value, onChange, hint }) {
  const zones = useMemo(() => {
    const all = timeZones();
    return all.includes(value) ? all : [value, ...all];
  }, [value]);
  const groups = useMemo(() => {
    const out = {};
    for (const z of zones) (out[z.includes('/') ? z.split('/')[0] : 'Other'] ??= []).push(z);
    return Object.entries(out);
  }, [zones]);
  const offset = (z) => {
    try {
      return new Intl.DateTimeFormat('en-US', { timeZone: z, timeZoneName: 'shortOffset' }).formatToParts(new Date()).find((p) => p.type === 'timeZoneName')?.value ?? '';
    } catch {
      return '';
    }
  };
  return (
    <Field label="Time zone" hint={hint}>
      {(a) => (
        <Select {...a} value={value} onChange={(x) => onChange(x.target.value)}>
          {groups.map(([region, list]) => (
            <optgroup key={region} label={region}>
              {list.map((z) => (
                <option key={z} value={z}>
                  {z.replace(/_/g, ' ').replace(`${region}/`, '')} ({offset(z)})
                </option>
              ))}
            </optgroup>
          ))}
        </Select>
      )}
    </Field>
  );
}
const cx = (...c) => c.filter(Boolean).join(' ');
/** Paid registrations not verified yet (removable as a whole booking). */
const UNPAID = ['reserved', 'waitlist', 'review', 'rejected'];
/** The currency a registration paid in. */
const x0cur = (e, t) => t.paidCurrency ?? e.currency ?? 'PHP';

function useEventLink(e) {
  const { data: me } = useMeQuery();
  const slug = me?.business?.publicUrl?.split('/').pop();
  return slug && e ? `${new URL(me.business.publicUrl).origin}/${slug}/e/${e.slug}` : null;
}

function copy(text, what = 'Link') {
  navigator.clipboard?.writeText(text).then(
    () => toast.success(`${what} copied`),
    () => toast.error('Could not copy. Select it and copy it yourself.'),
  );
}

function KindBadge({ e }) {
  return e.kind === 'paid' ? <Badge tone="warn">Paid{e.priceLabel ? ` · ${e.priceLabel}` : ''}</Badge> : <Badge tone="ok">Free</Badge>;
}

// ---- List ----

export function EventsPage() {
  const { data: me } = useMeQuery();
  const q = useEventsQuery();
  const tz = useOverviewQuery().data?.timeZone;
  const [tab, setTab] = useState('upcoming');
  const now = Date.now();
  const list = (q.data ?? []).filter((e) => (tab === 'upcoming' ? new Date(e.endsAt) > now : new Date(e.endsAt) <= now));
  if (tab === 'upcoming') list.sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
  const edit = can(me, 'events.manage');

  return (
    <>
      <PageHeader title="Events" description="One-time seminars, webinars and classes, with their own page, registrations and check-in." actions={edit && <LinkButton href={`${bookingsBase}/events/new`} variant="primary">New event</LinkButton>} />
      <div className="mb-4 flex gap-1 rounded-btn bg-sunken p-1" role="tablist">
        {[
          ['upcoming', 'Upcoming'],
          ['past', 'Past'],
        ].map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`flex-1 cursor-pointer rounded-md px-3 py-1.5 text-sm font-medium ${tab === k ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'}`}>
            {l}
          </button>
        ))}
      </div>
      {q.isLoading || !tz ? (
        <Loading />
      ) : !list.length ? (
        <Empty title={tab === 'upcoming' ? 'No upcoming events' : 'No past events'} action={tab === 'upcoming' && edit && <LinkButton href={`${bookingsBase}/events/new`} variant="primary">Create your first event</LinkButton>}>
          {tab === 'upcoming' && 'Run a seminar, a webinar or a class: people register on its page and get a QR code to check in.'}
        </Empty>
      ) : (
        <div className="grid gap-3 desktop:grid-cols-2">
          {list.map((e) => {
            const places = e.counts.confirmed + e.counts.pending + (e.counts.review ?? 0) + (e.counts.reserved ?? 0);
            return (
              <a key={e.id} href={`${bookingsBase}/events/${e.id}`} className="group flex gap-4 rounded-card border border-line bg-surface p-4 transition hover:border-brand hover:shadow-md">
                <DateTile date={e.date} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <KindBadge e={e} />
                    <Badge>{e.format === 'online' ? 'Online' : 'Onsite'}</Badge>
                    {!e.published && <Badge tone="danger">Not published</Badge>}
                    {e.counts.review > 0 && <Badge tone="warn">{e.counts.review} for verification</Badge>}
                    {e.counts.waitlist > 0 && <Badge>{e.counts.waitlist} on the waitlist</Badge>}
                  </div>
                  <p className="mt-1.5 truncate font-semibold text-ink group-hover:text-brand">{e.title}</p>
                  <p className="text-sm text-muted">{range(e.startMinute, e.endMinute)}</p>
                  <div className="mt-2 flex items-center gap-2 text-xs text-muted">
                    <span className="h-1.5 w-24 overflow-hidden rounded-full bg-sunken">
                      <span className="block h-full rounded-full bg-brand" style={{ width: e.capacity ? `${Math.min(100, (places / e.capacity) * 100)}%` : '0%' }} />
                    </span>
                    {places}
                    {e.capacity ? ` / ${e.capacity}` : ''} registered
                    {e.counts.checkedIn > 0 && ` · ${e.counts.checkedIn} checked in`}
                  </div>
                </div>
              </a>
            );
          })}
        </div>
      )}
    </>
  );
}

function DateTile({ date, big = false }) {
  const d = new Date(`${date}T12:00:00Z`);
  const f = (o) => new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', ...o }).format(d);
  return (
    <div className={cx('shrink-0 overflow-hidden rounded-xl border border-line bg-surface text-center shadow-sm', big ? 'w-20' : 'w-14')} aria-hidden="true">
      <div className="bg-brand py-0.5 text-[10px] font-bold tracking-[0.12em] text-brand-ink uppercase">{f({ month: 'short' })}</div>
      <div className={cx('leading-none font-bold text-ink tabular-nums', big ? 'py-2 text-3xl' : 'py-1.5 text-2xl')}>{d.getUTCDate()}</div>
      <div className="pb-1 text-[10px] font-semibold text-muted uppercase">{f({ weekday: 'short' })}</div>
    </div>
  );
}

// ---- Shared form parts ----

function Choice({ value, options, onChange, label }) {
  return (
    <div className="grid gap-2 desktop:grid-cols-2" role="radiogroup" aria-label={label}>
      {options.map(([v, title, hint, icon]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={cx('flex cursor-pointer gap-3 rounded-xl border p-4 text-left transition', value === v ? 'border-brand bg-brand-soft ring-1 ring-brand' : 'border-line bg-surface hover:border-brand')}
        >
          {icon && (
            <span className={cx('grid size-10 shrink-0 place-items-center rounded-xl', value === v ? 'bg-brand text-brand-ink' : 'bg-sunken text-muted')}>
              <Icon d={icon} className="size-5" />
            </span>
          )}
          <span>
            <span className="block font-semibold text-ink">{title}</span>
            <span className="block text-[13px] text-muted">{hint}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

/**
 * Participants, within the plan's limit, or with a voucher from Byte Bun for a bigger event. The
 * voucher fixes the most this event may have (up and down within it; more needs a new voucher).
 */
function Participants({ value, onChange, planCap, granted, voucher, onVoucher }) {
  const [checkVoucher, state] = useCheckVoucherMutation();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const n = Number(value) || 0;
  const cap = planCap === null || planCap === undefined ? null : Math.max(planCap, granted ?? 0, voucher?.participants ?? 0);
  const needsVoucher = cap !== null && n > cap;
  const apply = async () => {
    setError('');
    const r = await checkVoucher(code);
    if (r.error) return setError(r.error.fields?.code || r.error.fields?.voucherCode || r.error.message);
    onVoucher({ code, participants: r.data.participants, priceLabel: r.data.priceLabel });
    if (n > r.data.participants) onChange(String(r.data.participants));
    toast.success(`Voucher applied: up to ${r.data.participants} participants`);
  };
  return (
    <div className="flex flex-col gap-4">
      <Field label="How many participants?" hint={cap === null ? 'Leave it empty for no limit.' : `Up to ${cap} ${voucher || (granted ?? 0) > (planCap ?? 0) ? 'with your voucher' : 'included. More needs a voucher'}.`}>
        {(a) => (
          <div className="flex items-center gap-2">
            <Button variant="secondary" aria-label="Fewer" onClick={() => onChange(String(Math.max(1, n - 10)))}>
              −10
            </Button>
            <Input {...a} type="number" min={1} inputMode="numeric" className="w-32 text-center text-lg font-semibold" value={value} onChange={(e) => onChange(e.target.value)} placeholder={cap === null ? 'No limit' : String(cap)} />
            <Button variant="secondary" aria-label="More" onClick={() => onChange(String(n + 10))}>
              +10
            </Button>
          </div>
        )}
      </Field>
      {voucher && (
        <Notice tone="ok" title="Voucher applied">
          This event can have up to {voucher.participants} participants{voucher.priceLabel ? ` (${voucher.priceLabel})` : ''}. You can go up or down within that; more needs a new voucher.
        </Notice>
      )}
      {needsVoucher && (
        <div className="rounded-xl border-2 border-dashed border-brand/40 bg-brand-soft/40 p-4">
          <p className="font-semibold text-ink">{voucher ? `Your voucher covers up to ${cap}` : `More than ${cap} participants needs a voucher`}</p>
          <p className="mt-1 text-sm text-muted">Bigger events are bought per event. Pay Byte Bun, and you’ll get an 8-character voucher code to enter here.</p>
          <table className="mt-3 w-full max-w-sm text-sm">
            <tbody className="divide-y divide-line">
              {[
                [`Up to ${planCap}`, 'Included'],
                ['51 – 300', '$10'],
                ['301 – 500', '$20'],
                ['More than 500', 'Custom pricing'],
              ].map(([r, p]) => (
                <tr key={r} className={sizePrice(n) === p ? 'font-semibold text-brand' : ''}>
                  <td className="py-1.5">{r} participants</td>
                  <td className="py-1.5 text-right">{p}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-4 flex flex-wrap items-end gap-2">
            <Field label="Voucher code" error={error} className="w-48">
              {(a) => <Input {...a} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="ABCD-EFGH" className="font-mono tracking-widest" autoComplete="off" />}
            </Field>
            <Button onClick={apply} loading={state.isLoading} disabled={code.replace(/[^A-Z0-9]/gi, '').length !== 8}>
              Apply voucher
            </Button>
          </div>
          <p className="mt-3 text-[13px] text-muted">
            For {n} participants: <strong>{sizePrice(n)}</strong>. Contact Byte Bun to pay and get your voucher.
          </p>
        </div>
      )}
    </div>
  );
}

const minutesOk = (s, e) => e > s;

// ---- The step-by-step creator ----

// The creator's steps; Payment only for paid events.
const STEP_LABELS = { name: 'Name', description: 'Description', when: 'Date & time', where: 'Location', payment: 'Payment', participants: 'Participants', review: 'Review' };
const stepsFor = (kind) => ['name', 'description', 'when', 'where', ...(kind === 'paid' ? ['payment'] : []), 'participants', 'review'];

export function EventWizard() {
  const { data: me } = useMeQuery();
  const overview = useOverviewQuery().data;
  const tz = overview?.timeZone;
  const planCap = me?.business?.limits?.['events.participants'] ?? null;
  const perDay = me?.business?.limits?.['events.per_day'] ?? null;
  const [create, state] = useCreateEventMutation();
  const [addChannel] = useAddPaymentChannelMutation();
  const [publish] = useUpdateEventMutation();
  const [finishing, setFinishing] = useState(false);
  const [step, setStep] = useState(0);
  // Time zone and currency start from the business's settings.
  const [f, setF] = useState(() => ({ title: '', slug: '', slugEdited: false, kind: 'free', price: '', currency: '', registerLabel: '', description: '', date: '', startMinute: 540, endMinute: 660, timeZone: '', format: 'onsite', address: '', addressDetails: '', latitude: null, longitude: null, meetingUrl: '', capacity: planCap ? String(planCap) : '', published: true, retentionAgreed: false }));
  const [channels, setChannels] = useState([]); // drafts, uploaded once the event exists
  useEffect(() => {
    if (overview) setF((x) => ({ ...x, timeZone: x.timeZone || overview.timeZone || detectTimeZone(), currency: x.currency || overview.currency || 'PHP' }));
  }, [overview]);
  const steps = stepsFor(f.kind);
  const key = steps[Math.min(step, steps.length - 1)];
  const [voucher, setVoucher] = useState(null);
  const [errors, setErrors] = useState({});
  const set = (patch) => setF((x) => ({ ...x, ...patch }));
  const n = Number(f.capacity) || 0;
  const cap = planCap === null ? null : Math.max(planCap, voucher?.participants ?? 0);
  const today = tz ? todayIn(tz) : '';

  const price = Number(f.price);
  const validBy = {
    name: f.title.trim().length >= 3 && /^[a-z0-9](?:[a-z0-9-]{1,58}[a-z0-9])$/.test(f.slug),
    description: true,
    when: !!f.date && minutesOk(f.startMinute, f.endMinute),
    where: f.format === 'online' || f.address.trim().length >= 3 || (f.addressDetails ?? '').trim().length >= 3,
    // Paid: the amount attendees pay, its currency, and at least one way to pay.
    payment: price > 0 && !!f.currency && channels.length > 0,
    participants: (f.capacity === '' && cap === null) || (n >= 1 && (cap === null || n <= cap)),
    // Without a voucher, the business must agree to the automatic deletion.
    review: !!voucher || f.retentionAgreed,
  };
  const valid = steps.map((k) => validBy[k]);

  const submit = async () => {
    setErrors({});
    const r = await create({
      title: f.title.trim(),
      slug: f.slug,
      kind: f.kind,
      price: f.kind === 'paid' ? price : null,
      currency: f.kind === 'paid' ? f.currency : null,
      description: f.description || null,
      date: f.date,
      startMinute: f.startMinute,
      timeZone: f.timeZone,
      endMinute: f.endMinute,
      format: f.format,
      address: f.format === 'onsite' ? f.address : null,
      addressDetails: f.format === 'onsite' ? (f.addressDetails ?? '').trim() || null : null,
      latitude: f.format === 'onsite' ? (f.latitude ?? null) : null,
      longitude: f.format === 'onsite' ? (f.longitude ?? null) : null,
      meetingUrl: f.format === 'online' ? f.meetingUrl || null : null,
      capacity: f.capacity === '' ? null : n,
      published: f.kind === 'paid' ? false : f.published,
      registerLabel: f.registerLabel.trim() || null,
      voucherCode: voucher?.code ?? null,
      retentionAgreed: !voucher && f.retentionAgreed,
    });
    if (r.error) {
      setErrors(r.error.fields ?? {});
      const back = { title: 'name', slug: 'name', date: 'when', endMinute: 'when', address: 'where', meetingUrl: 'where', price: 'payment', currency: 'payment', capacity: 'participants', voucherCode: 'participants', retentionAgreed: 'review' };
      const first = Object.keys(r.error.fields ?? {}).map((k) => steps.indexOf(back[k])).filter((x) => x >= 0);
      if (first.length) setStep(Math.min(...first));
      return toast.error(r.error.message);
    }
    if (f.kind === 'paid') {
      // Its payment channels go up now; it's published once they're all there (if asked).
      setFinishing(true);
      let failed = 0;
      for (const d of channels) {
        const up = await addChannel({ id: r.data.id, form: draftForm(d) });
        if (up.error) failed++;
      }
      let live = false;
      if (!failed && f.published) live = !(await publish({ id: r.data.id, published: true })).error;
      setFinishing(false);
      if (failed) {
        toast.error(`Event created, but ${failed} payment channel${failed === 1 ? '' : 's'} couldn’t be saved`, { description: 'Add them again on the Details tab, then publish.' });
        return navigate(`${bookingsBase}/events/${r.data.id}#details`);
      }
      toast.success(live ? 'Event created and published' : 'Event created');
      return navigate(`${bookingsBase}/events/${r.data.id}`);
    }
    toast.success(f.published ? 'Event created and published' : 'Event created');
    navigate(`${bookingsBase}/events/${r.data.id}`);
  };

  if (!tz || !me) return <Loading />;
  const next = () => (step === steps.length - 1 ? submit() : setStep(step + 1));

  return (
    <>
      <PageHeader title="New event" description="A seminar, webinar or class on one date. Step by step." actions={<LinkButton href={`${bookingsBase}/events`}>Cancel</LinkButton>} />
      <ol className="mb-5 flex gap-1 overflow-x-auto" aria-label="Steps">
        {steps.map((k, i) => (
          <li key={k} className="flex-1">
            <button
              type="button"
              disabled={i > step && !valid.slice(0, i).every(Boolean)}
              onClick={() => setStep(i)}
              className={cx('flex w-full cursor-pointer flex-col gap-1.5 rounded-md px-1 pb-1 text-left disabled:cursor-default', i === step ? 'text-brand' : i < step ? 'text-ink' : 'text-faint')}
              aria-current={i === step ? 'step' : undefined}
            >
              <span className={cx('h-1.5 rounded-full', i <= step ? 'bg-brand' : 'bg-line')} />
              <span className="truncate text-xs font-semibold">
                {i + 1}. {STEP_LABELS[k]}
              </span>
            </button>
          </li>
        ))}
      </ol>

      <Card key={key} className="motion-safe:animate-rise">
        {key === 'name' && (
          <div className="flex flex-col gap-5">
            <h2 className="text-lg font-semibold">What’s the event called?</h2>
            <Field label="Event name" error={errors.title}>
              {(a) => <Input {...a} autoFocus value={f.title} maxLength={160} onChange={(e) => set({ title: e.target.value, ...(f.slugEdited ? {} : { slug: slugify(e.target.value).slice(0, 60) }) })} />}
            </Field>
            <Field label="Event link" hint={`Your event page: …/e/${f.slug || 'event-name'}`} error={errors.slug}>
              {(a) => <Input {...a} value={f.slug} maxLength={60} onChange={(e) => set({ slug: slugify(e.target.value).slice(0, 60), slugEdited: true })} />}
            </Field>
            <Field label="Free or paid?">
              {() => (
                <Choice
                  label="Free or paid"
                  value={f.kind}
                  onChange={(kind) => set({ kind })}
                  options={[
                    ['free', 'Free', 'Anyone with the link registers and gets a QR code.', ICONS.users],
                    ['paid', 'Paid', 'Attendees pay you (QR code or bank transfer) and upload a proof of payment.', ICONS.tag],
                  ]}
                />
              )}
            </Field>
            {f.kind === 'paid' && <p className="text-sm text-muted">You’ll set the price and how people pay in the Payment step.</p>}
          </div>
        )}

        {key === 'description' && (
          <div className="flex flex-col gap-4">
            <div>
              <h2 className="text-lg font-semibold">Describe it (optional)</h2>
              <p className="text-sm text-muted">What people will learn, who it’s for, what to bring. Shown on the event page.</p>
            </div>
            <RichText value={f.description} onChange={(description) => set({ description })} placeholder="In this seminar you’ll learn…" />
          </div>
        )}

        {key === 'when' && (
          <div className="flex flex-col gap-5">
            <h2 className="text-lg font-semibold">When is it?</h2>
            <Field label="Date" error={errors.date} hint={perDay ? `Your plan includes ${perDay === 1 ? 'one event' : `${perDay} events`} per day.` : undefined}>
              {(a) => <DatePicker {...a} min={today} value={f.date} onChange={(date) => set({ date })} className="max-w-72" />}
            </Field>
            <div className="flex flex-wrap gap-4">
              <Field label="Starts">{(a) => <TimePicker {...a} className="w-40" value={f.startMinute} onChange={(m) => set({ startMinute: m, ...(m >= f.endMinute ? { endMinute: Math.min(1439, m + 60) } : {}) })} />}</Field>
              <Field label="Ends" error={errors.endMinute || (!minutesOk(f.startMinute, f.endMinute) ? 'After the start time.' : undefined)}>
                {(a) => <TimePicker {...a} className="w-40" value={f.endMinute} onChange={(m) => set({ endMinute: m })} />}
              </Field>
            </div>
            <TimeZoneField value={f.timeZone} onChange={(timeZone) => set({ timeZone })} hint="Your current location’s time zone is chosen for you." />
          </div>
        )}

        {key === 'where' && (
          <div className="flex flex-col gap-5">
            <h2 className="text-lg font-semibold">Where is it?</h2>
            <Choice
              label="Onsite or online"
              value={f.format}
              onChange={(format) => set({ format })}
              options={[
                ['onsite', 'Onsite', 'At an address. Attendees check in with their QR code.', ICONS.pin],
                ['online', 'Online', 'A webinar or video call. Add the link now or later.', ICONS.video],
              ]}
            />
            {f.format === 'onsite' ? (
              <Location f={f} set={set} error={errors.address || errors.longitude} />
            ) : (
              <Field label="Meeting link (optional)" hint="Zoom, Google Meet, Teams… Not ready yet? Add it later: everyone registered gets it by email." error={errors.meetingUrl}>
                {(a) => <Input {...a} type="url" value={f.meetingUrl} maxLength={500} placeholder="https://" onChange={(e) => set({ meetingUrl: e.target.value })} />}
              </Field>
            )}
          </div>
        )}

        {key === 'payment' && (
          <div className="flex flex-col gap-5">
            <div>
              <h2 className="text-lg font-semibold">Payment</h2>
              <p className="text-sm text-muted">What attendees pay, and how. Payment isn’t taken online: attendees pay you directly and upload a proof of payment for you to verify.</p>
            </div>
            <Field label="Amount attendees pay" hint={f.price && f.currency && price > 0 ? `Shown on the event page as ${fmtMoney(price, f.currency)}. You can change it later.` : 'Required. You can change it later.'} error={errors.price || errors.currency}>
              {(a) => <MoneyField id={a.id} amount={f.price} currency={f.currency} onAmount={(v) => set({ price: v })} onCurrency={(v) => set({ currency: v ?? '' })} invalid={!!(errors.price || errors.currency)} autoFocus />}
            </Field>
            <div>
              <p className="text-sm font-medium">Payment channels</p>
              <p className="mb-2 text-[13px] text-faint">Up to 4: QR codes (GCash, Maya, a bank QR…) or bank details. At least one is required. Shown on the registration form.</p>
              <ChannelDrafts drafts={channels} onChange={setChannels} />
            </div>
          </div>
        )}

        {key === 'participants' && (
          <div className="flex flex-col gap-4">
            <h2 className="text-lg font-semibold">How many can join?</h2>
            <Participants value={f.capacity} onChange={(capacity) => set({ capacity })} planCap={planCap} voucher={voucher} onVoucher={setVoucher} />
            {errors.capacity && <p className="text-[13px] text-danger">{errors.capacity}</p>}
          </div>
        )}

        {key === 'review' && (
          <div className="flex flex-col gap-4">
            <h2 className="text-lg font-semibold">Check and create</h2>
            <div className="flex gap-4 rounded-xl border border-line p-4">
              {f.date && <DateTile date={f.date} big />}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap gap-1.5">
                  <KindBadge e={{ kind: f.kind, priceLabel: f.kind === 'paid' && price > 0 && f.currency ? fmtMoney(price, f.currency) : '' }} />
                  <Badge>{f.format === 'online' ? 'Online' : 'Onsite'}</Badge>
                </div>
                <p className="mt-1.5 text-lg font-semibold">{f.title}</p>
                <p className="text-sm text-muted">{f.date && `${fmtLongDate(f.date)} · ${range(f.startMinute, f.endMinute)} (${zoneLabel(f.timeZone)})`}</p>
                <p className="text-sm text-muted">{f.format === 'onsite' ? f.address : f.meetingUrl ? 'Online · link added' : 'Online · link to follow'}</p>
                <p className="text-sm text-muted">{f.capacity ? `Up to ${f.capacity} participants` : 'No participant limit'}</p>
                {f.kind === 'paid' && <p className="text-sm text-muted">{channels.length} payment channel{channels.length === 1 ? '' : 's'}: {channels.map((c) => c.label).join(', ')}</p>}
              </div>
            </div>
            {f.description && <div className="rich max-h-40 overflow-hidden rounded-xl bg-sunken/50 p-3 text-sm text-muted" dangerouslySetInnerHTML={{ __html: f.description }} />}
            <Field label="Register button text (optional)" hint={`Shown on the event page. Empty: “${f.kind === 'paid' ? 'Register' : 'Register for free'}”.`}>
              {(a) => <Input {...a} value={f.registerLabel} maxLength={40} className="max-w-72" onChange={(e) => set({ registerLabel: e.target.value })} />}
            </Field>
            <Checkbox label="Publish now" hint="The event page goes live and people can register. You can publish later too." checked={f.published} onChange={(e) => set({ published: e.target.checked })} />
            {!voucher && (
              <div className={cx('overflow-hidden rounded-xl border-2', f.retentionAgreed ? 'border-ok/40' : 'border-warn/60')}>
                <div className={cx('flex gap-3 p-4', f.retentionAgreed ? 'bg-ok-soft/40' : 'bg-warn-soft/60')}>
                  <span className={cx('grid size-9 shrink-0 place-items-center rounded-full', f.retentionAgreed ? 'bg-ok text-white' : 'bg-warn text-white')} aria-hidden="true">
                    <Icon d={f.retentionAgreed ? ICONS.check : 'M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z'} className="size-5" />
                  </span>
                  <div className="min-w-0">
                    <p className="font-semibold text-ink">
                      <span className="uppercase">Free events</span> are deleted after {RETENTION_MONTHS} months
                    </p>
                    <p className="mt-1 text-sm text-muted">
                      This event is <strong className="text-ink">free to host</strong> (up to 50 participants, whether attendees pay or not), so it’s kept until{' '}
                      <strong className="text-ink">{f.date ? fmtLongDate(plusMonths(f.date, RETENTION_MONTHS)) : `${RETENTION_MONTHS} months after the event`}</strong> and then <strong className="text-ink">deleted automatically</strong>: registrations, check-ins, claims and scanners.
                    </p>
                    <ul className="mt-2 space-y-0.5 text-sm text-muted">
                      <li>• We’ll remind you by email 7, 3 and 1 days before.</li>
                      <li>• When it’s deleted, we email you the complete event as CSV and JSON files.</li>
                      <li>• To keep it longer, get a bigger-event voucher from Byte Bun.</li>
                    </ul>
                  </div>
                </div>
                <label className={cx('flex cursor-pointer items-center gap-3 border-t px-4 py-3', f.retentionAgreed ? 'border-ok/30 bg-surface' : 'border-warn/40 bg-surface hover:bg-sunken/50')}>
                  <input type="checkbox" className="size-5 shrink-0 cursor-pointer accent-[var(--color-brand)]" checked={f.retentionAgreed} onChange={(e) => set({ retentionAgreed: e.target.checked })} />
                  <span className="text-sm font-semibold text-ink">I understand this free event will be deleted, and I agree</span>
                </label>
                {errors.retentionAgreed && <p className="px-4 pb-3 text-[13px] text-danger">{errors.retentionAgreed}</p>}
              </div>
            )}
          </div>
        )}

        <div className="mt-6 flex items-center justify-between gap-2 border-t border-line pt-4">
          <Button variant="ghost" disabled={step === 0} onClick={() => setStep(step - 1)}>
            ← Back
          </Button>
          <div className="flex gap-2">
            {key === 'description' && !f.description && (
              <Button variant="secondary" onClick={() => setStep(step + 1)}>
                Skip
              </Button>
            )}
            <Button onClick={next} disabled={!valid[step]} loading={state.isLoading || finishing}>
              {step === steps.length - 1 ? 'Create event' : 'Next →'}
            </Button>
          </div>
        </div>
      </Card>
    </>
  );
}

// ---- One event ----

/**
 * Live attendance: the API pushes a message per check-in, registration, cancellation... (server-sent
 * events, /events/:id/live). Each one shows a toast and refreshes the event's data.
 */
function useEventLive(id) {
  const dispatch = useDispatch();
  useEffect(() => {
    if (typeof EventSource === 'undefined') return undefined;
    const source = new EventSource(`/api/client/bookings/events/${id}/live`, { withCredentials: true });
    const onChange = (msg) => {
      let m;
      try {
        m = JSON.parse(msg.data);
      } catch {
        return;
      }
      dispatch(api.util.invalidateTags(['Events']));
      if (m.type === 'checked_in') toast.success(`${m.name} checked in`, { description: m.by ? `by ${m.by}` : undefined });
      else if (m.type === 'registered') toast.info(`${m.name} registered`);
      else if (m.type === 'cancelled') toast.info(`${m.name} cancelled their registration`);
      else if (m.type === 'claimed') toast.success(`${m.name} claimed ${m.item}`, { description: m.by ? `by ${m.by}` : undefined });
      else if (m.type === 'payment_submitted') toast.warning(`${m.name} sent a proof of payment`, { description: 'Verify it on the Attendees tab.' });
      else if (m.type === 'payment_approved') toast.success(`${m.name}’s payment approved`, { description: m.by ? `by ${m.by}` : undefined });
      else if (m.type === 'refunded') toast.info(`Refund sent to ${m.name}`, { description: m.by ? `by ${m.by}` : undefined });
      else if (m.type === 'refund_details') toast.info(`${m.name} sent their refund details`, { description: 'See the Refund requests tab.' });
      else if (m.type === 'payment_expired') toast.info(`${m.name}’s spot was released`, { description: 'No proof of payment in time.' });
      else if (m.type === 'reserved') toast.info(`${m.name} reserved`, { description: 'Their proof of payment is due within 2 hours.' });
      else if (m.type === 'waitlisted') toast.info(`${m.name} joined the waitlist`);
    };
    source.addEventListener('change', onChange);
    return () => source.close();
  }, [id, dispatch]);
}

export function EventDetail({ id }) {
  const { data: me } = useMeQuery();
  const tz = useOverviewQuery().data?.timeZone;
  const q = useEventQuery(id);
  useEventLive(id);
  const link = useEventLink(q.data?.event);
  const [tab, setTab] = useState(() => (window.location.hash === '#details' ? 'details' : 'attendees'));
  const [setPublished, publishState] = useUpdateEventMutation();
  const confirmAsk = useConfirm();
  if (q.isLoading || !tz) return <Loading />;
  if (q.error) return <Empty title="Event not found">It may have been deleted.</Empty>;
  const { event: e, tickets, taken, limits } = q.data;
  const over = new Date(e.endsAt) <= new Date();
  const edit = can(me, 'events.manage');
  const promos = can(me, 'events.promotions');
  const payments = can(me, 'events.payments');
  const channelCount = (q.data.paymentChannels ?? []).length;
  const canPublish = e.kind !== 'paid' || channelCount > 0;
  const togglePublished = async () => {
    if (e.published) {
      const ok = await confirmAsk({
        title: `Unpublish “${e.title}”?`,
        body: 'The event page is hidden and registration closes. Everyone already registered keeps their spot and QR code. You can publish it again any time.',
        action: 'Unpublish',
      });
      if (!ok) return;
    }
    const r = await setPublished({ id: e.id, published: !e.published });
    if (r.error) {
      if (r.error.error === 'no_payment_channels') setTab('details');
      return toast.error(r.error.message);
    }
    toast.success(e.published ? 'Event unpublished: its page is hidden' : 'Event published: its page is live');
  };

  return (
    <>
      <a href={`${bookingsBase}/events`} className="mb-3 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <Icon d={ICONS.chevronLeft} className="size-4" /> Events
      </a>
      {/* The title on its own line, full width, above the date, details and actions. */}
      <h1 className="mb-3 block w-full text-2xl leading-tight font-semibold tracking-tight break-words desktop:text-3xl">{e.title}</h1>
      <div className="mb-5 flex flex-wrap items-start gap-4">
        <DateTile date={e.date} big />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap gap-1.5">
            <KindBadge e={e} />
            <Badge>{e.format === 'online' ? 'Online' : 'Onsite'}</Badge>
            {e.published ? <Badge tone="brand">Published</Badge> : <Badge tone="danger">Not published</Badge>}
            {over && <Badge>Over</Badge>}
          </div>
          <p className="mt-1.5 text-sm text-muted">
            {when(e)} · {e.format === 'onsite' ? e.address : e.meetingUrl ? 'Online' : 'Online · link not added yet'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {link && e.published && <AccessEventMenu link={link} />}
          {edit && (
            <Button
              variant={e.published ? 'secondary' : 'primary'}
              onClick={togglePublished}
              loading={publishState.isLoading}
              disabled={!e.published && !canPublish}
              title={!e.published && !canPublish ? 'Add a payment channel on the Details tab first' : undefined}
            >
              <Icon d={e.published ? ICONS.eyeOff : ICONS.eye} className="size-4" /> {e.published ? 'Unpublish' : 'Publish'}
            </Button>
          )}
          <ExportMenu id={e.id} />
          {e.format !== 'online' && <ScannerMenu e={e} claimables={q.data.claimables ?? []} />}
        </div>
      </div>
      {e.retention?.applies && (
        <Notice tone="info" className="mb-4" title={`Deleted automatically on ${fmtLongDate(e.retention.deleteOn)}`}>
          {RETENTION_MONTHS} months after the event, as agreed. We’ll remind you 7, 3 and 1 days before and email you the complete event (CSV and JSON). You can export it any time with Export.
        </Notice>
      )}
      {(() => {
        const toVerify = tickets.filter((t) => t.status === 'review').length;
        return toVerify > 0 && tab !== 'attendees' ? (
          <Notice tone="warn" className="mb-4" title={`${toVerify} payment${toVerify === 1 ? '' : 's'} to verify`}>
            <button type="button" onClick={() => setTab('attendees')} className="cursor-pointer font-medium text-brand underline">
              Open Attendees
            </button>{' '}
            to view the proofs and approve or reject them.
          </Notice>
        ) : null;
      })()}
      {e.kind === 'paid' && !channelCount && edit && (
        <Notice tone="warn" className="mb-4" title="Add how people pay, then publish">
          This paid event can’t be published until it has a payment channel. Add up to 4 (QR codes or bank details) in{' '}
          <button type="button" onClick={() => setTab('details')} className="cursor-pointer font-medium text-brand underline">
            Details
          </button>
          : they’re shown on the registration form.
        </Notice>
      )}
      {!e.published && canPublish && edit && (
        <Notice tone="info" className="mb-4" title="Not published">
          The event page is hidden and nobody can register. Use <strong>Publish</strong> above when it’s ready.
        </Notice>
      )}
      {e.format === 'online' && !e.meetingUrl && !over && (
        <Notice tone="warn" className="mb-4" title="No meeting link yet">
          Add it in Details when you have it: everyone registered gets it by email.
        </Notice>
      )}

      <PriorityTabs label="Event" value={tab} onChange={setTab} tabs={[
          ['attendees', `Attendees (${tickets.filter((t) => ['confirmed', 'pending', 'reserved', 'review', 'rejected'].includes(t.status)).length})`],
          ...(e.format !== 'online' ? [['statuses', 'Statuses'], ['scanners', 'Scanners']] : []),
          ...(e.kind === 'paid' && promos ? [['promos', 'Promo codes'], ['affiliates', 'Affiliates']] : []),
          ...(e.kind === 'paid' && payments ? [['collections', 'Collections'], ['refunds', 'Refund requests']] : []),
          ['team', 'Team'],
          ['details', 'Details'],
        ]} />
      {tab === 'team' ? <EventTeamTab e={e} /> : tab === 'promos' && e.kind === 'paid' && promos ? <PromoCodesCard e={e} canEdit={promos} /> : tab === 'affiliates' && e.kind === 'paid' && promos ? <EventAffiliatesTab e={e} canEdit={promos} /> : tab === 'refunds' && e.kind === 'paid' && payments ? <RefundRequestsTab e={e} tz={tz} /> : tab === 'collections' && e.kind === 'paid' && payments ? <EventCollections e={e} tz={tz} /> : tab === 'statuses' && e.format !== 'online' ? <EventStatuses e={e} tickets={tickets} claimables={q.data.claimables ?? []} tz={tz} /> : tab === 'attendees' ? <Attendees e={e} tickets={tickets} taken={taken} tz={tz} /> : tab === 'scanners' && e.format !== 'online' ? <Scanners e={e} canEdit={can(me, 'events.scanners')} tz={tz} /> : <EventEditor e={e} limits={limits} canEdit={edit} taken={taken} hasTickets={tickets.length > 0} tz={tz} channels={q.data.paymentChannels ?? []} />}
    </>
  );
}

function Attendees({ e, tickets, taken, tz, claimables = [] }) {
  const [issue, issueState] = useIssueEventCodeMutation();
  const [delCode] = useDeleteEventCodeMutation();
  const [revoke] = useRevokeEventTicketMutation();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const [form, setForm] = useState({ name: '', email: '', phone: '' });
  const [errors, setErrors] = useState({});
  const [issued, setIssued] = useState(null);
  const [query, setQuery] = useState('');
  const [view, setView] = useState('all'); // all (no revoked or waitlist) | in | out | reserved | verify | waitlist | cancelled | revoked
  const [item, setItem] = useState(''); // '' | `${claimableId}:yes` | `${claimableId}:no`
  const [codesFor, setCodesFor] = useState(null); // ticket: its codes (a bulk booking: every spot's)
  /** A registration's codes: every spot of a bulk booking, or just its own. */
  const codesOf = (t) => (t.groupId ? tickets.filter((x) => x.groupId === t.groupId) : [t]).filter((x) => x.code).sort((a, b) => a.id - b.id);
  // A bulk booking's spots in these statuses (refunds, revoking...: the whole booking by default).
  const spotsOf = (t, statuses) => (t.groupId ? tickets.filter((x) => x.groupId === t.groupId && statuses.includes(x.status)) : [t]);
  const ACTIVE = ['confirmed', 'review', 'rejected'];
  const [askingRefund, setAskingRefund] = useState(null); // ticket: send a refund request
  const [activityFor, setActivityFor] = useState(null); // ticket: its activity log
  const pay = usePaymentReview(e, tz, tickets);
  const confirmed = tickets.filter((t) => t.status === 'confirmed').length;
  const checked = tickets.filter((t) => t.checkedInAt).length;
  const revoked = tickets.filter((t) => t.status === 'revoked').length;
  const cancelledCount = tickets.filter((t) => t.status === 'cancelled').length;
  const notYet = tickets.filter((t) => !t.checkedInAt && (t.status === 'confirmed' || t.status === 'pending')).length;
  const toVerify = tickets.filter((t) => t.status === 'review' || t.status === 'rejected');
  const reservedList = tickets.filter((t) => t.status === 'reserved');
  const waitlist = tickets.filter((t) => t.status === 'waitlist').sort((a, b) => a.id - b.id);
  /** #1 is offered the next freed spot. */
  const placeInLine = (t) => waitlist.findIndex((x) => x.id === t.id) + 1;
  const claimedOf = (t, id) => (t.claims ?? []).find((c) => c.claimableId === id);

  // Search: name, email, phone, or the code (with or without the dash, any case).
  const q = query.trim().toLowerCase();
  const qCode = q.replace(/[^a-z0-9]/g, '');
  const matches = (t) => !q || `${t.name} ${t.email} ${t.phone ?? ''}`.toLowerCase().includes(q) || (qCode.length >= 3 && (t.code ?? '').replace('-', '').toLowerCase().includes(qCode));
  // Revoked registrations only ever show under Revoked.
  const inView = (t) =>
    view === 'revoked'
      ? t.status === 'revoked'
      : view === 'waitlist'
        ? t.status === 'waitlist'
        : t.status !== 'revoked' &&
        t.status !== 'waitlist' &&
        (view === 'all' || (view === 'in' && !!t.checkedInAt) || (view === 'out' && !t.checkedInAt && (t.status === 'confirmed' || t.status === 'pending')) || (view === 'cancelled' && t.status === 'cancelled') || (view === 'verify' && (t.status === 'review' || t.status === 'rejected')) || (view === 'reserved' && t.status === 'reserved'));
  const byItem = (t) => {
    if (!item) return true;
    const [id, want] = item.split(':');
    return t.status === 'confirmed' && !!claimedOf(t, Number(id)) === (want === 'yes');
  };
  // A bulk booking waiting for verification shows once (its first spot); approved, every spot shows.
  const bookingLead = new Map();
  for (const t of tickets) if (t.groupId && ['reserved', 'review', 'rejected'].includes(t.status)) bookingLead.set(t.groupId, Math.min(bookingLead.get(t.groupId) ?? Infinity, t.id));
  const isLead = (t) => !(t.groupId && ['reserved', 'review', 'rejected'].includes(t.status)) || bookingLead.get(t.groupId) === t.id;
  const shown = tickets.filter((t) => isLead(t) && matches(t) && inView(t) && byItem(t));
  const filtered = !!q || view !== 'all' || !!item;

  const submitIssue = async (ev) => {
    ev.preventDefault();
    setErrors({});
    const r = await issue({ id: e.id, name: form.name, email: form.email, phone: form.phone || null });
    if (r.error) {
      setErrors(r.error.fields ?? {});
      return toast.error(r.error.message);
    }
    setIssued(r.data);
    setForm({ name: '', email: '', phone: '' });
  };

  const STATUS = { confirmed: ['ok', 'Registered'], pending: ['warn', 'Code not used yet'], reserved: ['neutral', 'Reserved'], waitlist: ['neutral', 'Waitlist'], review: ['warn', 'For verification'], rejected: ['danger', 'Waiting for proof'], revoked: ['danger', 'Revoked'], cancelled: ['neutral', 'Cancelled by them'] };

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-3 gap-px overflow-hidden rounded-card border border-line bg-line">
        {[
          ['Registered', confirmed],
          ['Spots taken', e.capacity ? `${taken} / ${e.capacity}` : taken],
          ['Checked in', checked],
        ].map(([l, v]) => (
          <div key={l} className="bg-surface px-4 py-3">
            <p className="text-xs font-semibold tracking-wide text-faint uppercase">{l}</p>
            <p className="mt-0.5 text-xl font-semibold tabular-nums">{v}</p>
          </div>
        ))}
      </div>

      {claimables.length > 0 && (
        <div className="grid gap-3 desktop:grid-cols-2">
          {claimables.map((k) => {
            const n = tickets.filter((t) => claimedOf(t, k.id)).length;
            const pct = confirmed ? Math.round((n / confirmed) * 100) : 0;
            return (
              <button
                key={k.id}
                type="button"
                onClick={() => setItem(item === `${k.id}:no` ? '' : `${k.id}:no`)}
                className={cx('flex cursor-pointer items-center gap-3 rounded-card border bg-surface px-4 py-3 text-left transition hover:border-brand', item === `${k.id}:no` ? 'border-brand ring-1 ring-brand' : 'border-line')}
                title={`Show who hasn’t claimed ${k.name}`}
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">
                  <Icon d={ICONS.tag} className="size-[18px]" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm font-semibold">{k.name}</span>
                    <span className="shrink-0 text-xs text-muted tabular-nums">
                      {n} / {confirmed} claimed
                    </span>
                  </span>
                  <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-sunken">
                    <span className="block h-full rounded-full bg-brand transition-[width] duration-500" style={{ width: `${pct}%` }} />
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}

      {e.kind === 'paid' && toVerify.length > 0 && <PaymentsSummary tickets={toVerify} onShow={() => (setView('verify'), setQuery(''), setItem(''))} />}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">{e.kind === 'paid' ? 'Registered someone who paid you directly, or a guest? Add them yourself.' : 'Add someone yourself: they get their QR code by email.'}</p>
        <ManualRegisterButton e={e} taken={taken} />
      </div>

      <section className="overflow-hidden rounded-card border border-line bg-surface">
        <header className="flex flex-col gap-3 border-b border-line px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-semibold">
              {e.kind === 'paid' ? 'Codes and registrations' : 'Registrations'}
              {filtered && (
                <span className="ml-2 text-sm font-normal text-muted">
                  {shown.length} of {view === 'revoked' ? tickets.length : view === 'waitlist' ? waitlist.length : tickets.length - revoked - waitlist.length}
                </span>
              )}
            </h2>
            <div className="relative w-full desktop:w-80">
              <Icon d="M21 21l-4.3-4.3M17 10.5a6.5 6.5 0 11-13 0 6.5 6.5 0 0113 0z" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
              <Input type="search" value={query} onChange={(x) => setQuery(x.target.value)} placeholder="Search by name or code" className="pl-9" aria-label="Search registrations by name, email or code" />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1 rounded-btn bg-sunken p-1" role="tablist" aria-label="Show">
              {[
                ['all', `All ${tickets.length - revoked - waitlist.length}`],
                ['in', `Checked in ${checked}`],
                ['out', `Not yet ${notYet}`],
                ...(reservedList.length ? [['reserved', `Reserved ${reservedList.length}`]] : []),
                ...(toVerify.length ? [['verify', `For verification ${toVerify.length}`]] : []),
                ...(waitlist.length ? [['waitlist', `Waitlist ${waitlist.length}`]] : []),
                ...(cancelledCount ? [['cancelled', `Cancelled ${cancelledCount}`]] : []),
                ...(revoked ? [['revoked', `Revoked ${revoked}`]] : []),
              ].map(([k, l]) => (
                <button key={k} type="button" role="tab" aria-selected={view === k} onClick={() => setView(k)} className={`cursor-pointer rounded-md px-2.5 py-1 text-xs font-medium tabular-nums ${view === k ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'}`}>
                  {l}
                </button>
              ))}
            </div>
            {claimables.length > 0 && (
              <select value={item} onChange={(x) => setItem(x.target.value)} className="min-h-8 cursor-pointer rounded-btn border border-line-strong bg-surface px-2 text-xs font-medium" aria-label="Filter by claimable">
                <option value="">Any claimable</option>
                {claimables.map((k) => (
                  <optgroup key={k.id} label={k.name}>
                    <option value={`${k.id}:yes`}>Claimed {k.name}</option>
                    <option value={`${k.id}:no`}>Not claimed {k.name}</option>
                  </optgroup>
                ))}
              </select>
            )}
            {filtered && (
              <button type="button" onClick={() => (setQuery(''), setView('all'), setItem(''))} className="cursor-pointer text-xs font-medium text-brand underline">
                Clear
              </button>
            )}
          </div>
        </header>
        {!tickets.length ? (
          <p className="px-4 py-8 text-center text-sm text-faint">{e.kind === 'paid' ? 'No registrations yet. Share the event link, or use Manual Register.' : e.published ? 'Nobody has registered yet. Share the event link.' : 'Publish the event so people can register.'}</p>
        ) : (
          <ul className="divide-y divide-line">
            {!shown.length && <li className="px-4 py-8 text-center text-sm text-faint">No registrations match{q ? ` “${query.trim()}”` : ''}.</li>}
            {(() => {
              const row = (t, nested = false) => (
              <li
                key={t.id}
                data-nested={nested || undefined}
                // Payments to verify: the whole row opens the proof viewer (with the actions).
                onClick={pay.canOpen(t) ? (ev) => !ev.target.closest('button, a') && pay.open(t) : undefined}
                className={cx(
                  'flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3',
                  (t.status === 'revoked' || t.status === 'cancelled') && 'bg-sunken/40',
                  t.status === 'review' && 'border-l-4 border-l-warn bg-warn/5',
                  t.status === 'rejected' && 'border-l-4 border-l-danger/60',
                  t.status === 'reserved' && 'border-l-4 border-l-line-strong',
                  t.status === 'waitlist' && 'bg-sunken/30',
                  // Admitted: the whole row turns green.
                  t.checkedInAt && 'border-l-4 border-l-ok bg-ok-soft/50',
                  pay.canOpen(t) && 'cursor-pointer transition hover:bg-warn/10',
                )}
              >
                <div className="min-w-0 flex-1">
                  <p className={cx('truncate font-medium', (t.status === 'revoked' || t.status === 'cancelled') && 'text-faint line-through')}>{t.name}</p>
                  <p className="truncate text-sm text-faint">
                    {t.email}
                    {t.phone && ` · ${t.phone}`}
                  </p>
                  <p className="text-xs text-faint" title={t.confirmedAt && t.confirmedAt !== t.createdAt ? `Confirmed ${regWhen(t.confirmedAt, tz)}` : undefined}>
                    <span className={t.status === 'confirmed' ? 'font-semibold text-ok' : undefined}>{t.status === 'pending' ? 'Code given' : 'Registered'}</span> {regWhen(t.createdAt, tz)}
                    {t.status !== 'confirmed' && (
                      <span className={cx('ml-1.5 font-semibold', { warn: 'text-warn', danger: 'text-danger', neutral: 'text-muted', ok: 'text-ok' }[STATUS[t.status][0]])}>
                        · {STATUS[t.status][1]}
                        {t.status === 'reserved' && t.reuploadBy ? ` until ${regWhen(t.reuploadBy, tz)} (no proof yet)` : ''}
                        {t.status === 'waitlist' ? ` · #${placeInLine(t)} in line` : ''}
                      </span>
                    )}
                    {t.status === 'confirmed' && e.kind === 'paid' && <span className="ml-1.5 font-semibold text-ok">· Verified</span>}
                  </p>
                  {t.checkedInAt && (
                    <p className="flex items-center gap-1 text-xs">
                      <span className="grid size-3.5 place-items-center rounded-full bg-ok text-white">
                        <Icon d={ICONS.check} className="size-2.5" />
                      </span>
                      <span className="font-semibold text-ok">Admitted</span> <span className="text-faint">{regWhen(t.checkedInAt, tz)}</span>
                    </p>
                  )}
                  {t.refunds?.length > 0 && (() => {
                    // What was refunded so far, per currency (amounts recorded with each refund).
                    const byCur = {};
                    for (const r of t.refunds) if (r.amountValue) byCur[r.currency ?? t.paidCurrency ?? e.currency ?? 'PHP'] = (byCur[r.currency ?? t.paidCurrency ?? e.currency ?? 'PHP'] ?? 0) + r.amountValue;
                    const parts = Object.entries(byCur).map(([c, v]) => fmtMoney(v, c));
                    return (
                      <p className="text-xs font-medium text-danger">
                        Refunded {parts.length ? parts.join(' + ') : '(no amount)'}
                        {t.amountPaid != null ? ` of ${fmtMoney(t.amountPaid, t.paidCurrency ?? e.currency ?? 'PHP')}` : ''}
                        {t.refunds.length > 1 ? ` · ${t.refunds.length} refunds` : ''}
                      </p>
                    );
                  })()}
                  {pay.info(t)}
                </div>
                {codesOf(t).length ? <ShowCodesButton count={codesOf(t).length} onClick={() => setCodesFor(t)} /> : <span className="text-xs text-faint" title="The check-in code is given once the payment is confirmed">Code after payment</span>}
                {claimables.length > 0 && t.status === 'confirmed' && (
                  <span className="flex flex-wrap gap-1" aria-label="Claimables">
                    {claimables.map((k) => {
                      const c = claimedOf(t, k.id);
                      return (
                        <span
                          key={k.id}
                          title={c ? `${k.name}: claimed at ${fmtTime(c.claimedAt, tz)}` : `${k.name}: not claimed yet`}
                          className={cx('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold', c ? 'border-brand bg-brand text-brand-ink' : 'border-dashed border-line-strong text-faint')}
                        >
                          {c ? '✓' : '○'} {k.name}
                        </span>
                      );
                    })}
                  </span>
                )}
                <RowMenu
                  label={`Actions for ${t.name}`}
                  items={[
                    ...pay.menuItems(t),
                    pay.menuItems(t).length ? '—' : null,
                    { label: 'Activity', hint: 'Everything that happened to this registration', icon: 'M12 8v4l3 2M3.05 11a9 9 0 11.5 4M3 4v5h5', onClick: () => setActivityFor(t) },
                    pay.fileCount(t) ? { label: `File history (${pay.fileCount(t)})`, icon: 'M21 12.5l-8.5 8.5a5.5 5.5 0 01-7.8-7.8l9-9a3.7 3.7 0 015.2 5.2l-9 9a1.8 1.8 0 01-2.6-2.6l8.3-8.3', onClick: () => pay.openFiles(t) } : null,
                    codesOf(t).length ? { label: codesOf(t).length > 1 ? `Show the codes (${codesOf(t).length})` : 'Show the code', hint: 'Check-in code and QR code', icon: ICONS.qr, onClick: () => setCodesFor(t) } : null,
                    ...(e.kind === 'paid' && ['confirmed', 'review', 'rejected'].includes(t.status) && refundableLeft(e, t) !== 0
                      ? [
                          '—',
                          { label: 'Send a refund request', hint: 'They give their QR code or bank details', icon: 'M4 6h16v12H4zM4 7l8 6 8-6', onClick: () => setAskingRefund(t) },
                        ]
                      : []),
                    ...(t.status === 'pending' || UNPAID.includes(t.status) || (e.kind === 'free' && t.status === 'confirmed') ? ['—'] : []),
                    t.status === 'pending' || UNPAID.includes(t.status)
                      ? {
                          label: t.status === 'pending' ? 'Delete this unused code' : t.status === 'waitlist' ? 'Remove from the waitlist' : spotsOf(t, UNPAID).length > 1 ? `Remove this booking (${spotsOf(t, UNPAID).length} spots)` : 'Remove this registration',
                          icon: ICONS.trash,
                          tone: 'danger',
                          onClick: async () => {
                            const unpaid = t.status !== 'pending';
                            const n = unpaid ? spotsOf(t, UNPAID).length : 1;
                            if (!(await confirm(unpaid ? { title: n > 1 ? `Remove ${t.name}’s booking (${n} spots)?` : `Remove ${t.name}?`, body: t.status === 'waitlist' ? 'They’re taken off the waitlist and won’t be offered a spot. They aren’t emailed.' : n > 1 ? `All ${n} spots are freed. The booking and its proofs stay in the history. They aren’t emailed.` : 'Their spot is freed. Their registration and proofs stay in the history. They aren’t emailed.', action: 'Remove' } : { title: 'Delete this code?', body: `${t.name}’s code ${t.code} stops working and their spot is freed.`, action: 'Delete code' }))) return;
                            const r = await delCode({ id: e.id, ticketId: t.id });
                            if (r.error) toast.error(r.error.message);
                            else toast.success(unpaid ? (n > 1 ? `Booking removed: ${n} spots freed` : 'Registration removed') : 'Code deleted');
                          },
                        }
                      : null,
                    ...(e.kind === 'free' && t.status === 'confirmed'
                      ? (() => {
                          const n = spotsOf(t, ['confirmed']).length;
                          const doRevoke = async (scope) => {
                            const all = scope === 'booking' && n > 1;
                            const reason = await prompt({ title: all ? `Revoke ${t.name}’s booking (${n} spots)?` : n > 1 ? `Revoke only this spot (${t.code ?? 'no code'})?` : `Revoke ${t.name}’s registration?`, label: 'Reason (optional, emailed to them)', hint: all ? `All ${n} QR codes stop working and the spots are freed. They’re emailed once.` : 'Their QR code stops working and their spot is freed.', action: 'Revoke', required: false });
                            if (reason === null) return;
                            const r = await revoke({ id: e.id, ticketId: t.id, reason: reason || null, scope });
                            if (r.error) toast.error(r.error.message);
                            else toast.success(all ? `Booking revoked: ${n} spots. They were emailed.` : 'Registration revoked. They were emailed.');
                          };
                          return n > 1
                            ? [
                                { label: `Revoke the whole booking (${n} spots)`, hint: 'Every QR code of the booking stops working. They’re emailed.', icon: ICONS.xCircle, tone: 'danger', onClick: () => doRevoke('booking') },
                                { label: 'Revoke only this spot', hint: 'Just this QR code stops working.', icon: ICONS.xCircle, tone: 'danger', onClick: () => doRevoke('spot') },
                              ]
                            : [{ label: 'Revoke registration', hint: 'Their QR code stops working. They’re emailed.', icon: ICONS.xCircle, tone: 'danger', onClick: () => doRevoke('spot') }];
                        })()
                      : []),
                  ]}
                />
              </li>
              );
              // Bulk bookings: their spots together, under one highlighted header.
              return bulkBlocks(shown).map((blk) => {
                const all = tickets.filter((x) => x.groupId && x.groupId === blk.groupId);
                if (!blk.groupId || all.length < 2) return blk.items.map((t) => row(t));
                const lead = blk.items[0];
                const live = all.filter((x) => ['confirmed', 'pending', 'reserved', 'review', 'rejected'].includes(x.status));
                const verifying = live.some((x) => x.status === 'review' || x.status === 'rejected');
                const reservedN = live.some((x) => x.status === 'reserved');
                const total = e.kind === 'paid' && e.price != null && e.currency ? fmtMoney(live.reduce((a, x) => a + (x.amountPaid ?? Math.max(0, e.price - (x.discount ?? 0))), 0), x0cur(e, lead)) : null;
                const admittedN = all.filter((x) => x.checkedInAt).length;
                return (
                  <li key={blk.key} className="border-l-4 border-l-brand bg-brand-soft/30">
                    <BulkHeader
                      className="px-4 pt-3 pb-2"
                      name={lead.name}
                      spots={all.length}
                      facts={[lead.email, total, reservedN ? 'reserved, no proof yet' : verifying ? 'for verification' : null, !verifying && !reservedN && e.format !== 'online' ? `${admittedN}/${all.length} admitted` : null, live.length < all.length ? `${all.length - live.length} cancelled or refunded` : null]}
                    />
                    <ul className="ml-4 divide-y divide-line border-t border-line bg-surface">{blk.items.map((t) => row(t, true))}</ul>
                  </li>
                );
              });
            })()}
          </ul>
        )}
      </section>

      {askingRefund && <SendRefundRequestDialog e={e} t={askingRefund} spots={spotsOf(askingRefund, ACTIVE)} onClose={() => setAskingRefund(null)} />}
      {codesFor && <TicketCodesDialog e={e} t={codesFor} spots={codesOf(codesFor)} onClose={() => setCodesFor(null)} />}
      {activityFor && <ActivityDialog e={e} t={activityFor} tz={tz} onClose={() => setActivityFor(null)} />}
      {pay.dialogs}
      {issued && (
        <Dialog
          open
          onClose={() => setIssued(null)}
          title="Code ready"
          footer={
            <>
              <Button variant="secondary" onClick={() => copy(issued.code, 'Code')}>
                Copy code
              </Button>
              <Button onClick={() => setIssued(null)}>Done</Button>
            </>
          }
        >
          <p className="text-sm text-muted">Give this code to {issued.name}. They enter it on the event page to register, and then get their QR code by email.</p>
          <p className="my-5 rounded-xl bg-sunken py-4 text-center font-mono text-3xl font-bold tracking-[0.3em] text-ink">{issued.code}</p>
          <p className="text-xs text-faint">It’s also in the list, where you can copy it again or delete it while it’s unused.</p>
        </Dialog>
      )}
    </div>
  );
}

function EventEditor({ e, limits, canEdit, taken, hasTickets, tz, channels = [] }) {
  const defaultCurrency = useOverviewQuery().data?.currency ?? 'PHP';
  const [update, state] = useUpdateEventMutation();
  const [deleting, setDeleting] = useState(false);
  const [section, setSection] = useState('essentials');
  const initial = () => ({ title: e.title, slug: e.slug, kind: e.kind, price: e.price != null ? String(e.price) : '', currency: e.currency ?? defaultCurrency, registerLabel: e.registerLabel ?? '', description: e.description ?? '', date: e.date, startMinute: e.startMinute, endMinute: e.endMinute, timeZone: e.timeZone, format: e.format, address: e.address ?? '', addressDetails: e.addressDetails ?? '', latitude: e.latitude ?? null, longitude: e.longitude ?? null, meetingUrl: e.meetingUrl ?? '', capacity: e.capacity ? String(e.capacity) : '', published: e.published });
  const [f, setF] = useState(initial);
  const [voucher, setVoucher] = useState(null);
  const [errors, setErrors] = useState({});
  useEffect(() => setF(initial()), [e]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (patch) => setF((x) => ({ ...x, ...patch }));
  const dirty = JSON.stringify(f) !== JSON.stringify(initial()) || !!voucher;
  const n = Number(f.capacity) || 0;
  const cap = limits.participants === null ? null : Math.max(limits.participants, voucher?.participants ?? 0);
  const ok = (f.kind !== 'paid' || (Number(f.price) > 0 && !!f.currency)) && f.title.trim().length >= 3 && minutesOk(f.startMinute, f.endMinute) && (f.format === 'online' || f.address.trim() || (f.addressDetails ?? '').trim()) && (cap === null || (n >= 1 && n <= cap)) && (n === 0 || n >= taken);

  const save = async () => {
    setErrors({});
    const r = await update({
      id: e.id,
      title: f.title.trim(),
      slug: f.slug,
      kind: f.kind,
      price: f.kind === 'paid' ? Number(f.price) || null : null,
      currency: f.kind === 'paid' ? f.currency || null : null,
      description: f.description || null,
      date: f.date,
      startMinute: f.startMinute,
      timeZone: f.timeZone,
      endMinute: f.endMinute,
      format: f.format,
      address: f.format === 'onsite' ? f.address : null,
      addressDetails: f.format === 'onsite' ? (f.addressDetails ?? '').trim() || null : null,
      latitude: f.format === 'onsite' ? (f.latitude ?? null) : null,
      longitude: f.format === 'onsite' ? (f.longitude ?? null) : null,
      meetingUrl: f.format === 'online' ? f.meetingUrl || null : null,
      capacity: f.capacity === '' ? null : n,
      published: f.published,
      registerLabel: f.registerLabel.trim() || null,
      ...(voucher ? { voucherCode: voucher.code } : {}),
    });
    if (r.error) {
      setErrors(r.error.fields ?? {});
      return toast.error(r.error.message);
    }
    setVoucher(null);
    toast.success(r.data.emailed ? `Saved. The new link was emailed to ${r.data.emailed} attendee${r.data.emailed === 1 ? '' : 's'}.` : 'Event saved');
  };

  // Grouped by importance, one sub-tab each; one save bar for the whole form.
  const SECTIONS = [
    ['essentials', 'Essentials'],
    ['payment', 'Price & payment'],
    ['page', 'Event page'],
    ['participants', 'Participants'],
    ...(canEdit ? [['delete', 'Delete']] : []),
  ];
  const FIELD_SECTION = { title: 'essentials', date: 'essentials', endMinute: 'essentials', startMinute: 'essentials', timeZone: 'essentials', address: 'essentials', longitude: 'essentials', meetingUrl: 'essentials', published: 'essentials', kind: 'payment', price: 'payment', currency: 'payment', slug: 'page', description: 'page', registerLabel: 'page', capacity: 'participants', voucherCode: 'participants' };
  const saveAndShow = async () => {
    const before = Object.keys(errors);
    await save();
    void before;
  };
  useEffect(() => {
    const first = Object.keys(errors).map((k) => FIELD_SECTION[k]).find(Boolean);
    if (first) setSection(first);
  }, [errors]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <fieldset disabled={!canEdit} className="flex flex-col gap-4">
      {canEdit && (
        <div className={cx('sticky top-16 z-10 flex flex-wrap items-center justify-between gap-3 rounded-card border px-4 py-2.5 shadow-sm transition-colors', dirty ? 'border-warn/60 bg-warn/10' : 'border-line bg-surface')}>
          <p className="text-sm">{dirty ? <strong className="text-ink">Unsaved changes</strong> : <span className="text-muted">All changes saved</span>}{dirty && !ok && <span className="ml-2 text-danger">· something needs fixing</span>}</p>
          <div className="flex gap-2">
            {dirty && (
              <Button size="sm" variant="ghost" onClick={() => (setF(initial()), setVoucher(null), setErrors({}))}>
                Discard
              </Button>
            )}
            <Button size="sm" onClick={saveAndShow} loading={state.isLoading} disabled={!dirty || !ok}>
              Save
            </Button>
          </div>
        </div>
      )}

      <PriorityTabs label="Event details" value={section} onChange={setSection} tabs={SECTIONS} />

      {section === 'essentials' && (
        <Card title="Essentials" description="What it is, when and where. The event page and emails use these. Publish or unpublish it with the button at the top of the page.">
          <div className="grid gap-4 desktop:grid-cols-2">
            <Field label="Event name" error={errors.title} className="desktop:col-span-2">{(a) => <Input {...a} value={f.title} onChange={(x) => set({ title: x.target.value })} />}</Field>
            <Field label="Date" error={errors.date}>{(a) => <DatePicker {...a} value={f.date} onChange={(date) => set({ date })} />}</Field>
            <div className="flex gap-3">
              <Field label="Starts">{(a) => <TimePicker {...a} className="w-36" value={f.startMinute} onChange={(m) => set({ startMinute: m })} />}</Field>
              <Field label="Ends" error={errors.endMinute || (!minutesOk(f.startMinute, f.endMinute) ? 'After the start.' : undefined)}>{(a) => <TimePicker {...a} className="w-36" value={f.endMinute} onChange={(m) => set({ endMinute: m })} />}</Field>
            </div>
          </div>
          <div className="mt-4 max-w-md">
            <TimeZoneField value={f.timeZone} onChange={(timeZone) => set({ timeZone })} hint="Changing it keeps the same date and times, in the new zone. Attendees aren’t emailed about time changes: let them know yourself." />
          </div>
          <div className="mt-5 flex flex-col gap-4">
            <Choice
              label="Onsite or online"
              value={f.format}
              onChange={(format) => set({ format })}
              options={[
                ['onsite', 'Onsite', 'At an address.', ICONS.pin],
                ['online', 'Online', 'A webinar or video call.', ICONS.video],
              ]}
            />
            {f.format === 'onsite' ? (
              <Location f={f} set={set} error={errors.address || errors.longitude} />
            ) : (
              <Field label="Meeting link" hint="When you add or change it, everyone registered gets it by email." error={errors.meetingUrl}>
                {(a) => <Input {...a} type="url" value={f.meetingUrl} placeholder="https://" onChange={(x) => set({ meetingUrl: x.target.value })} />}
              </Field>
            )}
          </div>
        </Card>
      )}

      {section === 'payment' && (
        <>
          <Card title="Price" description="Free to attend, or paid (attendees pay you and upload a proof of payment).">
            <div className="flex flex-col gap-4">
              <Field label="Type" hint={hasTickets ? 'Fixed once people have registered.' : undefined}>
                {() => (
                  <fieldset disabled={hasTickets}>
                    <Choice
                      label="Free or paid"
                      value={f.kind}
                      onChange={(kind) => set({ kind })}
                      options={[
                        ['free', 'Free', 'Anyone registers on the page.', ICONS.users],
                        ['paid', 'Paid', 'Attendees pay you and upload a proof of payment.', ICONS.tag],
                      ]}
                    />
                  </fieldset>
                )}
              </Field>
              {f.kind === 'paid' && (
                <Field label="Amount attendees pay" hint={Number(f.price) > 0 && f.currency ? `Shown on the event page as ${fmtMoney(Number(f.price), f.currency)}.` : 'Required for a paid event.'} error={errors.price || errors.currency}>
                  {(a) => <MoneyField id={a.id} amount={f.price} currency={f.currency} onAmount={(v) => set({ price: v })} onCurrency={(v) => set({ currency: v ?? '' })} invalid={!!(errors.price || errors.currency)} />}
                </Field>
              )}
            </div>
          </Card>
          {e.kind === 'paid' ? <PaymentChannelsCard e={e} channels={channels} canEdit={canEdit} /> : f.kind === 'paid' && <Notice tone="info" title="Save first">Save the event as paid, then add its payment channels here.</Notice>}
        </>
      )}

      {section === 'page' && (
        <>
          <Card title="Event page" description="What people see when they open the event link.">
            <div className="flex flex-col gap-4">
              <Field label="Description">{() => <RichText value={f.description} onChange={(description) => set({ description })} />}</Field>
              <div className="grid gap-4 desktop:grid-cols-2">
                <Field label="Register button text" hint={`Empty: “${f.kind === 'paid' ? 'Register' : 'Register for free'}”.`}>
                  {(a) => <Input {...a} value={f.registerLabel} maxLength={40} onChange={(x) => set({ registerLabel: x.target.value })} />}
                </Field>
                <Field label="Event link" hint={`…/e/${f.slug || 'event-name'}. Changing it breaks links already shared.`} error={errors.slug}>
                  {(a) => <Input {...a} value={f.slug} onChange={(x) => set({ slug: slugify(x.target.value).slice(0, 60) })} />}
                </Field>
              </div>
            </div>
          </Card>
          <EventMediaCard e={e} canEdit={canEdit} />
        </>
      )}

      {section === 'participants' && (
        <Card title="Participants" description={taken ? `${taken} spot${taken === 1 ? '' : 's'} taken: the limit can’t go below that.` : 'How many people can register.'}>
          <Participants value={f.capacity} onChange={(capacity) => set({ capacity })} planCap={limits.participants} granted={e.participantLimit} voucher={voucher} onVoucher={setVoucher} />
          {errors.capacity && <p className="mt-2 text-[13px] text-danger">{errors.capacity}</p>}
          {n > 0 && n < taken && <p className="mt-2 text-[13px] text-danger">At least {taken}: that many spots are taken.</p>}
        </Card>
      )}

      {section === 'delete' && canEdit && (
        <Card title="Delete event" description="Deletes the whole event: its page, registrations, scanners, claimables and files. We email you a code to confirm. Export it first if you need a copy.">
          <Button variant="danger" onClick={() => setDeleting(true)}>
            Delete event…
          </Button>
        </Card>
      )}
      {deleting && <DeleteEventDialog e={e} taken={taken} onClose={() => setDeleting(false)} />}
    </fieldset>
  );
}

// ---- Paid events: payment channels (Details tab) ----

const MAX_CHANNELS = 4;

/** Up to 4 ways to pay, shown on the registration form: a QR code image or bank details. */
function PaymentChannelsCard({ e, channels, canEdit }) {
  const [del] = useDeletePaymentChannelMutation();
  const confirm = useConfirm();
  const [editing, setEditing] = useState(null); // null | 'new' | channel
  return (
    <Card
      title="Payment channels"
      description={`How attendees pay: up to ${MAX_CHANNELS} QR codes or bank accounts, shown on the registration form. Attendees then upload their proof of payment for you to verify.`}
      actions={
        canEdit &&
        channels.length < MAX_CHANNELS && (
          <Button size="sm" variant="secondary" onClick={() => setEditing('new')}>
            Add payment channel
          </Button>
        )
      }
    >
      {!channels.length ? (
        <p className="rounded-card border border-dashed border-line-strong px-4 py-6 text-center text-sm text-muted">No payment channels yet. Add a QR code (GCash, Maya, a bank QR…) or bank details.</p>
      ) : (
        <ul className="grid gap-3 desktop:grid-cols-2">
          {channels.map((c) => (
            <li key={c.id} className="flex gap-3 rounded-card border border-line p-3">
              {c.type === 'qr' && c.qrUrl ? (
                <img src={c.qrUrl} alt={`${c.label} QR code`} className="size-20 shrink-0 rounded-lg border border-line bg-white object-contain p-1" />
              ) : (
                <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">
                  <Icon d="M3 10l9-6 9 6M5 10v8M19 10v8M9 10v8M15 10v8M3 20h18" className="size-6" />
                </span>
              )}
              <div className="min-w-0 flex-1 text-sm">
                <p className="flex items-center gap-1.5 font-semibold">
                  {c.label} <Badge>{c.type === 'qr' ? 'QR code' : 'Bank'}</Badge>
                </p>
                {c.bankName && <p className="text-muted">{c.bankName}</p>}
                {c.accountName && <p className="text-muted">{c.accountName}</p>}
                {c.accountNumber && <p className="font-mono text-[13px] text-ink">{c.accountNumber}</p>}
              </div>
              {canEdit && (
                <div className="flex shrink-0 flex-col gap-0.5">
                  <IconButton icon={ICONS.pencil} label={`Edit ${c.label}`} onClick={() => setEditing(c)} />
                  <IconButton
                    icon={ICONS.trash}
                    tone="danger"
                    label={`Delete ${c.label}`}
                    onClick={async () => {
                      if (!(await confirm({ title: `Delete “${c.label}”?`, body: 'It’s no longer shown on the registration form.', action: 'Delete' }))) return;
                      const r = await del({ id: e.id, channelId: c.id });
                      if (r.error) toast.error(r.error.message);
                      else toast.success('Payment channel deleted');
                    }}
                  />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {editing && <ChannelDialog e={e} channel={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </Card>
  );
}

function ChannelDialog({ e, channel, onClose }) {
  const [add, addState] = useAddPaymentChannelMutation();
  const [update, updateState] = useUpdatePaymentChannelMutation();
  const [f, setF] = useState(() => ({ type: channel?.type ?? 'qr', label: channel?.label ?? '', bankName: channel?.bankName ?? '', accountName: channel?.accountName ?? '', accountNumber: channel?.accountNumber ?? '' }));
  const [file, setFile] = useState(null);
  const [errors, setErrors] = useState({});
  const [preparing, setPreparing] = useState(false);
  const set = (patch) => setF((x) => ({ ...x, ...patch }));
  const busy = preparing || addState.isLoading || updateState.isLoading;
  const needsFile = f.type === 'qr' && !(channel?.type === 'qr' && channel.qrUrl);
  const ok = f.label.trim() && (f.type === 'qr' ? !needsFile || (file && !fileProblem(file, { pdf: false })) : f.bankName.trim() && f.accountName.trim() && f.accountNumber.trim());

  const save = async (ev) => {
    ev?.preventDefault();
    setErrors({});
    const form = new FormData();
    form.append('type', f.type);
    form.append('label', f.label.trim());
    if (f.type === 'bank') form.append('bankName', f.bankName.trim());
    form.append('accountName', f.accountName.trim());
    form.append('accountNumber', f.accountNumber.trim());
    if (f.type === 'qr' && file) {
      setPreparing(true);
      // QR codes stay sharp enough to scan.
      const up = await compressImage(file, { maxSide: 1200, quality: 0.9 });
      setPreparing(false);
      form.append('file', up, up.name);
    }
    const r = channel ? await update({ id: e.id, channelId: channel.id, form }) : await add({ id: e.id, form });
    if (r.error) {
      setErrors(r.error.fields ?? {});
      return toast.error(r.error.message);
    }
    toast.success(channel ? 'Payment channel saved' : 'Payment channel added');
    onClose();
  };

  return (
    <Dialog
      open
      onClose={onClose}
      busy={busy}
      title={channel ? `Edit “${channel.label}”` : 'Add a payment channel'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="channel-form" loading={busy} disabled={!ok}>
            {channel ? 'Save' : 'Add'}
          </Button>
        </>
      }
    >
      <form id="channel-form" onSubmit={save} className="flex flex-col gap-4" noValidate>
        <div className="flex gap-1 rounded-btn bg-sunken p-1" role="tablist" aria-label="Type">
          {[
            ['qr', 'QR code'],
            ['bank', 'Bank details'],
          ].map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={f.type === k} onClick={() => set({ type: k })} className={`flex-1 cursor-pointer rounded-md px-3 py-1.5 text-sm font-medium ${f.type === k ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'}`}>
              {l}
            </button>
          ))}
        </div>
        <Field label="Name" hint={f.type === 'qr' ? 'E.g. GCash, Maya, InstaPay QR.' : 'E.g. BDO savings.'} error={errors.label}>
          {(a) => <Input {...a} value={f.label} maxLength={60} onChange={(x) => set({ label: x.target.value })} />}
        </Field>
        {f.type === 'qr' ? (
          <>
            <div>
              <p className="mb-1.5 text-sm font-medium">QR code image</p>
              {channel?.type === 'qr' && channel.qrUrl && !file && <img src={channel.qrUrl} alt="Current QR code" className="mb-2 size-32 rounded-lg border border-line bg-white object-contain p-1" />}
              <FilePicker
                id="qr-file"
                accept={IMAGE_ACCEPT}
                file={file}
                onChange={(x) => {
                  setErrors((er) => ({ ...er, file: x ? fileProblem(x, { pdf: false }) : undefined }));
                  setFile(x);
                }}
                error={errors.file}
                label={channel?.qrUrl ? 'Replace the QR image' : 'Upload the QR image'}
                hint={`JPG, PNG or WebP · up to ${MAX_UPLOAD_MB} MB`}
                disabled={busy}
              />
            </div>
            <div className="grid gap-3 desktop:grid-cols-2">
              <Field label="Account name (optional)" error={errors.accountName}>
                {(a) => <Input {...a} value={f.accountName} maxLength={120} onChange={(x) => set({ accountName: x.target.value })} />}
              </Field>
              <Field label="Number (optional)" hint="E.g. the GCash number." error={errors.accountNumber}>
                {(a) => <Input {...a} value={f.accountNumber} maxLength={60} onChange={(x) => set({ accountNumber: x.target.value })} />}
              </Field>
            </div>
          </>
        ) : (
          <div className="grid gap-3">
            <Field label="Bank name" error={errors.bankName}>
              {(a) => <Input {...a} value={f.bankName} maxLength={100} onChange={(x) => set({ bankName: x.target.value })} />}
            </Field>
            <Field label="Account name" error={errors.accountName}>
              {(a) => <Input {...a} value={f.accountName} maxLength={120} onChange={(x) => set({ accountName: x.target.value })} />}
            </Field>
            <Field label="Account number" error={errors.accountNumber}>
              {(a) => <Input {...a} value={f.accountNumber} maxLength={60} inputMode="numeric" className="font-mono" onChange={(x) => set({ accountNumber: x.target.value })} />}
            </Field>
          </div>
        )}
      </form>
    </Dialog>
  );
}

/** "Access the event": open the event page in a new tab, or copy its link. */
function AccessEventMenu({ link }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (ev) => !ref.current?.contains(ev.target) && setOpen(false);
    const esc = (ev) => ev.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <Button variant="secondary" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Icon d={ICONS.external} className="size-4" /> Access the event
        <Icon d="M6 9l6 6 6-6" className="size-4" />
      </Button>
      {open && (
        <div className="absolute right-0 z-30 mt-1.5 w-64 rounded-xl border border-line bg-surface p-1.5 shadow-lg" role="menu">
          <a href={link} target="_blank" rel="noreferrer" role="menuitem" onClick={() => setOpen(false)} className="flex items-start gap-3 rounded-lg px-3 py-2 hover:bg-sunken">
            <Icon d={ICONS.external} className="mt-0.5 size-4 shrink-0 text-brand" />
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-ink">Open the event link</span>
              <span className="block truncate text-xs text-muted">{link.replace(/^https?:\/\//, '')}</span>
            </span>
          </a>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              copy(link);
              setOpen(false);
            }}
            className="flex w-full cursor-pointer items-start gap-3 rounded-lg px-3 py-2 text-left hover:bg-sunken"
          >
            <Icon d="M8 8h11v11H8zM5 16H4V5h11v1" className="mt-0.5 size-4 shrink-0 text-brand" />
            <span className="block text-sm font-semibold text-ink">Copy the event link</span>
          </button>
        </div>
      )}
    </div>
  );
}

/** The Scanner button: straight to attendance, or (with claimables) a choice of which scanner to open. */
function ScannerMenu({ e, claimables }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (ev) => !ref.current?.contains(ev.target) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const base = `${bookingsBase}/events/${e.id}/scan`;
  if (!claimables.length) {
    return (
      <LinkButton href={base} variant="primary">
        <Icon d={ICONS.qr} className="size-4" /> Scanner
      </LinkButton>
    );
  }
  const item = (href, title, hint, icon) => (
    <a href={href} onClick={() => setOpen(false)} className="flex items-start gap-3 rounded-lg px-3 py-2 hover:bg-sunken">
      <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand">
        <Icon d={icon} className="size-4" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-ink">{title}</span>
        <span className="block text-xs text-muted">{hint}</span>
      </span>
    </a>
  );
  return (
    <div className="relative" ref={ref}>
      <Button variant="primary" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((o) => !o)}>
        <Icon d={ICONS.qr} className="size-4" /> Scanner
        <Icon d="M6 9l6 6 6-6" className="size-4" />
      </Button>
      {open && (
        <div className="absolute right-0 z-30 mt-1.5 w-72 rounded-xl border border-line bg-surface p-1.5 shadow-lg" role="menu">
          <p className="px-3 pt-1.5 pb-1 text-xs font-semibold tracking-wide text-faint uppercase">Which scanner?</p>
          {item(`${base}?for=attendance`, 'Attendance', 'Check people in at the entrance.', ICONS.users)}
          {claimables.map((k) => item(`${base}?for=${k.id}`, k.name, `Hand out ${k.name}: once per checked-in attendee.`, ICONS.tag))}
        </div>
      )}
    </div>
  );
}

/** Excel (Details, Attendees, Claimables, Scanners tabs), CSV (attendees), JSON (everything), or all of it zipped with the proofs of payment. */
function ExportMenu({ id }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (ev) => !ref.current?.contains(ev.target) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const item = (href, title, hint) => (
    <a href={href} download onClick={() => setOpen(false)} className="flex flex-col rounded-lg px-3 py-2 hover:bg-sunken">
      <span className="text-sm font-semibold text-ink">{title}</span>
      <span className="text-xs text-muted">{hint}</span>
    </a>
  );
  return (
    <div className="relative" ref={ref}>
      <Button variant="secondary" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        Export
        <Icon d="M6 9l6 6 6-6" className="size-4" />
      </Button>
      {open && (
        <div className="absolute right-0 z-30 mt-1.5 w-64 rounded-xl border border-line bg-surface p-1.5 shadow-lg">
          {item(`/api/client/bookings/events/${id}/export.xlsx`, 'Excel (.xlsx)', 'Tabs: Details, Attendees, Claimables, Scanners')}
          {item(`/api/client/bookings/events/${id}/export.csv`, 'CSV', 'The attendees')}
          {item(`/api/client/bookings/events/${id}/export.json`, 'JSON', 'Everything, structured (for other apps)')}
          {item(`/api/client/bookings/events/${id}/export.zip`, 'Zipped (.zip)', 'All of the above + proofs of payment, a folder per attendee')}
        </div>
      )}
    </div>
  );
}

/** Deleting the whole event: a code is emailed to you, then entered here. */
function DeleteEventDialog({ e, taken, onClose }) {
  const [ask, askState] = useRequestEventDeleteMutation();
  const [remove, removeState] = useDeleteEventMutation();
  const [sent, setSent] = useState(null); // { sentTo, registrations, minutes }
  const [code, setCode] = useState('');
  const [notify, setNotify] = useState(true);
  const [error, setError] = useState('');
  const over = new Date(e.endsAt) <= new Date();

  const sendCode = async () => {
    setError('');
    const r = await ask(e.id);
    if (r.error) return setError(r.error.message);
    setSent(r.data);
    setCode('');
  };
  const doDelete = async (ev) => {
    ev?.preventDefault();
    setError('');
    const r = await remove({ id: e.id, code, notifyAttendees: notify });
    if (r.error) return setError(r.error.fields?.code || r.error.message);
    toast.success(r.data.notified ? `Event deleted. ${r.data.notified} attendee${r.data.notified === 1 ? ' was' : 's were'} emailed.` : 'Event deleted');
    navigate(`${bookingsBase}/events`);
  };

  return (
    <Dialog
      open
      onClose={onClose}
      busy={removeState.isLoading}
      title={`Delete “${e.title}”?`}
      footer={
        sent ? (
          <>
            <Button variant="ghost" onClick={onClose}>
              Keep the event
            </Button>
            <Button variant="danger" type="submit" form="delete-event" loading={removeState.isLoading} disabled={code.length !== 6}>
              Delete event
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="danger" onClick={sendCode} loading={askState.isLoading}>
              Email me a code
            </Button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-4">
        <Notice tone="danger" title="This can’t be undone">
          The event page stops working, and its {taken ? `${taken} registration${taken === 1 ? '' : 's'}, ` : ''}scanners, claimables and claims are deleted. Export it first if you need a copy.
        </Notice>
        {taken > 0 && !over && <Checkbox label="Email registered attendees that the event is cancelled" checked={notify} onChange={(x) => setNotify(x.target.checked)} />}
        {sent ? (
          <form id="delete-event" onSubmit={doDelete} noValidate>
            <Field label={`Code sent to ${sent.sentTo}`} hint={`It expires in ${sent.minutes} minutes.`} error={error}>
              {(a) => (
                <Input
                  {...a}
                  autoFocus
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={code}
                  onChange={(x) => setCode(x.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  className="max-w-48 text-center font-mono text-2xl tracking-[0.4em]"
                />
              )}
            </Field>
            <button type="button" onClick={sendCode} disabled={askState.isLoading} className="mt-2 cursor-pointer text-xs font-medium text-brand underline">
              Send a new code
            </button>
          </form>
        ) : (
          <>
            <p className="text-sm text-muted">To make sure it’s really you, we’ll email you a 6-digit code to enter here.</p>
            {error && <p className="text-sm text-danger">{error}</p>}
          </>
        )}
      </div>
    </Dialog>
  );
}

// ---- Attendance scanners (onsite events) ----

const SCANNER_STATUS = { waiting: ['warn', 'Not signed in yet'], in_use: ['ok', 'Signed in'], revoked: ['danger', 'Access revoked'] };

/**
 * Event scanners, in sections: Attendance (always) and claimables (things attendees can claim,
 * e.g. Free Water), each a card with its own scanners. A scanner's role is its section's name.
 */
function Scanners({ e, canEdit, tz }) {
  const q = useEventScannersQuery(e.id);
  const [addClaimable] = useAddClaimableMutation();
  const prompt = usePrompt();
  const [adding, setAdding] = useState(null); // the section a scanner is being added to
  const [shown, setShown] = useState(null); // { scanner, accessCode, fresh }
  if (q.isLoading) return <Loading />;
  const { sections = [], claimableLimit } = q.data ?? {};
  const claimables = sections.filter((s) => s.kind === 'claimable');
  const canAddClaimable = claimableLimit === null || claimableLimit === undefined || claimables.length < claimableLimit;

  const newClaimable = async () => {
    const name = await prompt({ title: 'Add a claimable', label: 'What can attendees claim?', hint: 'E.g. Free Water, Snack, T-shirt. Each attendee can claim it once.', action: 'Add claimable' });
    if (!name) return;
    const r = await addClaimable({ id: e.id, name });
    if (r.error) return toast.error(r.error.message);
    toast.success(`“${name}” added. Now add its scanners.`);
  };

  return (
    <div className="flex flex-col gap-5">
      <Notice tone="info" title="Event scanners">
        People who scan attendees’ QR codes on their own phone. Attendance scanners check people in; claimable scanners hand out things like free water, once per attendee. Each scanner gets a scanner code and an access code by email, for one device.
      </Notice>

      {sections.map((section) => (
        <ScannerSection key={section.id ?? 'attendance'} e={e} section={section} canEdit={canEdit} tz={tz} onAdd={() => setAdding(section)} onCodes={setShown} />
      ))}

      {canEdit && (
        <div className="flex flex-wrap items-center gap-3 rounded-card border-2 border-dashed border-line-strong bg-surface px-4 py-4">
          <span className="grid size-10 place-items-center rounded-xl bg-sunken text-muted">
            <Icon d={ICONS.tag} className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">Claimables</p>
            <p className="text-sm text-muted">
              {claimables.length}
              {claimableLimit ? ` of ${claimableLimit}` : ''} used on your plan. Free water, snacks, kits: each with its own scanners.
            </p>
          </div>
          <Button variant="secondary" disabled={!canAddClaimable} onClick={newClaimable} title={canAddClaimable ? undefined : 'Your plan’s limit is reached'}>
            + Add claimable
          </Button>
        </div>
      )}

      {adding && <AddScannerDialog e={e} section={adding} onClose={() => setAdding(null)} onCreated={(data) => (setAdding(null), setShown({ ...data, fresh: true }))} />}
      {shown && <ScannerCodesDialog shown={shown} onClose={() => setShown(null)} />}
    </div>
  );
}

/** One section card: Attendance, or a claimable (rename, delete, how many claimed). */
function ScannerSection({ e, section, canEdit, tz, onAdd, onCodes }) {
  const [newCode] = useNewScannerCodeMutation();
  const [revoke] = useRevokeScannerCodeMutation();
  const [remove] = useDeleteEventScannerMutation();
  const [rename] = useRenameClaimableMutation();
  const [removeClaimable] = useDeleteClaimableMutation();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const attendance = section.kind === 'attendance';
  const full = section.limit !== null && section.limit !== undefined && section.scanners.length >= section.limit;

  return (
    <section className="overflow-hidden rounded-card border border-line bg-surface">
      <header className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
        <span className={cx('grid size-10 shrink-0 place-items-center rounded-xl', attendance ? 'bg-brand text-brand-ink' : 'bg-brand-soft text-brand')}>
          <Icon d={attendance ? ICONS.check : ICONS.tag} className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-semibold">{section.name}</h2>
          <p className="text-xs text-muted">
            {attendance ? 'Checks attendees in' : `Claimable · ${section.claimed} claimed`} · {section.scanners.length}
            {section.limit ? ` of ${section.limit}` : ''} scanners
          </p>
        </div>
        {canEdit && !attendance && (
          <div className="flex items-center gap-0.5">
            <IconButton
              icon={ICONS.pencil}
              label={`Rename ${section.name}`}
              onClick={async () => {
                const name = await prompt({ title: 'Rename claimable', label: 'Name', value: section.name, action: 'Save' });
                if (!name || name === section.name) return;
                const r = await rename({ id: e.id, claimableId: section.id, name });
                if (r.error) toast.error(r.error.message);
              }}
            />
            <IconButton
              icon={ICONS.trash}
              tone="danger"
              label={`Delete ${section.name}`}
              onClick={async () => {
                if (!(await confirm({ title: `Delete “${section.name}”?`, body: `Its ${section.scanners.length} scanner(s) are signed out and deleted, and its ${section.claimed} claim(s) are removed.`, action: 'Delete claimable' }))) return;
                const r = await removeClaimable({ id: e.id, claimableId: section.id });
                if (r.error) toast.error(r.error.message);
                else toast.success(`“${section.name}” deleted`);
              }}
            />
          </div>
        )}
        {canEdit && (
          <Button size="sm" onClick={onAdd} disabled={full} title={full ? `${section.limit} scanners at most` : undefined}>
            + Add scanner
          </Button>
        )}
      </header>
      {!section.scanners.length ? (
        <p className="px-4 py-6 text-center text-sm text-faint">No scanners yet.</p>
      ) : (
        <ul className="divide-y divide-line">
          {section.scanners.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-sunken text-sm font-semibold text-muted">{(s.firstName[0] ?? '') + (s.lastName[0] ?? '')}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{s.name}</p>
                <p className="truncate text-xs text-faint">
                  {s.email}
                  {s.lastSeenAt && s.status === 'in_use' ? ` · active ${fmtTime(s.lastSeenAt, tz)}` : ''}
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                <CodeChip label="Scanner" code={s.scannerCode} />
                {s.accessCode ? (
                  <CodeChip label="Access" code={s.accessCode} strong />
                ) : (
                  !s.accessCodeHidden && <span className="rounded-md bg-sunken px-2 py-1 text-xs text-faint">{s.status === 'revoked' ? 'Access revoked' : 'Access code: make a new one to see it'}</span>
                )}
              </div>
              <Badge tone={SCANNER_STATUS[s.status][0]}>{SCANNER_STATUS[s.status][1]}</Badge>
              <div className="flex items-center gap-0.5">
                <IconButton icon={ICONS.external} label="Copy the scanner link" onClick={() => copy(s.url, 'Scanner link')} />
                {canEdit && (
                  <>
                    <IconButton
                      icon={ICONS.undo}
                      label="New access code (emailed)"
                      onClick={async () => {
                        if (s.status !== 'revoked' && !(await confirm({ title: `New access code for ${s.name}?`, body: 'The current code stops working, their device is signed out, and the new code is emailed to them.', action: 'Make new code', tone: 'neutral' }))) return;
                        const r = await newCode({ id: e.id, scannerId: s.id });
                        if (r.error) return toast.error(r.error.message);
                        onCodes({ ...r.data, fresh: false });
                      }}
                    />
                    {s.status !== 'revoked' && (
                      <IconButton
                        icon={ICONS.xCircle}
                        tone="danger"
                        label="Revoke access"
                        onClick={async () => {
                          if (!(await confirm({ title: `Revoke ${s.name}’s access?`, body: 'They’re signed out now and can’t sign in again until you make a new access code.', action: 'Revoke access' }))) return;
                          const r = await revoke({ id: e.id, scannerId: s.id });
                          if (r.error) toast.error(r.error.message);
                          else toast.success('Access revoked. They were signed out.');
                        }}
                      />
                    )}
                    <IconButton
                      icon={ICONS.trash}
                      tone="danger"
                      label="Delete scanner"
                      onClick={async () => {
                        if (!(await confirm({ title: `Delete ${s.name}’s scanner?`, body: 'They’re signed out and the scanner code stops working.', action: 'Delete scanner' }))) return;
                        const r = await remove({ id: e.id, scannerId: s.id });
                        if (r.error) toast.error(r.error.message);
                        else toast.success('Scanner deleted');
                      }}
                    />
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** A code with its label, copied on click. */
function CodeChip({ label, code, strong = false }) {
  return (
    <button
      type="button"
      onClick={() => copy(code, `${label} code`)}
      title={`Copy the ${label.toLowerCase()} code`}
      className={cx('inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition hover:border-brand', strong ? 'border-brand/30 bg-brand-soft text-brand' : 'border-line bg-sunken text-muted')}
    >
      <span className="font-semibold tracking-wide uppercase">{label}</span>
      <span className="font-mono text-[13px] font-bold tracking-wider">{code}</span>
    </button>
  );
}

/** The Add scanner modal: first and last name and email (the role is the section). */
function AddScannerDialog({ e, section, onClose, onCreated }) {
  const [create, state] = useCreateEventScannerMutation();
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '' });
  const [errors, setErrors] = useState({});
  const dirty = !!(form.firstName || form.lastName || form.email);
  const valid = form.firstName.trim() && form.lastName.trim() && /^\S+@\S+\.\S+$/.test(form.email.trim());
  const submit = async (ev) => {
    ev?.preventDefault();
    if (!valid) return;
    setErrors({});
    const r = await create({ id: e.id, firstName: form.firstName, lastName: form.lastName, email: form.email, claimableId: section.id ?? null });
    if (r.error) {
      setErrors(r.error.fields ?? {});
      return toast.error(r.error.message);
    }
    onCreated(r.data);
  };
  return (
    <Dialog
      open
      onClose={onClose}
      dirty={dirty}
      busy={state.isLoading}
      title={`Add a scanner: ${section.name}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="add-scanner" loading={state.isLoading} disabled={!valid}>
            Create and email the codes
          </Button>
        </>
      }
    >
      <form id="add-scanner" onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <p className="text-sm text-muted">
          They’ll scan for <strong>{section.name}</strong>
          {section.kind === 'attendance' ? ' (checking attendees in)' : ' (each attendee claims it once)'}. Their scanner code and access code are emailed to them.
        </p>
        <div className="grid gap-3 desktop:grid-cols-2">
          <Field label="First name" error={errors.firstName}>
            {(a) => <Input {...a} autoFocus required autoComplete="off" maxLength={60} value={form.firstName} onChange={(x) => setForm({ ...form, firstName: x.target.value })} />}
          </Field>
          <Field label="Last name" error={errors.lastName}>
            {(a) => <Input {...a} required autoComplete="off" maxLength={60} value={form.lastName} onChange={(x) => setForm({ ...form, lastName: x.target.value })} />}
          </Field>
        </div>
        <Field label="Email" hint="The codes are sent here." error={errors.email}>
          {(a) => <Input {...a} required type="email" autoComplete="off" maxLength={254} value={form.email} onChange={(x) => setForm({ ...form, email: x.target.value })} />}
        </Field>
      </form>
    </Dialog>
  );
}

function ScannerCodesDialog({ shown, onClose }) {
  const s = shown.scanner;
  return (
    <Dialog
      open
      onClose={onClose}
      title={shown.fresh ? 'Scanner ready' : 'New access code'}
      footer={
        <>
          <Button variant="secondary" onClick={() => copy(`${s.name} (${s.role})\nScanner site: ${s.signInUrl}\nScanner code: ${s.scannerCode}\nAccess code: ${shown.accessCode}\nOr open: ${s.url}`, 'Sign-in details')}>
            Copy all details
          </Button>
          <Button onClick={onClose}>Done</Button>
        </>
      }
    >
      {s.email && (
        <p className="mb-3 rounded-btn bg-ok-soft px-3 py-2 text-sm text-ok">
          Emailed to <strong>{s.email}</strong>.
        </p>
      )}
      <p className="text-sm text-muted">
        {s.name} scans for <strong>{s.role}</strong>. They sign in at <strong>{s.signInUrl.replace(/^https?:\/\//, '')}</strong> with both codes, or open their link and enter the access code.
      </p>
      <dl className="my-4 grid gap-3">
        <div className="rounded-xl bg-sunken px-4 py-3">
          <dt className="text-xs font-semibold tracking-wide text-faint uppercase">Scanner code</dt>
          <dd className="mt-0.5 font-mono text-2xl font-bold tracking-[0.25em]">{s.scannerCode}</dd>
        </div>
        <div className="rounded-xl border-2 border-dashed border-brand/40 px-4 py-3">
          <dt className="text-xs font-semibold tracking-wide text-faint uppercase">Access code</dt>
          <dd className="mt-0.5 font-mono text-2xl font-bold tracking-[0.25em] text-brand">{shown.accessCode}</dd>
        </div>
      </dl>
      <p className="text-xs text-faint">The access code is shown only now (and in their email), and works on one device.</p>
    </Dialog>
  );
}

// ---- This event's scanner (full screen) ----

export function EventScanPage({ id }) {
  const tz = useOverviewQuery().data?.timeZone;
  const q = useEventQuery(id);
  const [checkIn, checkState] = useEventCheckInMutation();
  const [claimHere, claimState] = useClaimHereMutation();
  const [undo] = useUndoEventCheckInMutation();
  const [unclaim] = useUnclaimHereMutation();
  const [result, setResult] = useState(null);
  // What this scanner does: attendance (null) or a claimable's id; the link may say (?for=…).
  const [mode, setMode] = useState(() => {
    const v = new URLSearchParams(window.location.search).get('for');
    return v && /^\d+$/.test(v) ? Number(v) : null;
  });
  const busy = useRef(false);
  const e = q.data?.event;
  const claimables = q.data?.claimables ?? [];
  const current = claimables.find((k) => k.id === mode) ?? null;
  const checked = q.data?.tickets.filter((t) => t.checkedInAt).length ?? 0;
  const confirmed = q.data?.tickets.filter((t) => t.status === 'confirmed').length ?? 0;
  const claimed = current ? (q.data?.tickets.filter((t) => (t.claims ?? []).some((c) => c.claimableId === current.id)).length ?? 0) : 0;
  const state = { isLoading: checkState.isLoading || claimState.isLoading };

  const submit = async (body) => {
    if (busy.current) return;
    busy.current = true;
    const r = current ? await claimHere({ id, claimableId: current.id, ...body }) : await checkIn({ id, ...body });
    busy.current = false;
    if (r.error) {
      setResult({ error: r.error.error, message: r.error.message, event: r.error.event });
      navigator.vibrate?.([60, 60, 60]);
    } else {
      setResult(r.data);
      navigator.vibrate?.(r.data.checkedIn || r.data.state === 'claimed' ? 80 : [60, 60, 60]);
    }
  };

  return (
    <div className="fixed inset-0 flex flex-col bg-[#0b0d12] text-white">
      <header className="relative z-10 flex items-center gap-3 px-4 py-3">
        <a href={`${bookingsBase}/events/${id}`} className="grid size-10 place-items-center rounded-full bg-white/10 hover:bg-white/20" aria-label="Close the scanner">
          <Icon d="M6 6l12 12M18 6L6 18" className="size-5" />
        </a>
        <div className="min-w-0 flex-1 text-center">
          <p className="truncate text-sm font-semibold">{e?.title ?? 'Event'}</p>
          <p className="text-xs text-white/60">{!e ? ' ' : current ? `${current.name} · ${claimed} claimed` : `${checked} of ${confirmed} checked in · this event only`}</p>
        </div>
        <ScanCodeButton onSubmit={(code) => submit({ code })} loading={state.isLoading} />
      </header>
      {claimables.length > 0 && (
        <div className="relative z-10 px-4 pb-3">
          <div className="flex gap-1 overflow-x-auto rounded-full bg-white/10 p-1" role="tablist" aria-label="Scanning for">
            {[{ id: null, name: 'Attendance' }, ...claimables].map((k) => (
              <button
                key={k.id ?? 'attendance'}
                type="button"
                role="tab"
                aria-selected={mode === k.id}
                onClick={() => (setMode(k.id), setResult(null))}
                className={`shrink-0 cursor-pointer rounded-full px-3.5 py-1.5 text-xs font-semibold whitespace-nowrap transition ${mode === k.id ? 'bg-white text-ink shadow' : 'text-white/70 hover:text-white'}`}
              >
                {k.name}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="relative min-h-0 flex-1">
        <Scanner autoStart paused={!!result || state.isLoading} onCode={(code) => submit({ code })} />
        {state.isLoading && (
          <div className="absolute inset-0 grid place-items-center bg-black/40">
            <Spinner className="size-8 text-white" />
          </div>
        )}
      </div>
      {!result && (
        <p className="px-6 pt-3 pb-[max(20px,env(safe-area-inset-bottom))] text-center text-sm text-white/70">
          {current ? `Scanning for ${current.name}: checked-in attendees can claim it once.` : 'Scanning attendance. Codes for other events or appointments won’t check in here.'}
        </p>
      )}
      {result && tz && (
        <div className="absolute inset-x-0 bottom-0 z-20 max-h-[85vh] overflow-y-auto rounded-t-3xl bg-canvas p-4 pb-[max(16px,env(safe-area-inset-bottom))] text-ink shadow-[0_-12px_40px_rgba(0,0,0,0.4)] motion-safe:animate-rise" aria-live="polite">
          <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-line-strong" aria-hidden="true" />
          <div className="mx-auto max-w-lg">
            {result.kind === 'claim' ? (
              <ClaimResult result={result} tz={e?.timeZone || tz} onNext={() => setResult(null)} onUndo={async (ticketId) => (await unclaim({ id, claimableId: current?.id, ticketId }), setResult(null))} />
            ) : (
              <EventResult result={result} event={e} tz={tz} onNext={() => setResult(null)} onForce={(ticketId) => submit({ ticketId, force: true })} onUndo={async (ticketId) => (await undo({ id, ticketId }), setResult(null))} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ScanCodeButton({ onSubmit, loading }) {
  const prompt = usePrompt();
  return (
    <button
      type="button"
      disabled={loading}
      onClick={async () => {
        const code = await prompt({ title: 'Type the code', label: 'Check-in code', hint: 'It’s under the QR code in their email, like ABCD-EFGH.', placeholder: 'ABCD-EFGH', action: 'Check in' });
        if (code) onSubmit(code);
      }}
      className="flex h-10 cursor-pointer items-center rounded-full bg-white/10 px-3.5 text-sm font-semibold hover:bg-white/20"
    >
      Type code
    </button>
  );
}

export function EventResult({ result, event, tz, onNext, onForce, onUndo }) {
  if (result.error) {
    const other = result.error === 'not_this_event';
    return (
      <ResultCard tone="danger" icon={ICONS.xCircle} title={other ? 'Not for this event' : result.error === 'not_found' ? 'No registration found' : 'That code doesn’t look right'} onNext={onNext}>
        <p className="text-sm">{result.message}</p>
        {other && result.event && <p className="text-sm">That event is on {fmtLongDate(result.event.date)}. This scanner only checks in “{event?.title}”.</p>}
      </ResultCard>
    );
  }
  const t = result.ticket;
  const who = (
    <div className="rounded-btn bg-surface/70 px-3 py-2.5 text-ink">
      <p className="font-semibold">{t.name}</p>
      <p className="text-sm text-muted">{t.email}</p>
      <p className="mt-0.5 font-mono text-xs tracking-wider text-faint">{t.code}</p>
    </div>
  );
  if (result.checkedIn) {
    return (
      <ResultCard tone="ok" icon={ICONS.check} title="Checked in" onNext={onNext}>
        {who}
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm">At {fmtTime(t.checkedInAt, tz)}.</span>
          <Button size="sm" variant="ghost" onClick={() => onUndo(t.id)}>
            Undo
          </Button>
        </div>
      </ResultCard>
    );
  }
  const anyway = (
    <Button size="sm" variant="secondary" onClick={() => onForce(t.id)}>
      Check in anyway
    </Button>
  );
  switch (result.state) {
    case 'already':
      return (
        <ResultCard tone="info" icon={ICONS.check} title="Already checked in" onNext={onNext}>
          {who}
          <p className="text-sm">Checked in at {fmtTime(t.checkedInAt, tz)}.</p>
        </ResultCard>
      );
    case 'cancelled':
      return (
        <ResultCard tone="danger" icon={ICONS.xCircle} title="Registration cancelled" onNext={onNext}>
          {who}
          <p className="text-sm">They cancelled their registration, so they can’t be checked in. They can register again on the event page if spots are left.</p>
        </ResultCard>
      );
    case 'revoked':
      return (
        <ResultCard tone="danger" icon={ICONS.xCircle} title="Registration revoked" onNext={onNext}>
          {who}
          <p className="text-sm">This registration was revoked{t.revokeReason ? `: “${t.revokeReason}”` : '.'} It can’t be checked in.</p>
        </ResultCard>
      );
    case 'unpaid':
      return (
        <ResultCard tone="warn" icon={ICONS.clock} title="Payment not confirmed yet" onNext={onNext}>
          {who}
          <p className="text-sm">{t.status === 'rejected' ? 'Their proof of payment was rejected and they haven’t sent a new one yet.' : 'Their proof of payment is still waiting to be verified.'} Approve it in the event’s Attendees tab first, then check them in.</p>
        </ResultCard>
      );
    case 'unclaimed':
      return (
        <ResultCard tone="warn" icon={ICONS.tag} title="Code not registered yet" onNext={onNext}>
          {who}
          <p className="text-sm">This paid code was given out but never used to register. If they’ve paid, check them in: it registers them too.</p>
          {anyway}
        </ResultCard>
      );
    case 'early':
    case 'over':
      return (
        <ResultCard tone="warn" icon={ICONS.calendar} title={result.state === 'early' ? 'The event isn’t today' : 'The event is over'} onNext={onNext}>
          {who}
          <p className="text-sm">
            “{event?.title}” is {result.state === 'early' ? 'on' : 'was on'} <strong>{fmtLongDate(result.eventDate)}</strong>. Events can’t be moved.
          </p>
          {anyway}
        </ResultCard>
      );
    default:
      return null;
  }
}

/** A claimable's scan: claimed now, already claimed (when, by whom), or not allowed. */
export function ClaimResult({ result, tz, onNext, onUndo }) {
  const t = result.ticket;
  const time = (iso) => new Intl.DateTimeFormat(undefined, { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
  const who = (
    <div className="rounded-btn bg-surface/70 px-3 py-2.5 text-ink">
      <p className="font-semibold">{t.name}</p>
      <p className="text-sm text-muted">{t.email}</p>
      <p className="mt-0.5 font-mono text-xs tracking-wider text-faint">{t.code}</p>
    </div>
  );
  if (result.state === 'claimed') {
    return (
      <ResultCard tone="ok" icon={ICONS.check} title={`Give them ${result.item}`} onNext={onNext}>
        {who}
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm">
            Claimed at {time(result.claimedAt)}.
          </span>
          <Button size="sm" variant="ghost" onClick={() => onUndo(t.id)}>
            Undo
          </Button>
        </div>
      </ResultCard>
    );
  }
  if (result.state === 'not_checked_in') {
    return (
      <ResultCard tone="warn" icon={ICONS.qr} title="Check in at the entrance first" onNext={onNext}>
        {who}
        <p className="text-sm">Their attendance hasn’t been scanned yet. Ask them to check in at the entrance, then scan again to give them {result.item}.</p>
      </ResultCard>
    );
  }
  if (result.state === 'already') {
    return (
      <ResultCard tone="warn" icon={ICONS.xCircle} title={`Already claimed ${result.item}`} onNext={onNext}>
        {who}
        <p className="text-sm">
          They got it {result.claimedAt ? `at ${time(result.claimedAt)}` : 'already'}
          {result.claimedBy ? `, from ${result.claimedBy}` : ''}. Each attendee can claim it once.
        </p>
      </ResultCard>
    );
  }
  return (
    <ResultCard tone="danger" icon={ICONS.xCircle} title={result.state === 'cancelled' ? 'Registration cancelled' : 'Registration revoked'} onNext={onNext}>
      {who}
      <p className="text-sm">This registration isn’t active, so they can’t claim {result.item}.</p>
    </ResultCard>
  );
}
