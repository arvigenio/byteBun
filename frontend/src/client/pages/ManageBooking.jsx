import { useEffect, useMemo, useState } from 'react';
import { useManageAvailabilityQuery, useManageCancelMutation, useManageQuery, useManageRescheduleMutation } from '../api.js';
import { SlotPicker } from '../components/SlotPicker.jsx';
import { fmtLongDate, fmtTime, LOCATION_LABEL, todayIn, zoneName } from '../lib/format.js';
import { Badge, Button, Loading } from '../ui.jsx';
import { BrandFrame } from './PublicBooking.jsx';

// The customer's private link: /manage#t=<token> (from their emails). No login. The token stays
// in the URL fragment (never sent to servers or in Referer headers); the API gets it in a header.
const readToken = () => new URLSearchParams(window.location.hash.slice(1)).get('t') ?? '';

const when = (b, tz) => (b.dateOnly ? fmtLongDate(b.date) : `${fmtLongDate(b.date)}, ${fmtTime(b.startsAt, tz)} ${zoneName(tz, new Date(b.startsAt))}`);

export function ManageBookingPage() {
  const token = useMemo(readToken, []);
  const q = useManageQuery(token, { skip: !token });
  const [mode, setMode] = useState('view');
  const [result, setResult] = useState(null);

  if (!token) return <Message title="This link is not complete">Please open the link from your email again.</Message>;
  if (q.isLoading) return <Loading screen />;
  if (q.error) return <Message title="This link is not valid any more">Please use the link in your latest email.</Message>;
  const { state, business, branding, booking } = q.data;
  const tz = business.timeZone;

  const body = (() => {
    if (result === 'cancelled' || state === 'cancelled') {
      return (
        <>
          <h2 className="text-lg font-semibold">This booking is cancelled</h2>
          <p className="mt-1 text-muted">{booking.service.name} · {when(booking, tz)}</p>
          <a href={`/${business.slug}`} className="mt-5 inline-block font-medium text-brand underline">
            Book another time
          </a>
        </>
      );
    }
    if (state === 'over') return <p className="text-muted">This appointment has already taken place, so it can’t be changed online.</p>;
    if (state === 'unavailable') return <p className="text-muted">Online changes are unavailable right now.{business.phone ? ` Please call ${business.phone}.` : ''}</p>;
    if (state === 'cutoff') {
      return (
        <p className="text-muted">
          It’s too close to your appointment to change it online.{' '}
          {business.phone ? (
            <>
              Please call us at <a className="font-medium text-brand underline" href={`tel:${business.phone.replace(/[^+\d]/g, '')}`}>{business.phone}</a>.
            </>
          ) : (
            'Please call the business.'
          )}
        </p>
      );
    }
    if (mode === 'reschedule') return <Reschedule token={token} tz={tz} onDone={() => (setMode('view'), setResult('moved'), q.refetch())} onCancel={() => setMode('view')} />;
    if (mode === 'cancel') return <ConfirmCancel token={token} onDone={() => (setResult('cancelled'), q.refetch())} onBack={() => setMode('view')} />;
    return (
      <>
        {result === 'moved' && <p className="mb-4 rounded-btn bg-ok-soft px-4 py-3 text-sm text-ok">Done! Your booking was moved. We emailed you the new details.</p>}
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setMode('reschedule')}>Reschedule</Button>
          <Button variant="secondary" onClick={() => setMode('cancel')}>
            Cancel booking
          </Button>
        </div>
        {business.changeCutoffHours ? <p className="mt-3 text-xs text-faint">Changes are possible up to {business.changeCutoffHours} hours before the appointment.</p> : null}
      </>
    );
  })();

  return (
    <BrandFrame branding={branding} name={business.name}>
      <h1 className="text-2xl font-bold tracking-tight">{business.name}</h1>
      <section className="mt-5 rounded-card border border-line bg-surface p-5">
        <p className="text-sm text-faint">Your booking, {booking.customerName}</p>
        <p className="mt-1 text-lg font-semibold">{booking.service.name}</p>
        <p className="text-muted">{when(booking, tz)}</p>
        <p className="mt-1 text-sm text-faint">{booking.service.locationType === 'in_person' && booking.service.address ? booking.service.address : LOCATION_LABEL[booking.service.locationType]}</p>
      </section>
      {booking.checkIn && result !== 'cancelled' && state !== 'over' && <CheckInCode checkIn={booking.checkIn} />}
      <section className="mt-4 rounded-card border border-line bg-surface p-5">{body}</section>
    </BrandFrame>
  );
}

