import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { usePathname } from '../../lib/router.js';
import { useScannerCheckInMutation, useScannerPageQuery, useScannerSessionQuery, useScannerSignInMutation, useScannerSignOutMutation, useScannerUndoMutation } from '../api.js';
import { ClaimResult, EventResult } from '../bookings/EventsPages.jsx';
import { Scanner } from '../bookings/CheckInPage.jsx';
import { fmtLongDate } from '../lib/format.js';
import { Badge, Icon, ICONS, Loading, Spinner, useConfirm, usePrompt } from '../ui.jsx';

// The event scanner site (scanner.bytebuntech.com; backend: booking/event-scanners.ts).
//   /                                      sign in: scanner code + access code
//   /{company}/{event}/{scannerCode}       the scanner's own link: only the access code to enter
// Once signed in, the device stays signed in (the session token is kept in this browser) until the
// organizer revokes the access code or deletes the scanner: it re-checks every few seconds and on
// every scan, and signs itself out. One device per access code. The header shows the company, the
// event, the person and their role (Attendance by default).

const KEY = 'bb-scanner';
const read = () => {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return v?.scannerCode && v?.token ? v : null;
  } catch {
    return null;
  }
};
const save = (v) => {
  try {
    if (v) localStorage.setItem(KEY, JSON.stringify(v));
    else localStorage.removeItem(KEY);
  } catch {
    // private mode: the session lasts until the tab closes
  }
};
const plain = (code) => code.toUpperCase().replace(/[^A-Z0-9]/g, '');
/** Codes never contain these look-alikes (0/O, 1/I/L). */
const LOOKALIKES = /[01ILO]/;

export function ScannerApp() {
  const path = usePathname();
  const fromLink = /^\/[a-z0-9-]+\/[a-z0-9-]+\/([A-Za-z0-9]{8})\/?$/.exec(path)?.[1] ?? null;
  const [creds, setCreds] = useState(read);
  const [notice, setNotice] = useState(null);
  const signedIn = creds && (!fromLink || plain(fromLink) === plain(creds.scannerCode));

  const signOut = useCallback((why) => {
    save(null);
    setCreds(null);
    setNotice(why ?? null);
  }, []);

  useEffect(() => {
    document.title = 'Byte Bun Scanner';
  }, []);

  if (signedIn) return <ScanningScreen creds={creds} onSignedOut={signOut} />;
  return (
    <SignIn
      scannerCode={fromLink}
      notice={notice}
      onSignedIn={(v) => {
        save(v);
        setCreds(v);
        setNotice(null);
      }}
    />
  );
}

// ---- Sign in ----

