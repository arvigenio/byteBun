import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useAddBookingMutation, useAdminAvailabilityQuery, useBookingsQuery, useCheckInMutation, useMeQuery, useOverviewQuery, useRescheduleBookingMutation, useUndoCheckInMutation } from '../api.js';
import { SlotPicker } from '../components/SlotPicker.jsx';
import { fmtLongDate, fmtTime, todayIn } from '../lib/format.js';
import { bookingsBase } from '../lib/surface.js';
import { Badge, Button, Dialog, Icon, ICONS, Input, Loading, Notice, Spinner } from '../ui.jsx';

// Attendance check-in. The customer's emails (and manage page) have a QR code and an 8-character
// code. Two pages:
//   Bookings > Check-in tab (#check-in)  the front-desk hub: open the scanner, type a code, today's attendance
//   /scan      the dedicated full-screen scanner (no app menu), for a phone or tablet at the desk;
//              the QR code links here (?code=…), so a phone's own camera app opens it too
// Today's bookings are checked in straight away. Another day's, a past or a cancelled booking shows
// what's wrong and offers to move it to today, book it again, or check in anyway.
// API: POST /client/bookings/check-in.

const pretty = (raw) => {
  const c = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
  return c.length > 4 ? `${c.slice(0, 4)}-${c.slice(4)}` : c;
};

/** Sends a code (or a booking id) to the API and keeps the result; buzzes on phones. */
function useCheckIn() {
  const [checkIn, state] = useCheckInMutation();
  const [result, setResult] = useState(null); // { state, checkedIn, booking, today } | { error, message }
  const busy = useRef(false);
  const submit = useCallback(
    async (body) => {
      if (busy.current) return;
      busy.current = true;
      const r = await checkIn(body);
      busy.current = false;
      if (r.error) {
        setResult({ error: r.error.error === 'not_found' ? 'not_found' : 'invalid', message: r.error.message });
        navigator.vibrate?.([60, 60, 60]);
        return;
      }
      setResult(r.data);
      navigator.vibrate?.(r.data.state === 'ok' ? 80 : [60, 60, 60]);
    },
    [checkIn],
  );
  return { submit, result, clear: () => setResult(null), loading: state.isLoading };
}

/** A code from the QR code's link (?code=…), once, then cleaned from the address bar. */
function useCodeFromUrl(submit, setTyped) {
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get('code');
    if (!code) return;
    setTyped?.(pretty(code));
    submit({ code });
    window.history.replaceState(null, '', window.location.pathname);
  }, [submit, setTyped]);
}

function CodeForm({ onSubmit, loading, dark = false, autoFocus = false }) {
  const [typed, setTyped] = useState('');
  const ready = typed.replace('-', '').length === 8;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (ready) onSubmit(typed, () => setTyped(''));
      }}
      className="flex gap-2"
    >
      <Input
        value={typed}
        onChange={(e) => setTyped(pretty(e.target.value))}
        placeholder="ABCD-EFGH"
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        autoFocus={autoFocus}
        aria-label="Check-in code"
        className={`flex-1 text-center font-mono text-xl tracking-[0.3em] uppercase ${dark ? 'border-white/20 bg-white/10 text-white placeholder:text-white/40' : ''}`}
      />
      <Button type="submit" loading={loading} disabled={!ready}>
        Check in
      </Button>
    </form>
  );
}

// ---- The hub (in the app) ----

