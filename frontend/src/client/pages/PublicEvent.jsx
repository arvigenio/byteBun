import { useEffect, useState } from 'react';
import { useCancelEventRegistrationMutation, useClaimEventMutation, useEventRegistrationQuery, usePublicEventQuery, useRegisterEventMutation } from '../api.js';
import { fmtLongDate, minuteLabel, zoneName } from '../lib/format.js';
import { Button, Field, Icon, ICONS, Input, Loading } from '../ui.jsx';
import { downloadPdf, downloadPng, drawTicket } from '../lib/ticket.js';
import { BrandFrame } from './PublicBooking.jsx';

// A public event page: /{business}/e/{event} (backend: booking/events.ts).
//   free  first and last name, email and phone (all required) -> registered: the QR code on screen and by email
//   paid  the code the organizer gave after payment -> registered: the QR code on screen and by email
// No rescheduling or cancelling here: attendees contact the organizer.

const range = (a, b) => `${minuteLabel(a)} – ${minuteLabel(b >= 1440 ? 1439 : b)}`;

export function PublicEventPage({ slug, event }) {
  const q = usePublicEventQuery({ slug, event });
  const [done, setDone] = useState(null);
  // The attendee's private cancel link (free events): …/e/{event}#cancel={token}
  const [cancelToken] = useState(() => /^#cancel=([\d.a-f]+)$/.exec(window.location.hash)?.[1] ?? null);
  useEffect(() => {
    if (q.data) document.title = `${q.data.event.title} · ${q.data.business.name}`;
  }, [q.data]);

  if (q.isLoading) return <Loading />;
  if (q.error)
    return (
      <main className="grid min-h-screen place-items-center px-4">
        <div className="max-w-md rounded-card border border-line bg-surface p-8 text-center">
          <h1 className="text-xl font-semibold">This event isn’t available</h1>
          <p className="mt-2 text-sm text-muted">The link may be wrong, or registration has closed.</p>
        </div>
      </main>
    );
  const { business, branding, event: e, status } = q.data;
  const tz = business.timeZone;
  const d = new Date(`${e.date}T12:00:00Z`);
  const f = (o) => new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', ...o }).format(d);

  return (
    <BrandFrame branding={branding} name={business.name}>
      <article className="overflow-hidden rounded-card border border-line bg-surface">
        <header className="bg-brand-soft px-5 pt-5 pb-4 mobile:px-4">
          <p className="text-sm font-semibold text-brand">{business.name}</p>
          <h1 className="mt-1 text-2xl leading-tight font-bold tracking-tight text-ink">{e.title}</h1>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <span className="rounded-full bg-surface px-2.5 py-1 text-xs font-semibold text-brand">{e.kind === 'paid' ? `Paid${e.priceLabel ? ` · ${e.priceLabel}` : ''}` : 'Free'}</span>
            <span className="rounded-full bg-surface px-2.5 py-1 text-xs font-semibold text-muted">{e.format === 'online' ? 'Online' : 'Onsite'}</span>
            {e.spotsLeft !== null && status === 'open' && <span className="rounded-full bg-surface px-2.5 py-1 text-xs font-semibold text-muted">{e.spotsLeft} place{e.spotsLeft === 1 ? '' : 's'} left</span>}
          </div>
        </header>
        <div className="grid gap-4 px-5 py-4 desktop:grid-cols-2 mobile:px-4">
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
        {e.description && <div className="rich border-t border-line px-5 py-4 text-muted mobile:px-4" dangerouslySetInnerHTML={{ __html: e.description }} />}
      </article>

      <section className="mt-5 rounded-card border border-line bg-surface p-5 mobile:p-4">
        {cancelToken ? (
          <CancelRegistration slug={slug} event={event} token={cancelToken} e={e} />
        ) : done ? (
          <Registered done={done} e={e} business={business} branding={branding} />
        ) : status === 'over' ? (
          <p className="text-center text-muted">This event is over.</p>
        ) : status === 'full' ? (
          <p className="text-center text-muted">Sorry, this event is full.{business.phone ? ` Call ${business.phone} to ask about a place.` : ''}</p>
        ) : e.kind === 'paid' ? (
          <ClaimForm slug={slug} event={event} label={e.registerLabel} onDone={setDone} />
        ) : (
          <RegisterForm slug={slug} event={event} label={e.registerLabel} onDone={setDone} />
        )}
      </section>
    </BrandFrame>
  );
}

function RegisterForm({ slug, event, label, onDone }) {
  const [register, state] = useRegisterEventMutation();
  const [f, setF] = useState({ firstName: '', lastName: '', email: '', phone: '' });
  const [errors, setErrors] = useState({});
  const [error, setError] = useState('');
  const submit = async (ev) => {
    ev.preventDefault();
    setErrors({});
    setError('');
    const r = await register({ slug, event, firstName: f.firstName, lastName: f.lastName, email: f.email, phone: f.phone });
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
          {(a) => <Input {...a} required type="email" autoComplete="email" value={f.email} onChange={(x) => setF({ ...f, email: x.target.value })} />}
        </Field>
        <Field label="Phone number" error={errors.phone}>
          {(a) => <Input {...a} required type="tel" autoComplete="tel" inputMode="tel" maxLength={40} value={f.phone} onChange={(x) => setF({ ...f, phone: x.target.value })} />}
        </Field>
      </div>
      {error && <p className="text-sm text-danger" role="alert">{error}</p>}
      <Button type="submit" size="lg" loading={state.isLoading} disabled={!f.firstName.trim() || !f.lastName.trim() || !f.email.trim() || !f.phone.trim()}>
        {label || 'Register for free'}
      </Button>
    </form>
  );
}

function ClaimForm({ slug, event, label, onDone }) {
  const [claim, state] = useClaimEventMutation();
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const pretty = (raw) => {
    const c = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    return c.length > 4 ? `${c.slice(0, 4)}-${c.slice(4)}` : c;
  };
  const submit = async (ev) => {
    ev.preventDefault();
    setError('');
    const r = await claim({ slug, event, code });
    if (r.error) return setError(r.error.message);
    onDone(r.data);
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <div>
        <h2 className="text-lg font-semibold">Register with your code</h2>
        <p className="text-sm text-muted">After you pay, the organizer gives you an 8-character code. Enter it to confirm your place.</p>
      </div>
      <Field label="Your code" error={error}>
        {(a) => <Input {...a} value={code} onChange={(x) => setCode(pretty(x.target.value))} placeholder="ABCD-EFGH" autoComplete="off" autoCapitalize="characters" className="max-w-64 text-center font-mono text-xl tracking-[0.3em]" />}
      </Field>
      <Button type="submit" size="lg" loading={state.isLoading} disabled={code.replace('-', '').length !== 8}>
        {label || 'Confirm my place'}
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
        <p className="mt-1 text-sm text-muted">Thanks for letting us know. Changed your mind? Register again below while places are left.</p>
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
      <h2 className="text-lg font-semibold">Cancel your registration?</h2>
      <p className="mt-1 text-sm text-muted">
        {r.name} ({r.email}): your place is freed for someone else and your QR code stops working.
      </p>
      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <a href={window.location.pathname} className="inline-flex min-h-10 items-center rounded-btn border border-line-strong px-4 text-sm font-semibold hover:bg-sunken">
          Keep my place
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
          Cancel my registration
        </Button>
      </div>
    </div>
  );
}

/** Done: the QR code to show at the door (also emailed), to download as an image or a PDF. Online: just the link, by email. */
function Registered({ done, e, business, branding }) {
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
      <h2 className="mt-3 text-xl font-bold">You’re registered, {done.name.split(' ')[0]}!</h2>
      <p className="mt-1 text-sm text-muted">We emailed your QR code to {done.email}. {e.format === 'online' ? 'The link to join comes by email too.' : 'Show it at the entrance.'}</p>
      <div className="mx-auto mt-5 grid size-52 place-items-center rounded-2xl border-2 border-dashed border-brand/40 bg-white p-3">{src ? <img src={src} alt="Your check-in QR code" className="size-full" /> : <Loading label="" />}</div>
      <p className="mt-4 font-mono text-2xl font-bold tracking-[0.3em]">{done.checkIn.code}</p>
      <p className="mt-1 text-xs text-faint">If the scan doesn’t work, give them this code.</p>
      {src && <TicketDownloads done={done} e={e} business={business} branding={branding} qr={src} />}
    </div>
  );
}

function TicketDownloads({ done, e, business, branding, qr }) {
  const [busy, setBusy] = useState(null);
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
