import { useEffect, useRef, useState } from 'react';
import { useCancelEventRegistrationMutation, useEventRegistrationQuery, usePublicEventQuery, useRegisterEventMutation, useLazyPromoQuoteQuery, usePublicRefundRequestQuery, useRegisterPaidEventMutation, useSubmitRefundDetailsMutation, useReuploadPaymentMutation, useUploadRequestQuery } from '../api.js';
import { FilePicker, PaymentChannelsView } from '../components/Payments.jsx';
import { fmtMoney } from '../components/Money.jsx';
import { compressImage, fileProblem, MAX_UPLOAD_MB, PROOF_ACCEPT } from '../lib/upload.js';
import { fmtLongDate, minuteLabel, zoneName } from '../lib/format.js';
import { Button, Field, Icon, ICONS, Input, Loading } from '../ui.jsx';
import { downloadPdf, downloadPng, drawTicket } from '../lib/ticket.js';
import { BrandFrame } from './PublicBooking.jsx';

// A public event page: /{business}/e/{event} (backend: booking/events.ts).
//   free  first and last name, email and phone (all required) -> registered: the QR code on screen and by email
//   paid  the same details and the number of spots -> "reserved" for 2 hours: pay through one of
//         the event's payment channels (QR codes, bank details), then upload the proof (image or
//         PDF) -> "being verified"; once the business approves it, the confirmation and QR code
//         come by email. The upload link (#upload=…, works once) is emailed too, in case the page
//         is closed. Full but not every spot verified yet: one person joins the waitlist (no
//         payment link until a reserved spot expires and is offered to them). Asked for another or
//         an additional proof: the email links back here (#upload=…, unique per request), 10 hours.
// No rescheduling or cancelling here: attendees contact the organizer.

const range = (a, b) => `${minuteLabel(a)} – ${minuteLabel(b >= 1440 ? 1439 : b)}`;