/** The Check-in tab of the Bookings page (BookingsList.jsx, #check-in). */
export function CheckInPage() {
  const overview = useOverviewQuery();
  const tz = overview.data?.timeZone;
  const { submit, result, clear, loading } = useCheckIn();
  useCodeFromUrl(submit);

  if (!tz) return <Loading />;
  return (
    <>
      <div className="grid gap-5 desktop:grid-cols-2 desktop:items-start">
        <div className="flex flex-col gap-4">
          <a href={`${bookingsBase}/scan`} className="group flex items-center gap-4 rounded-card border border-line bg-surface p-4 transition hover:border-brand hover:shadow-md">
            <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-brand text-brand-ink transition group-hover:scale-105">
              <Icon d={ICONS.qr} className="size-7" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-semibold text-ink">Scan QR codes</span>
              <span className="block text-sm text-muted">Opens the full-screen scanner. Best on a phone or tablet at the front desk.</span>
            </span>
            <Icon d={ICONS.chevronRight} className="size-5 text-faint transition group-hover:translate-x-0.5 group-hover:text-brand" />
          </a>
          <div className="rounded-card border border-line bg-surface p-4">
            <p className="text-sm font-semibold text-ink">Scan not working? Type the code</p>
            <p className="mt-0.5 mb-3 text-[13px] text-faint">It’s under the QR code in the email, like ABCD-EFGH.</p>
            <CodeForm loading={loading} onSubmit={(code, reset) => submit({ code }).then(reset)} />
          </div>
          <div aria-live="polite">{result && <Result result={result} tz={tz} onNext={clear} onCheckIn={submit} />}</div>
        </div>
        <TodayList tz={tz} onCheckIn={submit} />
      </div>
    </>
  );
}