function Reschedule({ token, tz, onDone, onCancel }) {
  const today = todayIn(tz);
  const [from, setFrom] = useState(today);
  const [pick, setPick] = useState(null);
  const q = useManageAvailabilityQuery({ token, from });
  const [move, state] = useManageRescheduleMutation();
  return (
    <div className="flex flex-col gap-4">
      <h2 className="font-semibold">Choose a new {q.data?.mode === 'date' ? 'day' : 'time'}</h2>
      <SlotPicker data={q.data} loading={q.isFetching} from={from} onFromChange={setFrom} today={today} value={pick} onChange={setPick} />
      {state.error && <p className="text-sm text-danger" role="alert">{state.error.message}</p>}
      <div className="flex gap-2">
        <Button
          disabled={!pick}
          loading={state.isLoading}
          onClick={async () => {
            const r = await move({ token, ...(pick.startsAt ? { startsAt: pick.startsAt } : { date: pick.date }) });
            if (!r.error) onDone();
          }}
        >
          Move my booking
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Back
        </Button>
      </div>
    </div>
  );
}

function ConfirmCancel({ token, onDone, onBack }) {
  const [cancel, state] = useManageCancelMutation();
  return (
    <div>
      <h2 className="font-semibold">Cancel this booking?</h2>
      <p className="mt-1 text-sm text-muted">The time will be freed for someone else.</p>
      {state.error && <p className="mt-2 text-sm text-danger" role="alert">{state.error.message}</p>}
      <div className="mt-4 flex gap-2">
        <Button variant="danger" loading={state.isLoading} onClick={async () => !(await cancel(token)).error && onDone()}>
          Yes, cancel it
        </Button>
        <Button variant="ghost" onClick={onBack}>
          Keep it
        </Button>
      </div>
    </div>
  );
}

function Message({ title, children }) {
  return (
    <BrandFrame>
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="mt-2 text-muted">{children}</p>
    </BrandFrame>
  );
}

/** The attendance QR code (and its code, for when the scan doesn't work), to show at the front desk. */
function CheckInCode({ checkIn }) {
  const [src, setSrc] = useState(null);
  useEffect(() => {
    let live = true;
    import('qrcode').then(({ default: QRCode }) => QRCode.toDataURL(checkIn.url, { width: 320, margin: 1, errorCorrectionLevel: 'M' }).then((url) => live && setSrc(url)));
    return () => {
      live = false;
    };
  }, [checkIn.url]);
  return (
    <section className="mt-4 rounded-card border-2 border-dashed border-brand/40 bg-surface p-5 text-center">
      <div className="flex items-center justify-center gap-2">
        <h2 className="text-sm font-bold tracking-wide text-ink uppercase">Your check-in code</h2>
        {checkIn.checkedInAt && <Badge tone="ok">Checked in</Badge>}
      </div>
      <p className="mt-1 text-sm text-muted">Show this at the front desk when you arrive.</p>
      <div className="mx-auto mt-4 grid size-44 place-items-center rounded-xl bg-white p-2 shadow-sm">{src ? <img src={src} alt="Check-in QR code" className="size-full" /> : <Loading label="" />}</div>
      <p className="mt-4 font-mono text-2xl font-bold tracking-[0.3em] text-ink">{checkIn.code}</p>
      <p className="mt-1 text-xs text-faint">If the scan doesn’t work, give them this code.</p>
    </section>
  );
}