function SignIn({ scannerCode: fromLink, notice, onSignedIn }) {
  const [signIn, state] = useScannerSignInMutation();
  const [scannerCode, setScannerCode] = useState(fromLink ? plain(fromLink).slice(0, 8) : '');
  const [accessCode, setAccessCode] = useState('');
  // Errors from Verify, shown under the field they're about.
  const [error, setError] = useState({ field: null, message: '' });
  // Nothing is checked while typing: both codes are verified together when "Verify" is pressed.
  // Only a scanner's own link (the code came in the URL) shows who and what it's for up front.
  const lookup = useScannerPageQuery(scannerCode, { skip: !fromLink });
  const page = fromLink ? lookup.data : null;
  const color = page?.branding?.primaryColor ?? '#6366F1';
  const ready = scannerCode.length === 8 && accessCode.length === 8;
  const clear = () => setError({ field: null, message: '' });

  const submit = async (ev) => {
    ev.preventDefault();
    if (!ready) return;
    clear();
    const r = await signIn({ scannerCode, accessCode });
    if (r.error) return setError({ field: r.error.error === 'scanner_gone' && !fromLink ? 'scanner' : 'access', message: r.error.message });
    onSignedIn({ scannerCode: r.data.scannerCode, token: r.data.token });
  };

  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden bg-[#07080c] px-4 py-10 text-white" style={{ '--scanner-glow': color }}>
      {/* Soft glows in the business's color, and a faint grid. */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <div className="absolute -top-40 -left-32 size-[34rem] rounded-full opacity-40 blur-3xl transition-colors duration-700" style={{ background: 'radial-gradient(closest-side, var(--scanner-glow), transparent)' }} />
        <div className="absolute -right-40 -bottom-48 size-[38rem] rounded-full opacity-30 blur-3xl transition-colors duration-700" style={{ background: 'radial-gradient(closest-side, var(--scanner-glow), transparent)' }} />
        <div className="absolute inset-0 opacity-[0.06] [background-image:linear-gradient(white_1px,transparent_1px),linear-gradient(90deg,white_1px,transparent_1px)] [background-size:44px_44px] [mask-image:radial-gradient(ellipse_at_center,black,transparent_70%)]" />
      </div>

      <div className="relative w-full max-w-[400px] motion-safe:animate-rise">
        <div className="mb-7 text-center">
          <ScanMark color={color} />
          <h1 className="mt-5 text-2xl font-bold tracking-tight">Event scanner</h1>
          <p className="mt-1.5 text-sm text-white/60">Sign in with the codes the organizer gave you.</p>
        </div>

        {notice && (
          <div className="mb-4 flex items-start gap-3 rounded-2xl border border-amber-300/30 bg-amber-300/10 px-4 py-3 text-sm text-amber-50" role="status">
            <Icon d={ICONS.xCircle} className="mt-0.5 size-4 shrink-0 text-amber-300" />
            <span>{notice}</span>
          </div>
        )}

        <form onSubmit={submit} noValidate className="rounded-3xl border border-white/10 bg-white/[0.06] p-6 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.7)] backdrop-blur-xl mobile:p-5">
          {page && <EventPreview page={page} color={color} />}

          <div className="flex flex-col gap-5">
            {!fromLink && (
              <CodeField
                id="scanner-code"
                label="Scanner code"
                value={scannerCode}
                onChange={(v) => {
                  setScannerCode(v);
                  clear();
                }}
                autoFocus
                autoComplete="username"
                color={color}
                error={error.field === 'scanner' ? error.message : null}
              />
            )}
            <CodeField
              id="access-code"
              label="Access code"
              value={accessCode}
              onChange={(v) => {
                setAccessCode(v);
                clear();
              }}
              autoFocus={!!fromLink}
              autoComplete="current-password"
              secret
              color={color}
              error={error.field === 'access' ? error.message : null}
            />
          </div>

          <button
            type="submit"
            disabled={!ready || state.isLoading}
            className="mt-6 flex h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-2xl text-[15px] font-semibold text-white shadow-lg transition hover:brightness-110 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
            style={{ background: `linear-gradient(135deg, ${color}, color-mix(in srgb, ${color} 55%, #000))`, boxShadow: ready ? `0 12px 30px -10px ${color}` : undefined }}
          >
            {state.isLoading ? <Spinner className="size-5" /> : <Icon d={ICONS.check} className="size-5" />}
            {state.isLoading ? 'Verifying…' : 'Verify'}
          </button>
        </form>

        <p className="mt-5 flex items-center justify-center gap-2 text-center text-xs text-white/45">
          <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="5" y="11" width="14" height="10" rx="2" />
            <path d="M8 11V7a4 4 0 018 0v4" />
          </svg>
          Each access code works on one device. You stay signed in until the organizer ends your access.
        </p>

        <p className="mt-8 text-center text-xs text-white/40">
          Powered by{' '}
          <a href="https://bookings.bytebuntech.com" target="_blank" rel="noreferrer" className="font-semibold text-white/70 hover:text-white">
            Byte Bun Bookings
          </a>{' '}
          ·{' '}
          <a href="https://bytebuntech.com" target="_blank" rel="noreferrer" className="font-semibold text-white/70 hover:text-white">
            Byte Bun Tech
          </a>
        </p>
      </div>
    </main>
  );
}

/** The app's mark: a QR code with a scan line sweeping over it. */
function ScanMark({ color }) {
  return (
    <span className="relative mx-auto grid size-20 place-items-center overflow-hidden rounded-[26px] border border-white/15 bg-white/[0.07] shadow-[inset_0_1px_0_rgba(255,255,255,0.15)]">
      <Icon d={ICONS.qr} className="size-9 text-white/90" />
      <span aria-hidden="true" className="absolute inset-x-3 h-0.5 rounded-full motion-safe:animate-[scanline_2.4s_ease-in-out_infinite]" style={{ background: color, boxShadow: `0 0 14px 2px ${color}` }} />
      <style>{'@keyframes scanline { 0%, 100% { top: 22%; } 50% { top: 76%; } }'}</style>
    </span>
  );
}

/** Who and what this sign-in is for: shown once the scanner code is recognised. */
function EventPreview({ page, color }) {
  const d = new Date(`${page.event.date}T12:00:00Z`);
  const f = (o) => new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', ...o }).format(d);
  const initials = page.scanner.name
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('');
  return (
    <div className="mb-6 motion-safe:animate-rise">
      <p className="mb-2 text-[11px] font-semibold tracking-[0.14em] text-white/45 uppercase">You’re signing in to</p>
      <div className="flex items-center gap-3.5">
        <div className="w-14 shrink-0 overflow-hidden rounded-xl bg-white text-center text-ink shadow-md" aria-hidden="true">
          <div className="py-0.5 text-[10px] font-bold tracking-[0.12em] text-white uppercase" style={{ background: color }}>
            {f({ month: 'short' })}
          </div>
          <div className="py-1.5 text-2xl leading-none font-bold tabular-nums">{d.getUTCDate()}</div>
        </div>
        <div className="min-w-0">
          <p className="truncate font-semibold">{page.event.title}</p>
          <p className="truncate text-sm text-white/55">
            {page.company.name} · {fmtLongDate(page.event.date)}
          </p>
        </div>
      </div>
      <div className="mt-4 flex items-center gap-3 rounded-2xl bg-white/[0.06] px-3 py-2.5">
        <span className="grid size-9 shrink-0 place-items-center rounded-full text-sm font-bold text-white" style={{ background: color }}>
          {initials}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{page.scanner.name}</span>
        <span className="shrink-0 rounded-full border border-white/15 px-2.5 py-0.5 text-xs font-semibold text-white/80">{page.scanner.role}</span>
      </div>
      <div className="mt-5 h-px bg-gradient-to-r from-transparent via-white/15 to-transparent" />
    </div>
  );
}

/**
 * An 8-character code in one field, shown as "ABCD-EFGH". Typing, pasting and password managers
 * all work; the dash is added for you. Secret codes can be shown or hidden.
 */
function CodeField({ id, label, value, onChange, autoFocus, autoComplete, secret = false, color, error }) {
  const [focused, setFocused] = useState(false);
  const [show, setShow] = useState(!secret);
  const shown = value.length > 4 ? `${value.slice(0, 4)}-${value.slice(4)}` : value;
  const done = value.length === 8;
  const lookalike = LOOKALIKES.test(value) ? 'Codes never contain 0, O, 1, I or L. Check that character with the organizer: it may be Q, D, 2, 7 or J.' : null;
  error = error ?? lookalike;
  const ring = error ? 'rgba(248,113,113,0.7)' : focused ? color : done ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.12)';
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <label htmlFor={id} className="text-sm font-semibold text-white/85">
          {label}
        </label>
        <span className={`text-xs tabular-nums transition-colors ${done ? 'text-emerald-300' : 'text-white/40'}`} aria-hidden="true">
          {done ? '✓ Complete' : `${value.length}/8`}
        </span>
      </div>
      <div
        className="flex h-14 items-center gap-3 rounded-2xl border bg-white/[0.05] px-4 transition-[border-color,box-shadow,background-color] duration-150"
        style={{ borderColor: ring, boxShadow: focused && !error ? `0 0 0 4px color-mix(in srgb, ${color} 25%, transparent)` : undefined, backgroundColor: focused ? 'rgba(255,255,255,0.08)' : undefined }}
      >
        <svg viewBox="0 0 24 24" className="size-5 shrink-0 text-white/45" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          {secret ? (
            <>
              <rect x="5" y="11" width="14" height="10" rx="2" />
              <path d="M8 11V7a4 4 0 018 0v4" />
            </>
          ) : (
            <path d="M4 7V5a1 1 0 011-1h2M17 4h2a1 1 0 011 1v2M20 17v2a1 1 0 01-1 1h-2M7 20H5a1 1 0 01-1-1v-2M8 8h3v3H8zM13 13h3v3h-3zM13 8h3v3h-3zM8 13h3v3H8z" />
          )}
        </svg>
        <input
          id={id}
          type={secret && !show ? 'password' : 'text'}
          value={shown}
          onChange={(e) => onChange(plain(e.target.value).slice(0, 8))}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          autoFocus={autoFocus}
          autoComplete={autoComplete}
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          inputMode="text"
          maxLength={9}
          placeholder="XXXX-XXXX"
          aria-invalid={!!error}
          aria-describedby={error ? `${id}-error` : undefined}
          className="min-w-0 flex-1 bg-transparent font-mono text-xl font-semibold tracking-[0.28em] text-white uppercase outline-none placeholder:tracking-[0.28em] placeholder:text-white/20"
        />
        {secret && value && (
          <button type="button" onClick={() => setShow((v) => !v)} className="shrink-0 cursor-pointer rounded-lg px-2 py-1 text-xs font-semibold text-white/55 hover:bg-white/10 hover:text-white" aria-label={show ? 'Hide the access code' : 'Show the access code'}>
            {show ? 'Hide' : 'Show'}
          </button>
        )}
      </div>
      {error && (
        <p id={`${id}-error`} className="mt-2 text-[13px] text-red-300" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

// ---- Scanning ----

function ScanningScreen({ creds, onSignedOut }) {
  const { scannerCode, token } = creds;
  const page = useScannerPageQuery(scannerCode);
  // Still signed in? Every few seconds, so a revoked or deleted scanner signs out by itself.
  const session = useScannerSessionQuery({ scannerCode, token }, { pollingInterval: 8000, refetchOnFocus: true, refetchOnReconnect: true });
  const [checkIn, state] = useScannerCheckInMutation();
  const [undo] = useScannerUndoMutation();
  const [signOutApi] = useScannerSignOutMutation();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const [result, setResult] = useState(null);
  const busy = useRef(false);

  const endedBy = (err) => (err?.status === 401 || err?.status === 404 ? (err.error === 'access_revoked' ? 'Your access was revoked by the organizer.' : err.status === 404 ? 'This scanner was deleted by the organizer.' : 'This device was signed out of the scanner.') : null);

  useEffect(() => {
    const why = endedBy(session.error) ?? endedBy(page.error);
    if (why) onSignedOut(why);
  }, [session.error, page.error, onSignedOut]);

  const submit = async (body) => {
    if (busy.current) return;
    busy.current = true;
    const r = await checkIn({ scannerCode, token, ...body });
    busy.current = false;
    if (r.error) {
      const why = endedBy(r.error);
      if (why) return onSignedOut(why);
      setResult({ error: r.error.error, message: r.error.message, event: r.error.event });
      navigator.vibrate?.([60, 60, 60]);
      return;
    }
    setResult(r.data);
    navigator.vibrate?.(r.data.checkedIn ? 80 : [60, 60, 60]);
    session.refetch();
  };

  if (page.isLoading || !page.data) return <Loading />;
  const { company, event, scanner, section } = page.data;
  const claiming = section?.kind === 'claimable';
  const undoIt = async (ticketId) => {
    const r = await undo({ scannerCode, token, ticketId });
    if (r.error) toast.error(r.error.message);
    setResult(null);
    session.refetch();
  };
  const counts = session.data;

  return (
    <div className="fixed inset-0 flex flex-col bg-[#0b0d12] text-white">
      <header className="relative z-10 flex items-start gap-3 px-4 pt-3 pb-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold tracking-wide text-white/60 uppercase">{company.name}</p>
          <p className="truncate font-semibold">{event.title}</p>
          <p className="text-xs text-white/60">{fmtLongDate(event.date)}</p>
        </div>
        <button
          type="button"
          onClick={async () => {
            if (!(await confirm({ title: 'Sign out of the scanner?', body: 'You can sign back in later with the same scanner code and access code, on this or another device.', action: 'Sign out', tone: 'neutral' }))) return;
            // Frees the access code in the backend, so it can sign in again (one device at a time).
            await signOutApi({ scannerCode, token });
            onSignedOut('You signed out. Sign in again with the same codes whenever you’re ready.');
          }}
          className="flex h-9 cursor-pointer items-center gap-2 rounded-full bg-white/10 py-1 pr-3 pl-1 text-left hover:bg-white/20"
          title="Signed in as"
        >
          <span className="grid size-7 place-items-center rounded-full bg-brand text-xs font-bold text-brand-ink">{scanner.name.split(' ').map((p) => p[0]).slice(0, 2).join('')}</span>
          <span className="max-w-32 leading-tight">
            <span className="block truncate text-xs font-semibold">{scanner.name}</span>
            <span className="block truncate text-[11px] text-white/60">{scanner.role}</span>
          </span>
        </button>
      </header>
      <div className="relative z-10 flex items-center justify-between gap-3 px-4 pb-3">
        <span className="flex items-center gap-2 text-sm">
          {claiming ? (
            <Badge tone="brand">
              {section.name} · {counts ? `${counts.claimed} claimed` : '…'}
            </Badge>
          ) : (
            <Badge tone="ok">{counts ? `${counts.checkedIn} of ${counts.confirmed}` : '…'} checked in</Badge>
          )}
        </span>
        <button
          type="button"
          disabled={state.isLoading}
          onClick={async () => {
            const code = await prompt({ title: 'Type the code', label: 'Attendee’s check-in code', hint: 'It’s under the QR code in their email, like ABCD-EFGH.', placeholder: 'ABCD-EFGH', action: 'Check in' });
            if (code) submit({ code });
          }}
          className="flex h-9 cursor-pointer items-center rounded-full bg-white/10 px-3.5 text-sm font-semibold hover:bg-white/20"
        >
          Type code
        </button>
      </div>
      <div className="relative min-h-0 flex-1">
        <Scanner autoStart paused={!!result || state.isLoading} onCode={(code) => submit({ code })} />
        {state.isLoading && (
          <div className="absolute inset-0 grid place-items-center bg-black/40">
            <Spinner className="size-8 text-white" />
          </div>
        )}
      </div>
      {!result && <p className="px-6 pt-3 pb-[max(20px,env(safe-area-inset-bottom))] text-center text-sm text-white/70">{claiming ? `Scan the attendee’s QR code to give them ${section.name}. Each attendee can claim it once.` : 'Scan the attendee’s QR code. If it won’t scan, tap “Type code”.'}</p>}
      {result && (
        <div className="absolute inset-x-0 bottom-0 z-20 max-h-[85vh] overflow-y-auto rounded-t-3xl bg-canvas p-4 pb-[max(16px,env(safe-area-inset-bottom))] text-ink shadow-[0_-12px_40px_rgba(0,0,0,0.4)] motion-safe:animate-rise" aria-live="polite">
          <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-line-strong" aria-hidden="true" />
          <div className="mx-auto max-w-lg">
            {result.kind === 'claim' ? (
              <ClaimResult result={result} tz={company.timeZone} onNext={() => setResult(null)} onUndo={undoIt} />
            ) : (
              <EventResult result={result} event={event} tz={company.timeZone} onNext={() => setResult(null)} onForce={(ticketId) => submit({ ticketId, force: true })} onUndo={undoIt} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