/** Today's appointments and who has checked in. */
function TodayList({ tz, onCheckIn }) {
  const today = todayIn(tz);
  const q = useBookingsQuery({ view: 'all', from: today, to: today });
  const list = (q.data ?? []).filter((b) => b.status === 'confirmed').sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
  const done = list.filter((b) => b.checkedInAt).length;
  return (
    <section className="overflow-hidden rounded-card border border-line bg-surface">
      <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <h2 className="font-semibold text-ink">Today</h2>
        {list.length > 0 && (
          <span className="flex items-center gap-2 text-sm text-muted">
            <span className="h-1.5 w-20 overflow-hidden rounded-full bg-sunken">
              <span className="block h-full rounded-full bg-ok" style={{ width: `${(done / list.length) * 100}%` }} />
            </span>
            {done} of {list.length} checked in
          </span>
        )}
      </header>
      {q.isLoading ? (
        <Loading />
      ) : !list.length ? (
        <p className="px-4 py-8 text-center text-sm text-faint">No appointments today.</p>
      ) : (
        <ul className="divide-y divide-line">
          {list.map((b) => (
            <li key={b.id} className="flex items-center gap-3 px-4 py-2.5">
              <span className="w-16 shrink-0 text-sm font-semibold tabular-nums">{b.dateOnly ? 'Day' : fmtTime(b.startsAt, tz)}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{b.customer.name}</span>
                <span className="block truncate text-xs text-faint">{b.service.name}</span>
              </span>
              {b.checkedInAt ? (
                <Badge tone="ok">✓ {fmtTime(b.checkedInAt, tz)}</Badge>
              ) : (
                <Button size="sm" variant="secondary" onClick={() => onCheckIn({ id: b.id, force: true })}>
                  Check in
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---- The dedicated scanner (full screen, no app menu) ----

export function ScanPage() {
  const { data: me } = useMeQuery();
  const overview = useOverviewQuery();
  const tz = overview.data?.timeZone;
  const { submit, result, clear, loading } = useCheckIn();
  const [typing, setTyping] = useState(false);
  useCodeFromUrl(submit);
  // Each new result: close the code field; Escape goes back to scanning.
  useEffect(() => {
    if (result) setTyping(false);
  }, [result]);
  useEffect(() => {
    const key = (e) => e.key === 'Escape' && result && !document.querySelector('dialog[open]') && clear();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [result, clear]);

  return (
    <div className="fixed inset-0 flex flex-col bg-[#0b0d12] text-white">
      <header className="relative z-10 flex items-center gap-3 px-4 py-3">
        <a href={`${bookingsBase}#check-in`} className="grid size-10 place-items-center rounded-full bg-white/10 hover:bg-white/20" aria-label="Close the scanner">
          <Icon d="M6 6l12 12M18 6L6 18" className="size-5" />
        </a>
        <div className="min-w-0 flex-1 text-center">
          <p className="truncate text-sm font-semibold">{me?.business?.name}</p>
          <p className="text-xs text-white/60">Check-in scanner</p>
        </div>
        <button type="button" onClick={() => setTyping((v) => !v)} className={`flex h-10 cursor-pointer items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold ${typing ? 'bg-white text-ink' : 'bg-white/10 hover:bg-white/20'}`} aria-expanded={typing}>
          Type code
        </button>
      </header>

      <div className="relative min-h-0 flex-1">
        <Scanner fullscreen autoStart paused={!!result || loading || typing} onCode={(code) => submit({ code })} />
        {loading && (
          <div className="absolute inset-0 grid place-items-center bg-black/40">
            <Spinner className="size-8 text-white" />
          </div>
        )}
      </div>

      {typing && !result && (
        <div className="relative z-10 border-t border-white/10 bg-[#0b0d12] px-4 pt-4 pb-[max(16px,env(safe-area-inset-bottom))] motion-safe:animate-rise">
          <p className="mb-2 text-sm font-semibold">Type the code under the QR code</p>
          <CodeForm dark autoFocus loading={loading} onSubmit={(code) => submit({ code })} />
        </div>
      )}
      {!typing && !result && (
        <p className="relative z-10 px-6 pt-3 pb-[max(20px,env(safe-area-inset-bottom))] text-center text-sm text-white/70">Point the camera at the customer’s QR code. If it won’t scan, tap “Type code”.</p>
      )}

      {result && tz && (
        <div className="absolute inset-x-0 bottom-0 z-20 max-h-[85vh] overflow-y-auto rounded-t-3xl bg-canvas p-4 pb-[max(16px,env(safe-area-inset-bottom))] text-ink shadow-[0_-12px_40px_rgba(0,0,0,0.4)] motion-safe:animate-rise" aria-live="polite">
          <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-line-strong" aria-hidden="true" />
          <div className="mx-auto max-w-lg">
            <Result result={result} tz={tz} onNext={clear} onCheckIn={submit} />
          </div>
        </div>
      )}
    </div>
  );
}

/** The camera: BarcodeDetector where the browser has it (Chrome, Android), else jsQR on frames. */
export function Scanner({ paused, onCode, autoStart = false }) {
  const video = useRef(null);
  const canvas = useRef(null);
  const stream = useRef(null);
  const [status, setStatus] = useState('idle'); // idle | starting | on | error
  const [error, setError] = useState('');
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const onCodeRef = useRef(onCode);
  onCodeRef.current = onCode;

  const stop = useCallback(() => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    setStatus((s) => (s === 'error' ? s : 'idle'));
  }, []);

  const start = async () => {
    setError('');
    if (!navigator.mediaDevices?.getUserMedia) {
      setStatus('error');
      setError('This browser can’t use the camera here (it needs a secure https page). Type the code instead.');
      return;
    }
    setStatus('starting');
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
      video.current.srcObject = stream.current;
      await video.current.play();
      setStatus('on');
    } catch (err) {
      setStatus('error');
      setError(err?.name === 'NotAllowedError' ? 'Camera access was blocked. Allow the camera for this site in your browser settings, or type the code.' : 'No camera could be opened. Type the code instead.');
    }
  };

  useEffect(() => stop, [stop]);
  // The dedicated scanner page opens the camera right away (the browser asks for permission once).
  useEffect(() => {
    if (autoStart) start();
  }, [autoStart]); // eslint-disable-line react-hooks/exhaustive-deps

  // Read frames while the camera is on and no result is showing.
  useEffect(() => {
    if (status !== 'on') return undefined;
    let cancelled = false;
    let timer;
    let detector = null;
    let jsQR = null;
    const setup = async () => {
      if ('BarcodeDetector' in window) {
        try {
          const formats = await window.BarcodeDetector.getSupportedFormats();
          if (formats.includes('qr_code')) detector = new window.BarcodeDetector({ formats: ['qr_code'] });
        } catch {
          detector = null;
        }
      }
      if (!detector) jsQR = (await import('jsqr')).default;
    };
    const tick = async () => {
      if (cancelled) return;
      const v = video.current;
      if (!pausedRef.current && v && v.readyState >= 2) {
        try {
          let text = null;
          if (detector) {
            const found = await detector.detect(v);
            text = found[0]?.rawValue ?? null;
          } else if (jsQR) {
            const c = canvas.current;
            const w = Math.min(640, v.videoWidth);
            const h = Math.round((v.videoHeight / v.videoWidth) * w);
            c.width = w;
            c.height = h;
            const g = c.getContext('2d', { willReadFrequently: true });
            g.drawImage(v, 0, 0, w, h);
            text = jsQR(g.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' })?.data ?? null;
          }
          if (text) onCodeRef.current(text);
        } catch {
          // a frame that can't be read: try the next one
        }
      }
      timer = setTimeout(tick, 220);
    };
    setup().then(tick);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [status]);

  const on = status === 'on';
  return (
    <div className="absolute inset-0 overflow-hidden">
      <video ref={video} playsInline muted className={`size-full object-cover ${on ? '' : 'hidden'}`} />
      <canvas ref={canvas} className="hidden" />
      {on && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center" aria-hidden="true">
          {/* Dim everything but the frame. */}
          <div className={`relative aspect-square w-[68%] max-w-80 rounded-3xl shadow-[0_0_0_200vmax_rgba(0,0,0,0.45)] transition-opacity ${paused ? 'opacity-40' : ''}`}>
            {['top-0 left-0 border-t-4 border-l-4 rounded-tl-3xl', 'top-0 right-0 border-t-4 border-r-4 rounded-tr-3xl', 'bottom-0 left-0 border-b-4 border-l-4 rounded-bl-3xl', 'right-0 bottom-0 border-r-4 border-b-4 rounded-br-3xl'].map((c) => (
              <span key={c} className={`absolute size-10 border-white ${c}`} />
            ))}
            {!paused && <span className="absolute inset-x-4 top-1/2 h-0.5 rounded-full bg-brand shadow-[0_0_14px_var(--color-brand)] motion-safe:animate-pulse" />}
          </div>
          <span className="absolute top-4 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full bg-black/50 px-3 py-1 text-xs font-medium">
            {paused ? 'Paused' : (
              <>
                <span className="size-2 rounded-full bg-ok motion-safe:animate-pulse" /> Scanning
              </>
            )}
          </span>
        </div>
      )}
      {!on && (
        <div className="absolute inset-0 grid place-items-center p-6 text-center">
          <div className="max-w-xs">
            <span className="mx-auto grid size-16 place-items-center rounded-full bg-white/10">
              {status === 'starting' ? <Spinner className="size-7" /> : <Icon d={ICONS.qr} className="size-8" />}
            </span>
            <p className="mt-4 text-sm text-white/80">{status === 'error' ? error : status === 'starting' ? 'Opening the camera…' : 'Use this device’s camera to scan QR codes.'}</p>
            {status !== 'starting' && (
              <Button className="mt-4" onClick={start}>
                {status === 'error' ? 'Try again' : 'Start camera'}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** 'YYYY-MM-DD' of an instant in the business's time zone. */
const dayIn = (iso, tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));

const when = (b, tz) => `${fmtLongDate(b.date)}${b.dateOnly ? '' : `, ${fmtTime(b.startsAt, tz)}`}`;

/** What happened, and what the front desk can do about it. */
function Result({ result, tz, onNext, onCheckIn }) {
  const [undo, undoState] = useUndoCheckInMutation();
  const [fixing, setFixing] = useState(null); // 'move' | 'recreate'

  if (result.error) {
    return (
      <ResultCard tone="danger" icon={ICONS.xCircle} title={result.error === 'not_found' ? 'No booking found' : 'That code doesn’t look right'} onNext={onNext}>
        <p>{result.error === 'not_found' ? 'No booking of this business matches the code. Check it with the customer, or look them up in Bookings.' : result.message}</p>
      </ResultCard>
    );
  }

  const b = result.booking;
  const who = (
    <div className="rounded-btn bg-surface/70 px-3 py-2.5 text-ink">
      <p className="font-semibold">{b.customer.name}</p>
      <p className="text-sm text-muted">
        {b.service.name} · {when(b, tz)}
      </p>
      <p className="mt-0.5 font-mono text-xs tracking-wider text-faint">{b.checkInCode}</p>
    </div>
  );
  const fixButtons = (move, recreate) => (
    <div className="flex flex-wrap gap-2">
      {move && (
        <Button size="sm" onClick={() => setFixing('move')}>
          Move to today
        </Button>
      )}
      {recreate && (
        <Button size="sm" variant={move ? 'secondary' : 'primary'} onClick={() => setFixing('recreate')}>
          Book again for today
        </Button>
      )}
      {b.status !== 'cancelled' && (
        <Button size="sm" variant="secondary" onClick={() => onCheckIn({ id: b.id, force: true })}>
          Check in anyway
        </Button>
      )}
    </div>
  );

  let card;
  if (result.state === 'ok' || result.checkedIn) {
    card = (
      <ResultCard tone="ok" icon={ICONS.check} title="Checked in" onNext={onNext}>
        {who}
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm">Marked as attended at {fmtTime(b.checkedInAt, tz)}.</span>
          <Button
            size="sm"
            variant="ghost"
            loading={undoState.isLoading}
            onClick={async () => {
              const r = await undo(b.id);
              if (r.error) return toast.error(r.error.message);
              toast.success('Check-in undone');
              onNext();
            }}
          >
            Undo
          </Button>
        </div>
      </ResultCard>
    );
  } else if (result.state === 'already') {
    card = (
      <ResultCard tone="info" icon={ICONS.check} title="Already checked in" onNext={onNext}>
        {who}
        <p className="text-sm">
          Checked in {dayIn(b.checkedInAt, tz) === result.today ? 'today' : `on ${fmtLongDate(dayIn(b.checkedInAt, tz))}`} at {fmtTime(b.checkedInAt, tz)}. Nothing else to do.
        </p>
      </ResultCard>
    );
  } else if (result.state === 'other_day') {
    card = (
      <ResultCard tone="warn" icon={ICONS.calendar} title="This booking is for another day" onNext={onNext}>
        {who}
        <p className="text-sm">
          It’s booked for <strong>{when(b, tz)}</strong>, not today. Would you like to move it to today?
        </p>
        {fixButtons(true, false)}
      </ResultCard>
    );
  } else if (result.state === 'expired') {
    card = (
      <ResultCard tone="warn" icon={ICONS.clock} title="This booking has expired" onNext={onNext}>
        {who}
        <p className="text-sm">
          The appointment was <strong>{when(b, tz)}</strong> and is over. Move it to today, or book it again as a new appointment?
        </p>
        {fixButtons(true, true)}
      </ResultCard>
    );
  } else {
    card = (
      <ResultCard tone="danger" icon={ICONS.xCircle} title="This booking was cancelled" onNext={onNext}>
        {who}
        <p className="text-sm">
          It was cancelled{b.cancelledBy ? ` by ${b.cancelledBy === 'customer' ? 'the customer' : 'your team'}` : ''}
          {b.cancelReason ? `: “${b.cancelReason}”` : '.'} Would you like to book it again for today?
        </p>
        {fixButtons(false, true)}
      </ResultCard>
    );
  }

  return (
    <>
      {card}
      {fixing && (
        <FixDialog
          mode={fixing}
          booking={b}
          tz={tz}
          today={result.today}
          onClose={() => setFixing(null)}
          onDone={(id, checkInNow) => {
            setFixing(null);
            if (checkInNow) onCheckIn({ id, force: true });
            else onNext();
          }}
        />
      )}
    </>
  );
}

const TONES = {
  ok: { box: 'border-ok/30 bg-ok-soft', icon: 'bg-ok text-white', title: 'text-ok' },
  info: { box: 'border-brand/25 bg-brand-soft', icon: 'bg-brand text-brand-ink', title: 'text-brand' },
  warn: { box: 'border-warn/30 bg-warn-soft', icon: 'bg-warn text-white', title: 'text-warn' },
  danger: { box: 'border-danger/30 bg-danger-soft', icon: 'bg-danger text-white', title: 'text-danger' },
};

export function ResultCard({ tone, icon, title, children, onNext }) {
  const t = TONES[tone];
  return (
    <section className={`flex flex-col gap-3 rounded-card border p-4 motion-safe:animate-rise ${t.box}`} role={tone === 'danger' || tone === 'warn' ? 'alert' : 'status'}>
      <div className="flex items-center gap-3">
        <span className={`grid size-10 shrink-0 place-items-center rounded-full ${t.icon}`}>
          <Icon d={icon} className="size-5" />
        </span>
        <h2 className={`text-lg font-bold ${t.title}`}>{title}</h2>
      </div>
      {children}
      <div className="border-t border-current/10 pt-3">
        <Button variant="secondary" size="sm" onClick={onNext}>
          <Icon d={ICONS.qr} className="size-4" /> Scan next
        </Button>
      </div>
    </section>
  );
}

/** Move the booking (reschedule), or book it again as a new appointment, then check in when it's today. */
function FixDialog({ mode, booking: b, tz, today, onClose, onDone }) {
  const [from, setFrom] = useState(today);
  const [pick, setPick] = useState(null);
  const q = useAdminAvailabilityQuery({ serviceId: b.service.id, from, ...(mode === 'move' ? { exclude: b.id } : {}) });
  const [move, moveState] = useRescheduleBookingMutation();
  const [add, addState] = useAddBookingMutation();
  const busy = moveState.isLoading || addState.isLoading;
  const when = pick ? (pick.startsAt ? `${fmtLongDate(pick.date)}, ${fmtTime(pick.startsAt, tz)}` : fmtLongDate(pick.date)) : null;

  const confirm = async () => {
    const at = pick.startsAt ? { startsAt: pick.startsAt } : { date: pick.date };
    const r =
      mode === 'move'
        ? await move({ id: b.id, ...at })
        : await add({ serviceId: b.service.id, ...at, name: b.customer.name, email: b.customer.email, ...(b.customer.phone ? { phone: b.customer.phone } : {}), note: `Booked again at check-in (was ${fmtLongDate(b.date)})` });
    if (r.error) return toast.error(r.error.message);
    const id = mode === 'move' ? b.id : r.data.id;
    toast.success(mode === 'move' ? 'Booking moved. The customer was emailed.' : 'New booking made. The customer gets a confirmation email.');
    onDone(id, pick.date === today);
  };

  return (
    <Dialog
      open
      wide
      onClose={onClose}
      dirty={!!pick}
      busy={busy}
      title={mode === 'move' ? `Move ${b.customer.name}’s booking` : `Book ${b.customer.name} again`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={confirm} disabled={!pick} loading={busy}>
            {pick?.date === today ? (mode === 'move' ? 'Move and check in' : 'Book and check in') : mode === 'move' ? 'Move booking' : 'Book'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Notice tone="info">
          {b.service.name} · now {fmtLongDate(b.date)}
          {!b.dateOnly && `, ${fmtTime(b.startsAt, tz)}`}. {mode === 'move' ? 'Pick the new time (today is shown first).' : 'Pick a time for the new booking (today is shown first).'}
          {when && (
            <>
              {' '}
              <Badge tone="brand">{when}</Badge>
            </>
          )}
        </Notice>
        {q.isLoading ? (
          <div className="grid place-items-center py-10">
            <Spinner />
          </div>
        ) : (
          <SlotPicker data={q.data} loading={q.isFetching} from={from} onFromChange={setFrom} today={today} value={pick} onChange={setPick} />
        )}
      </div>
    </Dialog>
  );
}