export function PublicEventPage({ slug, event }) {
  const q = usePublicEventQuery({ slug, event });
  /** The spots left right now (null: no limit), asked again just before saving. */
  const freshSpotsLeft = async () => {
    const r = await q.refetch();
    return r.data?.event?.spotsLeft ?? null;
  };
  const [done, setDone] = useState(null);
  // The attendee's private cancel link (free events): …/e/{event}#cancel={token}
  const [cancelToken] = useState(() => /^#cancel=([\d.a-f]+)$/.exec(window.location.hash)?.[1] ?? null);
  // The ticket from the confirmation email: …/e/{event}#ticket={token}[&download=png|pdf]
  const [ticketLink] = useState(() => {
    const m = /^#ticket=([\d.a-f]+)(?:&download=(png|pdf))?$/.exec(window.location.hash);
    return m ? { token: m[1], download: m[2] ?? null } : null;
  });
  // Register (the form) or the event's details: the focus is on registering.
  const [view, setView] = useState('register');
  // A refund request: where to send the attendee's refund: …/e/{event}#refund={id}.{secret}
  const [refundToken] = useState(() => /^#refund=(\d+\.[0-9a-f]{48})$/.exec(window.location.hash)?.[1] ?? null);
  // A proof the organizer asked for: …/e/{event}#upload={id}.{secret} (a new link per request)
  const [paymentToken] = useState(() => /^#upload=(\d+\.[0-9a-f]{48})$/.exec(window.location.hash)?.[1] ?? null);
  useEffect(() => {
    if (q.data) document.title = `${q.data.event.title} · ${q.data.business.name}`;
  }, [q.data]);

  if (q.isLoading) return <Loading screen />;
  if (q.error)
    return (
      <main className="grid min-h-screen place-items-center px-4">
        <div className="max-w-md rounded-card border border-line bg-surface p-8 text-center">
          <h1 className="text-xl font-semibold">This event isn’t available</h1>
          <p className="mt-2 text-sm text-muted">The link may be wrong, or registration has closed.</p>
        </div>
      </main>
    );
  const { business, branding, event: e, status, paymentChannels = [] } = q.data;
  const tz = business.timeZone;
  const d = new Date(`${e.date}T12:00:00Z`);
  const f = (o) => new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', ...o }).format(d);

  // When and where: always shown (above the tabs and the registration), the rest under Details.
  const whenWhere = (
      <div className="grid gap-4 border-b border-line px-5 py-4 desktop:grid-cols-2 mobile:px-4">
        <div className="flex items-start gap-3">
          <div className="w-14 shrink-0 overflow-hidden rounded-xl border border-line text-center" aria-hidden="true">
            <div className="bg-brand py-0.5 text-[10px] font-bold tracking-[0.12em] text-brand-ink uppercase">{f({ month: 'short' })}</div>
            <div className="py-1.5 text-2xl leading-none font-bold tabular-nums">{d.getUTCDate()}</div>
          </div>
          <div>
            <p className="font-semibold">{fmtLongDate(e.date)}</p>
            <p className="text-sm text-muted">
              {range(e.startMinute, e.endMinute)} {zoneName(e.timeZone || tz, new Date(e.startsAt))}
            </p>
          </div>
        </div>
        <div className="flex items-start gap-3">
          <span className="grid size-14 shrink-0 place-items-center rounded-xl bg-sunken text-brand">
            <Icon d={e.format === 'online' ? ICONS.video : ICONS.pin} className="size-6" />
          </span>
          <div className="min-w-0">
            <p className="font-semibold">{e.format === 'online' ? 'Online' : 'Onsite'}</p>
            {e.format === 'online' ? (
              <p className="text-sm text-muted">The link to join comes by email{e.hasLink ? '' : ' before the event'}.</p>
            ) : (
              <>
                {(e.address || e.latitude != null) && (
                  <a
                    className="text-sm text-brand underline"
                    href={`https://www.google.com/maps/search/?api=1&query=${e.latitude != null ? `${e.latitude},${e.longitude}` : encodeURIComponent(e.address)}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {e.address || 'Open in Google Maps'}
                  </a>
                )}
                {e.addressDetails && <p className="text-sm text-muted">{e.addressDetails}</p>}
              </>
            )}
          </div>
        </div>
      </div>
  );
  const details = e.description ? <div className="rich px-5 py-4 text-muted mobile:px-4" dangerouslySetInnerHTML={{ __html: e.description }} /> : <p className="px-5 py-4 text-sm text-faint mobile:px-4">No description.</p>;

  return (
    <BrandFrame branding={branding} name={business.name}>
      <article className="overflow-hidden rounded-card border border-line bg-surface">
        {e.coverUrl && (
          <div className="relative aspect-[3/1] bg-sunken mobile:aspect-[2/1]">
            <img src={e.coverUrl} alt="" className="size-full object-cover" />
          </div>
        )}
        <header className={`bg-brand-soft px-5 pt-4 pb-4 mobile:px-4 ${e.coverUrl && e.logoUrl ? 'pt-0' : ''}`}>
          <div className="flex items-end gap-3">
            {e.logoUrl && (
              <img src={e.logoUrl} alt={`${e.title} logo`} className={`size-16 shrink-0 rounded-2xl border-4 border-surface bg-surface object-contain shadow-sm ${e.coverUrl ? '-mt-8' : ''}`} />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-brand">{business.name}</p>
              <h1 className="mt-0.5 text-2xl leading-tight font-bold tracking-tight text-ink">{e.title}</h1>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <span className="rounded-full bg-surface px-2.5 py-1 text-xs font-semibold text-brand">{e.kind === 'paid' ? `Paid${e.priceLabel ? ` · ${e.priceLabel}` : ''}` : 'Free'}</span>
            <span className="rounded-full bg-surface px-2.5 py-1 text-xs font-semibold text-muted">
              {fmtLongDate(e.date)} · {range(e.startMinute, e.endMinute)}
            </span>
            <span className="rounded-full bg-surface px-2.5 py-1 text-xs font-semibold text-muted">{e.format === 'online' ? 'Online' : 'Onsite'}</span>
            {status === 'waitlist' && <span className="rounded-full bg-surface px-2.5 py-1 text-xs font-semibold text-warn">All spots reserved · waitlist open</span>}
            {e.spotsLeft !== null && status === 'open' && <span className="rounded-full bg-surface px-2.5 py-1 text-xs font-semibold text-muted">{e.spotsLeft} spot{e.spotsLeft === 1 ? '' : 's'} left</span>}
          </div>
          <button
            type="button"
            onClick={() => setView(view === 'details' ? 'register' : 'details')}
            aria-expanded={view === 'details'}
            className="mt-3 inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-btn border-2 border-brand bg-surface px-4 text-sm font-bold text-brand shadow-sm transition hover:bg-brand hover:text-brand-ink"
          >
            <Icon d={view === 'details' ? ICONS.chevronLeft : 'M12 16v-4M12 8h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'} className="size-5" />
            {view === 'details' ? 'Back to registration' : 'Show details'}
          </button>
        </header>
        {whenWhere}
        <div className="flex border-b border-line bg-surface px-3" role="tablist" aria-label="Event">
          {[
            ['register', refundToken ? 'Refund' : 'Register'],
            ['details', 'Details'],
          ].map(([k, l]) => (
            <button
              key={k}
              type="button"
              role="tab"
              aria-selected={view === k}
              onClick={() => setView(k)}
              className={`-mb-px cursor-pointer border-b-2 px-4 py-2.5 text-sm font-semibold ${view === k ? 'border-brand text-ink' : 'border-transparent text-muted hover:text-ink'}`}
            >
              {l}
            </button>
          ))}
        </div>
        {view === 'details' && details}
      </article>

      <section className={`mt-5 rounded-card border border-line bg-surface p-5 mobile:p-4 ${view === 'details' ? 'hidden' : ''}`}>
        {refundToken ? (
          <RefundDetailsForm slug={slug} event={event} token={refundToken} />
        ) : cancelToken ? (
          <CancelRegistration slug={slug} event={event} token={cancelToken} e={e} />
        ) : ticketLink ? (
          <TicketFromLink slug={slug} event={event} link={ticketLink} e={e} business={business} branding={branding} />
        ) : paymentToken ? (
          <ReuploadPayment slug={slug} event={event} token={paymentToken} channels={paymentChannels} />
        ) : done?.waitlisted ? (
          <Waitlisted done={done} />
        ) : done?.review ? (
          <PaymentSubmitted done={done} />
        ) : done ? (
          <Registered done={done} e={e} business={business} branding={branding} pdfUrl={done.cancelToken && done.count > 1 ? `/api/public/bookings/${encodeURIComponent(slug)}/events/${encodeURIComponent(event)}/qr-codes.pdf?t=${done.cancelToken}` : null} />
        ) : status === 'over' ? (
          <p className="text-center text-muted">This event is over.</p>
        ) : status === 'full' ? (
          <p className="text-center text-muted">Sorry, this event is full.{business.phone ? ` Call ${business.phone} to ask about a spot.` : ''}</p>
        ) : e.kind === 'paid' ? (
          <PaidRegistration slug={slug} event={event} e={e} channels={paymentChannels} onDone={setDone} waitlist={status === 'waitlist'} />
        ) : (
          <RegisterForm slug={slug} event={event} label={e.registerLabel} onDone={setDone} spotsLeft={e.spotsLeft} freshSpotsLeft={freshSpotsLeft} />
        )}
      </section>
    </BrandFrame>
  );
}

/** "Please enter a valid email address." as soon as a typed address can't be right (on leaving the field). */
const emailError = (v) => (v.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()) ? 'Please enter a valid email address.' : undefined);
const phoneError = (v) => (v.trim() && !(/^\+?[\d\s().-]+$/.test(v.trim()) && v.replace(/\D/g, '').length >= 7) ? 'Please enter a valid mobile number.' : undefined);

/** Bulk booking: how many spots under this name and email (each gets its own QR code). */
function SpotsField({ value, onChange, max, error }) {
  const n = Number(value);
  const limit = Math.max(1, Math.min(100, max ?? 100));
  const problem = value === '' ? 'How many spots?' : !Number.isInteger(n) || n < 1 ? 'At least 1.' : n > limit ? `At most ${limit}${max != null && max < 100 ? ' (spots left)' : ''}.` : null;
  return (
    <Field label="Number of spots" hint={`Booking for a group? Each spot gets its own QR code, all sent to this email.${max != null ? ` ${max} spot${max === 1 ? '' : 's'} left.` : ''}`} error={error || problem || undefined}>
      {(a) => (
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => onChange(String(Math.max(1, (n || 1) - 1)))} disabled={n <= 1} aria-label="One spot less">
            −
          </Button>
          <Input {...a} type="number" inputMode="numeric" min="1" max={limit} step="1" value={value} onChange={(x) => onChange(x.target.value)} className="w-20 text-center tabular-nums" />
          <Button variant="secondary" size="sm" onClick={() => onChange(String(Math.min(limit, (n || 0) + 1)))} disabled={n >= limit} aria-label="One spot more">
            +
          </Button>
        </div>
      )}
    </Field>
  );
}
/** Not enough spots any more (someone else booked meanwhile). */
const notEnough = (left, wanted) => (left === 0 ? 'Sorry, the event is now full.' : `Only ${left} spot${left === 1 ? '' : 's'} left now: please book ${left === 1 ? '1 spot' : `up to ${left}`} instead of ${wanted}.`);

const spotsOk = (value, max) => {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= Math.min(100, max ?? 100);
};

function RegisterForm({ slug, event, label, onDone, spotsLeft = null, freshSpotsLeft }) {
  const [register, state] = useRegisterEventMutation();
  const [f, setF] = useState({ firstName: '', lastName: '', email: '', phone: '' });
  const [qty, setQty] = useState('1');
  const [errors, setErrors] = useState({});
  const blur = (k, check) => setErrors((x) => ({ ...x, [k]: check(f[k]) }));
  const [error, setError] = useState('');
  const submit = async (ev) => {
    ev.preventDefault();
    setErrors({});
    setError('');
    // The spots left right now, before saving (someone may have booked meanwhile).
    const left = freshSpotsLeft ? await freshSpotsLeft() : null;
    if (left !== null && Number(qty) > left) {
      setErrors({ quantity: notEnough(left, Number(qty)) });
      return setError(notEnough(left, Number(qty)));
    }
    const r = await register({ slug, event, firstName: f.firstName, lastName: f.lastName, email: f.email, phone: f.phone, quantity: Number(qty) });
    if (r.error) {
      setErrors(r.error.fields ?? {});
      return setError(r.error.message);
    }
    onDone(r.data);
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <h2 className="text-lg font-semibold">Register</h2>
      <div className="grid gap-3 desktop:grid-cols-2">
        <Field label="First name" error={errors.firstName}>
          {(a) => <Input {...a} required autoComplete="given-name" maxLength={60} value={f.firstName} onChange={(x) => setF({ ...f, firstName: x.target.value })} />}
        </Field>
        <Field label="Last name" error={errors.lastName}>
          {(a) => <Input {...a} required autoComplete="family-name" maxLength={60} value={f.lastName} onChange={(x) => setF({ ...f, lastName: x.target.value })} />}
        </Field>
        <Field label="Email" hint="Your QR code is sent here." error={errors.email}>
          {(a) => <Input {...a} required type="email" autoComplete="email" value={f.email} onBlur={() => blur('email', emailError)} onChange={(x) => (setF({ ...f, email: x.target.value }), errors.email && setErrors({ ...errors, email: undefined }))} />}
        </Field>
        <Field label="Mobile number" error={errors.phone}>
          {(a) => <Input {...a} required type="tel" autoComplete="tel" inputMode="tel" maxLength={40} value={f.phone} onBlur={() => blur('phone', phoneError)} onChange={(x) => (setF({ ...f, phone: x.target.value }), errors.phone && setErrors({ ...errors, phone: undefined }))} />}
        </Field>
      </div>
      <SpotsField value={qty} onChange={setQty} max={spotsLeft} error={errors.quantity} />
      {error && <p className="text-sm text-danger" role="alert">{error}</p>}
      <Button type="submit" size="lg" loading={state.isLoading} disabled={!f.firstName.trim() || !f.lastName.trim() || !f.email.trim() || !f.phone.trim() || !!emailError(f.email) || !!phoneError(f.phone) || !spotsOk(qty, spotsLeft)}>
        {label || (Number(qty) > 1 ? `Register ${qty} spots for free` : 'Register for free')}
      </Button>
    </form>
  );
}

/** A refund request's link: where the organizer should send the refund (a QR code or bank details). */
function RefundDetailsForm({ slug, event, token }) {
  const q = usePublicRefundRequestQuery({ slug, event, token });
  const [submit, state] = useSubmitRefundDetailsMutation();
  const [method, setMethod] = useState('bank');
  const [f, setF] = useState({ bankName: '', accountName: '', accountNumber: '' });
  const [file, setFile] = useState(null);
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  if (q.isLoading) return <Loading />;
  if (q.error) return <p className="text-center text-muted">{q.error.message}</p>;
  const r = q.data;
  if (r.status === 'completed') return <p className="text-center text-muted">Your refund was sent. The proof is in your email.</p>;
  if (r.status === 'cancelled') return <p className="text-center text-muted">This refund request was withdrawn. Please contact the organizer if you have questions.</p>;
  if (done)
    return (
      <div className="text-center motion-safe:animate-rise" role="status">
        <span className="mx-auto grid size-14 place-items-center rounded-full bg-ok text-white">
          <Icon d={ICONS.check} className="size-7" />
        </span>
        <h2 className="mt-3 text-xl font-bold">Thanks, {r.name.split(' ')[0]}!</h2>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted">The organizer has your refund details. You’ll get an email with the proof once the refund is sent.</p>
      </div>
    );
  const ok = method === 'qr' ? file && !fileProblem(file, { pdf: false }) : f.bankName.trim() && f.accountName.trim() && f.accountNumber.trim();
  const send = async (ev) => {
    ev.preventDefault();
    setErrors({});
    setError('');
    const form = new FormData();
    form.append('token', token);
    form.append('method', method);
    if (method === 'bank') {
      form.append('bankName', f.bankName.trim());
      form.append('accountName', f.accountName.trim());
      form.append('accountNumber', f.accountNumber.trim());
    } else {
      const up = await compressImage(file, { maxSide: 1200, quality: 0.9 });
      form.append('file', up, up.name);
    }
    const res = await submit({ slug, event, form });
    if (res.error) {
      setErrors(res.error.fields ?? {});
      return setError(res.error.message);
    }
    setDone(true);
  };
  return (
    <form onSubmit={send} className="flex flex-col gap-4" noValidate>
      <div>
        <h2 className="text-lg font-semibold">Where should we send your refund?</h2>
        <p className="text-sm text-muted">
          {r.name}, the organizer will refund you{r.amount ? <strong className="text-ink"> {r.amount}</strong> : ''}. Upload your e-wallet or bank QR code, or enter your bank details.
        </p>
        {r.note && <p className="mt-2 rounded-xl bg-sunken px-3 py-2 text-sm text-ink">“{r.note}”</p>}
        {r.status === 'submitted' && <p className="mt-2 text-sm text-ok">You already sent your details. You can send them again to change them.</p>}
      </div>
      <div className="flex max-w-sm gap-1 rounded-btn bg-sunken p-1" role="tablist" aria-label="How to receive it">
        {[
          ['bank', 'Bank details'],
          ['qr', 'QR code'],
        ].map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={method === k} onClick={() => setMethod(k)} className={`flex-1 cursor-pointer rounded-md px-3 py-1.5 text-sm font-medium ${method === k ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'}`}>
            {l}
          </button>
        ))}
      </div>
      {method === 'bank' ? (
        <div className="grid gap-3 desktop:grid-cols-2">
          <Field label="Bank name" error={errors.bankName}>
            {(a) => <Input {...a} value={f.bankName} maxLength={100} onChange={(x) => setF({ ...f, bankName: x.target.value })} />}
          </Field>
          <Field label="Account name" error={errors.accountName}>
            {(a) => <Input {...a} value={f.accountName} maxLength={120} onChange={(x) => setF({ ...f, accountName: x.target.value })} />}
          </Field>
          <Field label="Account number" error={errors.accountNumber} className="desktop:col-span-2">
            {(a) => <Input {...a} value={f.accountNumber} maxLength={60} inputMode="numeric" className="max-w-72 font-mono" onChange={(x) => setF({ ...f, accountNumber: x.target.value })} />}
          </Field>
        </div>
      ) : (
        <FilePicker id="refund-qr" accept="image/jpeg,image/png,image/webp" file={file} onChange={setFile} error={errors.file || (file ? fileProblem(file, { pdf: false }) : undefined)} label="Upload your QR code" hint={`GCash, Maya or a bank QR · image up to ${MAX_UPLOAD_MB} MB`} disabled={state.isLoading} />
      )}
      {error && <p className="text-sm text-danger" role="alert">{error}</p>}
      <Button type="submit" size="lg" loading={state.isLoading} disabled={!ok}>
        Send my refund details
      </Button>
    </form>
  );
}

/** Paid: 1 reserve (the details and the spots), 2 pay, 3 the proof of payment. */
function PaidRegistration({ slug, event, e, channels, onDone, waitlist }) {
  const [held, setHeld] = useState(null); // the reservation, with its upload link
  if (held) {
    return (
      <ReservedPayment
        slug={slug}
        event={event}
        token={held.token}
        r={{ ...held, reuploadBy: held.reservedUntil }}
        channels={channels}
        onDone={(d) => onDone({ ...held, ...d, review: true })}
      />
    );
  }
  return (
    <ReserveForm
      slug={slug}
      event={event}
      e={e}
      waitlist={waitlist}
      onWaitlisted={onDone}
      onReserved={(r) => {
        // A refresh keeps the reservation: the link is in the address too (and in the email).
        try {
          window.history.replaceState(null, '', `#upload=${r.token}`);
        } catch {
          /* fine without */
        }
        setHeld(r);
      }}
    />
  );
}

const PAID_STEPS = ['Reserve', 'Pay', 'Proof of payment'];
const emailOk = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
const phoneOk = (v) => /^\+?[\d\s().-]+$/.test(v.trim()) && v.replace(/\D/g, '').length >= 7;

/** Where the attendee is: 1 Reserve, 2 Pay, 3 Proof. */
function Stepper({ step }) {
  return (
    <ol className="flex items-center gap-2" aria-label="Registration steps">
      {PAID_STEPS.map((label, i) => {
        const state = i < step ? 'done' : i === step ? 'now' : 'next';
        return (
          <li key={label} className="flex min-w-0 flex-1 items-center gap-2" aria-current={state === 'now' ? 'step' : undefined}>
            <span
              className={`grid size-8 shrink-0 place-items-center rounded-full text-sm font-bold transition-colors duration-300 ${
                state === 'done' ? 'bg-brand text-brand-ink' : state === 'now' ? 'bg-brand text-brand-ink ring-4 ring-brand/25' : 'bg-sunken text-faint'
              }`}
            >
              {state === 'done' ? <Icon d={ICONS.check} className="size-4" /> : i + 1}
            </span>
            <span className={`truncate text-sm font-semibold mobile:hidden ${state === 'next' ? 'text-faint' : 'text-ink'}`}>{label}</span>
            {i < PAID_STEPS.length - 1 && (
              <span className="h-0.5 min-w-4 flex-1 overflow-hidden rounded-full bg-sunken" aria-hidden="true">
                <span className={`block h-full bg-brand transition-[width] duration-500 ${i < step ? 'w-full' : 'w-0'}`} />
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

/** Step 1: who's coming and how many spots (and a promo code): reserves them for 2 hours, or joins the waitlist. */
function ReserveForm({ slug, event, e, waitlist, onReserved, onWaitlisted }) {
  const [register, state] = useRegisterPaidEventMutation();
  const [f, setF] = useState({ firstName: '', lastName: '', email: '', phone: '' });
  const [qty, setQty] = useState('1');
  // The waitlist is for one person at a time: no bulk bookings.
  const spots = waitlist ? 1 : spotsOk(qty, e.spotsLeft) ? Number(qty) : 1;
  // A promo code: checked with the organizer's rules, the price shown with and without it.
  // An affiliate's link (?promo=CODE) fills the code in; the attendee still presses Apply.
  const [promoInput, setPromoInput] = useState(() => (new URLSearchParams(window.location.search).get('promo') ?? '').toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 30));
  const [promo, setPromo] = useState(null); // the quote of an applied, valid code
  const [promoError, setPromoError] = useState('');
  const [quote, quoteState] = useLazyPromoQuoteQuery();
  const applyPromo = async () => {
    setPromoError('');
    const code = promoInput.trim();
    if (!code) return;
    const r = await quote({ slug, event, code, quantity: spots });
    if (r.error) return setPromoError(r.error.message);
    if (!r.data.valid) {
      setPromo(null);
      return setPromoError(r.data.reason || 'This promo code isn’t valid.');
    }
    setPromo(r.data);
  };
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');

  const submit = async (ev) => {
    ev.preventDefault();
    setError('');
    const er = {};
    if (!f.firstName.trim()) er.firstName = 'Please enter your first name.';
    if (!f.lastName.trim()) er.lastName = 'Please enter your last name.';
    if (!emailOk(f.email)) er.email = 'Please enter a valid email address.';
    if (!phoneOk(f.phone)) er.phone = 'Please enter a valid mobile number.';
    if (!waitlist && !spotsOk(qty, e.spotsLeft)) er.quantity = 'Please check the number of spots.';
    setErrors(er);
    if (Object.keys(er).length) return;
    const body = Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.trim()]));
    const r = await register({ slug, event, form: { ...body, quantity: spots, ...(promo ? { promoCode: promo.code } : {}) } });
    if (r.error) {
      setErrors(r.error.fields ?? {});
      return setError(r.error.message);
    }
    if (r.data.waitlisted) onWaitlisted(r.data);
    else onReserved(r.data);
  };

  const total = promo ? promo.totalLabel : spots > 1 && e.price != null && e.currency ? fmtMoney(e.price * spots, e.currency) : e.priceLabel;
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{waitlist ? 'Join the waitlist' : 'Register'}</h2>
        {!waitlist && <Stepper step={0} />}
      </div>
      <form onSubmit={submit} className="flex flex-col gap-4 motion-safe:animate-rise" noValidate>
        {waitlist ? (
          <div className="rounded-card border border-warn/40 bg-warn-soft/40 px-4 py-3 text-sm">
            <p className="font-semibold text-ink">All the spots are reserved right now.</p>
            <p className="mt-1 text-muted">
              Some reservations aren’t paid yet. Join the waitlist: if one expires, the spot goes to the next person in line, and we’ll email you a link to pay (you’ll then have 2 hours). <strong className="text-ink">Don’t pay anything yet.</strong> The waitlist is for one person: there’s no room for group bookings.
            </p>
          </div>
        ) : (
          <p className="text-sm text-muted">
            {Number(qty) > 1
              ? `You’re booking ${qty} spots. Enter the details of the principal booker: the person who pays and whom the organizer contacts about this booking. Each spot gets its own QR code once your payment is verified.`
              : 'First, tell us who’s coming.'}{' '}
            <strong className="text-ink">Your {Number(qty) > 1 ? 'spots are' : 'spot is'} reserved for 2 hours</strong> while you pay and upload the proof of payment.
          </p>
        )}
        <div className="grid gap-3 desktop:grid-cols-2">
          <Field label="First name" error={errors.firstName}>
            {(a) => <Input {...a} required autoFocus autoComplete="given-name" maxLength={60} value={f.firstName} onChange={(x) => setF({ ...f, firstName: x.target.value })} />}
          </Field>
          <Field label="Last name" error={errors.lastName}>
            {(a) => <Input {...a} required autoComplete="family-name" maxLength={60} value={f.lastName} onChange={(x) => setF({ ...f, lastName: x.target.value })} />}
          </Field>
          <Field label="Email" hint={waitlist ? 'We’ll email you here if a spot opens up.' : 'The payment link and your QR code are sent here.'} error={errors.email}>
            {(a) => <Input {...a} required type="email" autoComplete="email" value={f.email} onBlur={() => setErrors((x) => ({ ...x, email: emailError(f.email) }))} onChange={(x) => (setF({ ...f, email: x.target.value }), errors.email && setErrors({ ...errors, email: undefined }))} />}
          </Field>
          <Field label="Mobile number" error={errors.phone}>
            {(a) => <Input {...a} required type="tel" autoComplete="tel" inputMode="tel" maxLength={40} value={f.phone} onBlur={() => setErrors((x) => ({ ...x, phone: phoneError(f.phone) }))} onChange={(x) => (setF({ ...f, phone: x.target.value }), errors.phone && setErrors({ ...errors, phone: undefined }))} />}
          </Field>
        </div>
        {!waitlist && (
          <SpotsField
            value={qty}
            onChange={(v) => {
              setQty(v);
              // A promo applies spot by spot: check it again for the new number.
              setPromo(null);
            }}
            max={e.spotsLeft}
            error={errors.quantity}
          />
        )}
        <div className="rounded-card border border-line px-4 py-3">
          {promo ? (
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span>
                Promo <strong className="font-mono">{promo.code}</strong> applied{spots > 1 ? (promo.qualified < spots ? ` to ${promo.qualified} of your ${spots} spots (that’s all the uses it has left; the other ${spots - promo.qualified} pay the full price)` : ` to all ${spots} spots`) : ''}: you save {promo.discountLabel}.
                {waitlist ? ' It’s used if a spot is offered to you, while it still has uses left.' : ''}
              </span>
              <button type="button" onClick={() => (setPromo(null), setPromoInput(''))} className="cursor-pointer font-medium text-brand underline">
                Remove
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              <label htmlFor="promo" className="text-sm font-medium">
                Have a promo code?
              </label>
              <div className="flex flex-wrap gap-2">
                <Input id="promo" value={promoInput} maxLength={30} placeholder="CODE" className="max-w-48 font-mono uppercase" onChange={(x) => (setPromoInput(x.target.value.toUpperCase()), setPromoError(''))} onKeyDown={(x) => x.key === 'Enter' && (x.preventDefault(), applyPromo())} />
                <Button variant="secondary" onClick={applyPromo} loading={quoteState.isFetching} disabled={!promoInput.trim()}>
                  Apply
                </Button>
              </div>
              {(promoError || errors.promoCode) && <p className="text-[13px] text-danger">{promoError || errors.promoCode}</p>}
            </div>
          )}
        </div>
        {total && (
          <p className="text-sm text-muted">
            To pay: <strong className="text-ink">{total}</strong>
            {promo && <span className="ml-2 line-through">{promo.totalWithoutLabel}</span>}
            {spots > 1 && e.priceLabel ? ` · ${spots} spots × ${e.priceLabel}` : ''}
          </p>
        )}
        {error && <p className="text-sm text-danger" role="alert">{error}</p>}
        <Button type="submit" size="lg" loading={state.isLoading}>
          {waitlist ? 'Join the waitlist' : spots > 1 ? `Reserve ${spots} spots` : 'Reserve my spot'} <Icon d={ICONS.chevronRight} className="size-4" />
        </Button>
      </form>
    </div>
  );
}

/** "1 h 42 min" left until the reservation expires (updated every 15 seconds). */
function useTimeLeft(until) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);
  const ms = until ? new Date(until).getTime() - now : 0;
  const min = Math.max(0, Math.ceil(ms / 60_000));
  return { expired: ms <= 0, label: min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min` };
}

/** Steps 2 and 3, on a reservation: pay, then upload the proof with its link (right after reserving, or from the email). */
function ReservedPayment({ slug, event, token, r, channels, onDone }) {
  const [reupload, state] = useReuploadPaymentMutation();
  const [step, setStep] = useState(1);
  const [picked, setPicked] = useState(null);
  const [file, setFile] = useState(null);
  const [error, setError] = useState('');
  const [preparing, setPreparing] = useState(false);
  const left = useTimeLeft(r.reuploadBy);
  const top = useRef(null);
  const go = (n) => {
    setStep(n);
    setError('');
    top.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  if (left.expired) return <p className="text-center text-muted">The 2 hours to send the proof of payment have passed, so your reservation expired and the spot was released. You can register again while spots are left.</p>;
  const deadline = new Date(r.reuploadBy).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const submit = async (ev) => {
    ev.preventDefault();
    setError('');
    const problem = fileProblem(file);
    if (problem) return setError(problem);
    setPreparing(true);
    const upload = await compressImage(file);
    setPreparing(false);
    const form = new FormData();
    form.append('token', token);
    form.append('file', upload, upload.name);
    const res = await reupload({ slug, event, form });
    if (res.error) return setError(res.error.message);
    // The link is used up: off the address bar.
    try {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    } catch {
      /* fine without */
    }
    onDone({ ...res.data, places: r.places, amountLabel: r.amountLabel, promoted: r.promoted });
  };
  const chosen = channels.find((c) => c.id === picked);
  return (
    <div ref={top} className="flex scroll-mt-4 flex-col gap-5">
      <div className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Register</h2>
        <Stepper step={step} />
      </div>
      <div className="flex items-start gap-3 rounded-card border border-ok/40 bg-ok-soft/50 px-4 py-3 text-sm" role="status">
        <span className="grid size-8 shrink-0 place-items-center rounded-full bg-ok text-white">
          <Icon d={ICONS.check} className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="font-semibold text-ink">
            {r.places > 1 ? `${r.places} spots reserved` : 'Your spot is reserved'}, {r.name.split(' ')[0]}! <span className="font-normal text-muted">{left.label} left</span>
          </p>
          <p className="text-muted">
            Pay and upload your proof of payment by <strong className="text-ink">{deadline}</strong>, or the reservation expires. We also emailed this link to {r.email} in case you close the page.
          </p>
        </div>
      </div>

      {step === 1 && (
        <div key="pay" className="flex flex-col gap-4 motion-safe:animate-rise">
          <div className="relative overflow-hidden rounded-2xl border border-line bg-brand-soft px-5 py-4">
            <p className="text-xs font-bold tracking-widest text-brand uppercase">Amount to pay</p>
            <p className="mt-0.5 text-3xl font-extrabold tracking-tight text-ink">{r.amountLabel || 'See the event details'}</p>
            {(r.places > 1 || r.promoCode) && (
              <p className="mt-0.5 text-sm font-semibold text-ink">
                {r.places > 1 ? `${r.places} spots` : '1 spot'}
                {r.promoCode && r.promoted ? ` · promo ${r.promoCode}${r.places > 1 ? ` on ${r.promoted} of them` : ''}` : ''}
              </p>
            )}
            <p className="mt-1 text-sm text-muted">
              {channels.length > 1 ? `Choose one of the ${channels.length} ways below.` : channels.length ? 'Tap the card below.' : 'Pay as the organizer told you.'} Tip: add your name, {r.name}, in the payment’s note or reference.
            </p>
            <Icon d={ICONS.tag} className="pointer-events-none absolute -right-3 -bottom-4 size-24 rotate-12 text-brand/10" />
          </div>
          <PaymentChannelsView channels={channels} picked={picked} onPick={setPicked} />
          <div className="flex justify-end pt-1">
            <Button size="lg" onClick={() => go(2)} className="mobile:w-full">
              I already paid, next step <Icon d={ICONS.chevronRight} className="size-4" />
            </Button>
          </div>
        </div>
      )}

      {step === 2 && (
        <form key="proof" onSubmit={submit} className="flex flex-col gap-4 motion-safe:animate-rise" noValidate>
          <p className="text-sm text-muted">
            Last step: upload a screenshot of the payment confirmation, a photo of the receipt, or a PDF{chosen ? ` (paid with ${chosen.label})` : ''}.
          </p>
          <FilePicker
            id="proof"
            accept={PROOF_ACCEPT}
            file={file}
            onChange={(x) => {
              setError(x ? (fileProblem(x) ?? '') : '');
              setFile(x);
            }}
            error={error}
            label="Upload your proof of payment"
            hint={`Image or PDF · up to ${MAX_UPLOAD_MB} MB`}
            disabled={state.isLoading}
          />
          <div className="flex flex-wrap-reverse items-center justify-between gap-2">
            <Button variant="ghost" onClick={() => go(1)} disabled={state.isLoading}>
              <Icon d={ICONS.chevronLeft} className="size-4" /> Back
            </Button>
            <Button type="submit" size="lg" loading={preparing || state.isLoading} disabled={!file || !!fileProblem(file)} className="mobile:w-full">
              {preparing ? 'Preparing…' : state.isLoading ? 'Uploading…' : 'Send the proof'}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

/** Full: on the waitlist. No payment yet: a link comes by email if a reserved spot frees up. */
function Waitlisted({ done }) {
  return (
    <div className="text-center motion-safe:animate-rise" role="status">
      <span className="mx-auto grid size-16 place-items-center rounded-full bg-brand text-brand-ink shadow-lg">
        <Icon d={ICONS.clock} className="size-8" />
      </span>
      <h2 className="mt-4 text-xl font-bold">You’re on the waitlist, {done.name.split(' ')[0]}</h2>
      {done.position ? <p className="mt-1 text-sm font-semibold text-ink">#{done.position} in line</p> : null}
      <p className="mx-auto mt-2 max-w-md text-sm text-muted">
        All the spots are reserved right now. If a reservation expires, the spot goes to the next person in line and <strong className="text-ink">we’ll email {done.email} a link to pay</strong>. You’ll then have 2 hours to pay and upload the proof.
      </p>
      <p className="mx-auto mt-3 max-w-md text-xs text-faint">Please don’t pay anything until you get that email.</p>
    </div>
  );
}

/** Sent: the payment is being verified; the confirmation and QR code follow by email. */
function PaymentSubmitted({ done, again = false }) {
  return (
    <div className="text-center motion-safe:animate-rise" role="status">
      <span className="relative mx-auto grid size-16 place-items-center">
        <span className="relative grid size-16 place-items-center rounded-full bg-brand text-brand-ink shadow-lg">
          <Icon d={ICONS.clock} className="size-8" />
        </span>
      </span>
      <h2 className="mt-4 text-xl font-bold">{again ? 'New proof received!' : `Thanks, ${done.name.split(' ')[0]}! Your payment is being verified`}</h2>
      {done.places > 1 && (
        <p className="mt-1 text-sm font-semibold text-ink">
          {done.places} spots{done.amountLabel ? ` · ${done.amountLabel}` : ''}
          {done.promoted ? ` · promo on ${done.promoted} of them` : ''}
        </p>
      )}
      <p className="mx-auto mt-2 max-w-md text-sm text-muted">
        We received your proof of payment. <strong className="text-ink">You will receive an email at {done.email} once your payment is verified</strong>, with your confirmation and QR code.
      </p>
      <ol className="mx-auto mt-5 flex max-w-sm flex-col gap-2 text-left text-sm">
        <li className="flex items-center gap-3 rounded-xl bg-ok-soft/60 px-3 py-2">
          <span className="grid size-6 shrink-0 place-items-center rounded-full bg-ok text-white">
            <Icon d={ICONS.check} className="size-3.5" />
          </span>
          Proof of payment received
        </li>
        <li className="flex items-center gap-3 rounded-xl bg-brand-soft px-3 py-2">
          <span className="grid size-6 shrink-0 place-items-center rounded-full bg-brand text-xs font-bold text-brand-ink">2</span>
          <span>
            Payment being verified
            <span className="block text-xs text-muted">The organizer checks it by hand. You will receive an email once it’s verified.</span>
          </span>
        </li>
        <li className="flex items-center gap-3 rounded-xl bg-sunken px-3 py-2 text-muted">
          <span className="grid size-6 shrink-0 place-items-center rounded-full bg-line text-faint">3</span>
          Confirmation and QR code by email
        </li>
      </ol>
      <p className="mx-auto mt-4 max-w-md text-xs text-faint">If there’s a problem with the payment, we’ll email you a link to upload a new proof.</p>
    </div>
  );
}

/** From a "send another / an additional proof" email: its own one-time link, within 10 hours. */
function ReuploadPayment({ slug, event, token, channels }) {
  const q = useUploadRequestQuery({ slug, event, token });
  const [reupload, state] = useReuploadPaymentMutation();
  const [file, setFile] = useState(null);
  const [error, setError] = useState('');
  const [done, setDone] = useState(null);
  const [preparing, setPreparing] = useState(false);
  if (q.isLoading) return <Loading />;
  if (done) return <PaymentSubmitted done={done} again={!done.first} />;
  if (q.error) return <p className="text-center text-muted">This link isn’t valid any more: the proof of payment was already sent with it, it was replaced by a newer one (see your latest email), or the time to upload passed and the spot was released.</p>;
  const r = q.data;
  if (r.status === 'reserved') return <ReservedPayment slug={slug} event={event} token={token} r={r} channels={channels} onDone={(d) => setDone({ ...r, ...d })} />;
  if (r.status === 'review') return <PaymentSubmitted done={r} again />;
  if (r.status === 'confirmed') return <p className="text-center text-muted">Your payment is confirmed. Your QR code is in your email.</p>;
  const deadline = r.reuploadBy ? new Date(r.reuploadBy) : null;
  if (r.status !== 'rejected' || !deadline || deadline <= new Date()) return <p className="text-center text-muted">The time to upload has passed, so the spot was released. You can register again while spots are left.</p>;
  const additional = r.kind === 'additional';
  const submit = async (ev) => {
    ev.preventDefault();
    setError('');
    const problem = fileProblem(file);
    if (problem) return setError(problem);
    setPreparing(true);
    const upload = await compressImage(file);
    setPreparing(false);
    const form = new FormData();
    form.append('token', token);
    form.append('file', upload, upload.name);
    const res = await reupload({ slug, event, form });
    if (res.error) return setError(res.error.message);
    setDone(res.data);
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <div>
        <h2 className="text-lg font-semibold">{additional ? 'Upload the proof of the remaining payment' : 'Upload another proof of payment'}</h2>
        <p className="mt-1 text-sm text-muted">
          {r.name},{' '}
          {additional ? (
            <>
              your payment isn’t complete yet.{r.amountDue && <strong className="text-ink"> Still to pay: {r.amountDue}.</strong>} Pay the rest, then upload its proof. Your first proof is kept.
            </>
          ) : (
            'the organizer couldn’t confirm your payment with the proof you sent. Please upload another one.'
          )}
        </p>
        {r.note && <p className="mt-2 rounded-xl bg-sunken px-3 py-2 text-sm text-ink">“{r.note}”</p>}
        <p className="mt-2 text-sm text-muted">
          Please upload it by <strong className="text-ink">{deadline.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</strong>, or your spot is released.
        </p>
      </div>
      {additional && channels.length > 0 && <PaymentChannelsView channels={channels} />}
      <FilePicker
        id="proof"
        accept={PROOF_ACCEPT}
        file={file}
        onChange={(x) => {
          setError(x ? (fileProblem(x) ?? '') : '');
          setFile(x);
        }}
        error={error}
        label={additional ? 'Upload the proof of the remaining payment' : 'Upload your proof of payment'}
        hint={`Image or PDF · up to ${MAX_UPLOAD_MB} MB`}
        disabled={state.isLoading}
      />
      <Button type="submit" size="lg" loading={preparing || state.isLoading} disabled={!file || !!fileProblem(file)}>
        Send the proof
      </Button>
    </form>
  );
}


/** The attendee cancels (free events only), from the link in their email. */
function CancelRegistration({ slug, event, token, e }) {
  const q = useEventRegistrationQuery({ slug, event, token });
  const [cancel, state] = useCancelEventRegistrationMutation();
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');
  if (q.isLoading) return <Loading />;
  if (q.error) return <p className="text-center text-muted">{q.error.message}</p>;
  const r = q.data;
  if (done || r.status === 'cancelled') {
    return (
      <div className="text-center">
        <h2 className="text-lg font-semibold">Your registration is cancelled</h2>
        <p className="mt-1 text-sm text-muted">Thanks for letting us know. Changed your mind? Register again below while spots are left.</p>
        <a href={window.location.pathname} className="mt-4 inline-block font-medium text-brand underline">
          Back to the event
        </a>
      </div>
    );
  }
  if (!r.canCancel) {
    return <p className="text-center text-muted">{e.kind === 'paid' ? 'Registrations for paid events can’t be cancelled. Please contact the organizer.' : r.checkedIn ? 'You’ve already checked in at this event.' : 'This registration can’t be cancelled any more.'}</p>;
  }
  return (
    <div className="text-center">
      <h2 className="text-lg font-semibold">{r.spots > 1 ? `Cancel your booking (${r.spots} spots)?` : 'Cancel your registration?'}</h2>
      <p className="mt-1 text-sm text-muted">
        {r.spots > 1
          ? `${r.name} (${r.email}): all ${r.spots} spots of your booking are freed for someone else and their QR codes stop working.`
          : `${r.name} (${r.email}): your spot is freed for someone else and your QR code stops working.`}
      </p>
      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <a href={window.location.pathname} className="inline-flex min-h-10 items-center rounded-btn border border-line-strong px-4 text-sm font-semibold hover:bg-sunken">
          {r.spots > 1 ? 'Keep my booking' : 'Keep my spot'}
        </a>
        <Button
          variant="danger"
          loading={state.isLoading}
          onClick={async () => {
            setError('');
            const res = await cancel({ slug, event, token });
            if (res.error) return setError(res.error.message);
            setDone(true);
          }}
        >
          {r.spots > 1 ? `Cancel all ${r.spots} spots` : 'Cancel my registration'}
        </Button>
      </div>
    </div>
  );
}

/** The ticket again, from the confirmation email's links (view, or download as an image or PDF). */
function TicketFromLink({ slug, event, link, e, business, branding }) {
  const q = useEventRegistrationQuery({ slug, event, token: link.token });
  if (q.isLoading) return <Loading />;
  if (q.error) return <p className="text-center text-muted">{q.error.message}</p>;
  const r = q.data;
  if (!r.checkIn) {
    return (
      <p className="text-center text-muted">
        {r.status === 'review' || r.status === 'rejected' ? 'Your payment isn’t confirmed yet: you’ll get your ticket by email once it is.' : 'This registration isn’t active any more, so there’s no ticket to show.'}
      </p>
    );
  }
  return <Registered done={{ name: r.name, email: r.email, checkIn: r.checkIn }} e={e} business={business} branding={branding} autoDownload={link.download} again />;
}

/** Done: the QR code to show at the door (also emailed), to download as an image or a PDF. Online: just the link, by email. */
function Registered({ done, e, business, branding, autoDownload = null, again = false, pdfUrl = null }) {
  // A bulk booking: every spot's code, and all the QR codes in one PDF.
  if (done.places?.length > 1) return <RegisteredGroup done={done} pdfUrl={pdfUrl} />;
  if (!done.checkIn) {
    return (
      <div className="text-center motion-safe:animate-rise">
        <span className="mx-auto grid size-12 place-items-center rounded-full bg-ok text-white">
          <Icon d={ICONS.check} className="size-6" />
        </span>
        <h2 className="mt-3 text-xl font-bold">You’re registered, {done.name.split(' ')[0]}!</h2>
        <p className="mt-1 text-sm text-muted">
          This is an online event: there’s nothing to scan. We emailed the details to {done.email}
          {e.hasLink ? ', with the link to join.' : ', and we’ll email you the link to join before it starts.'}
        </p>
        <div className="mx-auto mt-5 flex max-w-sm items-center gap-3 rounded-2xl bg-brand-soft px-4 py-3 text-left">
          <Icon d={ICONS.video} className="size-6 shrink-0 text-brand" />
          <p className="text-sm text-ink">Join from the email at {fmtLongDate(e.date)}, {range(e.startMinute, e.endMinute)}.</p>
        </div>
      </div>
    );
  }
  const [src, setSrc] = useState(null);
  useEffect(() => {
    let live = true;
    import('qrcode').then(({ default: QRCode }) => QRCode.toDataURL(done.checkIn.url, { width: 320, margin: 1, errorCorrectionLevel: 'M' }).then((u) => live && setSrc(u)));
    return () => {
      live = false;
    };
  }, [done.checkIn.url]);
  return (
    <div className="text-center motion-safe:animate-rise">
      <span className="mx-auto grid size-12 place-items-center rounded-full bg-ok text-white">
        <Icon d={ICONS.check} className="size-6" />
      </span>
      <h2 className="mt-3 text-xl font-bold">{again ? `Your ticket, ${done.name.split(' ')[0]}` : `You’re registered, ${done.name.split(' ')[0]}!`}</h2>
      <p className="mt-1 text-sm text-muted">{again ? 'Show this QR code at the entrance, or save it below.' : `We emailed your QR code to ${done.email}. ${e.format === 'online' ? 'The link to join comes by email too.' : 'Show it at the entrance.'}`}</p>
      <div className="mx-auto mt-5 grid size-52 place-items-center rounded-2xl border-2 border-dashed border-brand/40 bg-white p-3">{src ? <img src={src} alt="Your check-in QR code" className="size-full" /> : <Loading label="" />}</div>
      <p className="mt-4 font-mono text-2xl font-bold tracking-[0.3em]">{done.checkIn.code}</p>
      <p className="mt-1 text-xs text-faint">If the scan doesn’t work, give them this code.</p>
      {src && <TicketDownloads done={done} e={e} business={business} branding={branding} qr={src} autoDownload={autoDownload} />}
    </div>
  );
}

function RegisteredGroup({ done, pdfUrl }) {
  return (
    <div className="text-center motion-safe:animate-rise">
      <span className="mx-auto grid size-12 place-items-center rounded-full bg-ok text-white">
        <Icon d={ICONS.check} className="size-6" />
      </span>
      <h2 className="mt-3 text-xl font-bold">
        You’re registered, {done.name.split(' ')[0]}! {done.places.length} spots
      </h2>
      <p className="mx-auto mt-1 max-w-md text-sm text-muted">We emailed all {done.places.length} QR codes to {done.email}, together in one PDF too. Show one per person at the entrance.</p>
      {pdfUrl && (
        <a href={pdfUrl} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-btn bg-brand px-5 text-sm font-bold text-brand-ink shadow-sm hover:brightness-110">
          <Icon d="M12 4v12M7 11l5 5 5-5M4 20h16" className="size-5" /> Download all QR codes (PDF)
        </a>
      )}
      <ul className="mx-auto mt-5 grid max-w-md gap-2 text-left desktop:grid-cols-2">
        {done.places.map((p, i) => (
          <li key={p.code} className="flex items-center justify-between rounded-xl border border-line bg-surface px-3 py-2">
            <span className="text-xs font-semibold text-muted">Spot {i + 1}</span>
            <span className="font-mono text-sm font-bold tracking-wider">{p.code}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function TicketDownloads({ done, e, business, branding, qr, autoDownload = null }) {
  const [busy, setBusy] = useState(null);
  const started = useRef(false);
  const file = `${e.slug}-${done.checkIn.code}`;
  const make = async (kind) => {
    setBusy(kind);
    try {
      const canvas = await drawTicket({
        businessName: business.name,
        title: e.title,
        when: `${fmtLongDate(e.date)} · ${range(e.startMinute, e.endMinute)} ${zoneName(e.timeZone || business.timeZone, new Date(e.startsAt))}`,
        place: e.format === 'online' ? 'Online (the link comes by email)' : e.address || business.name,
        name: done.name,
        code: done.checkIn.code,
        qrDataUrl: qr,
        color: branding.primaryColor,
      });
      if (kind === 'png') downloadPng(canvas, `${file}.png`);
      else downloadPdf(canvas, `${file}.pdf`);
    } finally {
      setBusy(null);
    }
  };
  // From the email's "Download image / PDF" links: start that download once the QR code is ready.
  useEffect(() => {
    if (!autoDownload || started.current) return;
    started.current = true;
    make(autoDownload);
  }, [autoDownload]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="mt-5 flex flex-wrap justify-center gap-2">
      <Button variant="secondary" loading={busy === 'png'} onClick={() => make('png')}>
        Download image
      </Button>
      <Button variant="secondary" loading={busy === 'pdf'} onClick={() => make('pdf')}>
        Download PDF
      </Button>
    </div>
  );
}
