import { useState } from 'react';
import { toast } from 'sonner';
import { LogoMark } from '../../components/Logo.jsx';
import { navigate } from '../../lib/router.js';
import { useAffiliateCodeMutation, useAffiliateInviteQuery, useAffiliateJoinMutation, useAffiliateMeQuery, useAffiliateSignOutMutation, useAffiliateUpdateMutation, useAffiliateVerifyMutation } from '../api.js';
import { Badge, Button, Card, Dialog, Field, Input, Loading, Notice, Select } from '../ui.jsx';

// The affiliate portal (affiliates.*; backend affiliates/affiliate-portal.ts).
//   /join#t=...  a proposal's sign-up link: the offer, then confirm details + payout account
//   /            sign in with an emailed code, then the dashboard: earnings, Byte Bun's program,
//                every event they promote, and the bookings waiting for verification.

const fmtDay = (iso, timeZone) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', ...(timeZone && { timeZone }) }).format(new Date(iso));
const fmtWhen = (iso, timeZone) => new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'short', ...(timeZone && { timeZone }) }).format(new Date(iso));

// The light blue look (client.css :root[data-surface="affiliates"]), also for the loading screen:
// this module only loads on the affiliates host.
document.documentElement.dataset.surface = 'affiliates';

// Partnership icons scattered behind the page (decorative): handshake, linked people, a link,
// a growth chart, a gift and a star. Line drawings, like the app's other icons.
const PARTNER_ICONS = [
  'M11 17l-1.5 1.5a2.1 2.1 0 01-3-3L9 13m4-4l2-2a2.8 2.8 0 014 0l2 2-5.5 5.5a2.1 2.1 0 01-3 0L11 13M3 11l3-3 3 1 3-2 2 1M7 15l1.5 1.5M9 13l1.5 1.5',
  'M8 11a3 3 0 100-6 3 3 0 000 6zM16 11a3 3 0 100-6 3 3 0 000 6zM2 20a6 6 0 0112 0M10 20a6 6 0 0112 0',
  'M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1',
  'M3 20h18M6 16l4-4 3 3 6-7M15 8h4v4',
  'M4 11h16v9H4zM2 7h20v4H2zM12 7v13M12 7c-2-3-6-3-6 0M12 7c2-3 6-3 6 0',
  'M12 3l2.6 5.3 5.9.9-4.2 4.1 1 5.8L12 16.4 6.7 19.1l1-5.8L3.5 9.2l5.9-.9z',
];
const SPOTS = [
  [4, 8, 64, -12], [86, 6, 56, 10], [70, 30, 44, 0], [10, 44, 52, 8], [92, 52, 60, -6], [30, 70, 48, 14],
  [60, 82, 58, -10], [6, 88, 46, 0], [48, 18, 40, 6], [78, 92, 42, 12], [22, 26, 38, -4], [52, 56, 36, 0],
];

function PartnerBackdrop() {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 -z-10 overflow-hidden text-brand">
      {SPOTS.map(([left, top, size, rotate], i) => (
        <svg key={i} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className="absolute opacity-[0.09]" style={{ left: `${left}%`, top: `${top}%`, width: size, height: size, transform: `translate(-50%, -50%) rotate(${rotate}deg)` }}>
          <path d={PARTNER_ICONS[i % PARTNER_ICONS.length]} />
        </svg>
      ))}
    </div>
  );
}

function Shell({ children, right }) {
  return (
    <div className="relative isolate min-h-dvh bg-canvas">
      <PartnerBackdrop />
      <header className="border-b border-line bg-surface/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-2 px-4 py-3">
          <LogoMark className="size-7" />
          <span className="font-semibold">
            Byte Bun <span className="text-brand">Affiliates</span>
          </span>
          <span className="flex-1" />
          {right}
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
    </div>
  );
}

export function AffiliatePortal({ path }) {
  if (path === '/join') return <JoinPage />;
  return <Home />;
}

// ---- Accepting a proposal ----

function JoinPage() {
  const token = new URLSearchParams(window.location.hash.slice(1)).get('t') ?? '';
  const q = useAffiliateInviteQuery(token, { skip: !token });
  const [done, setDone] = useState(null);
  if (!token) return <Shell><Notice tone="danger" title="This link isn’t complete">Open the link from your proposal email again.</Notice></Shell>;
  if (q.isLoading) return <Loading screen />;
  if (q.error)
    return (
      <Shell>
        <Notice tone={q.error.error === 'already_joined' ? 'info' : 'danger'} title={q.error.error === 'already_joined' ? 'Already accepted' : 'This link doesn’t work'}>
          {q.error.message}
        </Notice>
        <div className="mt-4">
          <Button onClick={() => navigate('/')}>Sign in</Button>
        </div>
      </Shell>
    );
  if (done)
    return (
      <Shell>
        <Card title={`Welcome aboard, ${q.data.firstName}!`} description={done.kind === 'plan' ? 'You are now a Byte Bun affiliate.' : `You are now an affiliate for ${done.event.title}.`}>
          <p className="text-sm text-muted">Your promo code</p>
          <p className="my-2 font-mono text-3xl font-bold tracking-widest">{done.promoCode}</p>
          <p className="text-sm text-muted">We emailed it to you too, with how it works.</p>
          <div className="mt-4">
            <Button onClick={() => (window.location.hash = '', navigate('/'))}>Go to my dashboard</Button>
          </div>
        </Card>
      </Shell>
    );
  return (
    <Shell>
      <JoinForm token={token} offer={q.data} onDone={setDone} />
    </Shell>
  );
}

function JoinForm({ token, offer: o, onDone }) {
  const [join, state] = useAffiliateJoinMutation();
  const [f, setF] = useState({ firstName: o.firstName, lastName: o.lastName, phone: o.phone, payoutMethod: 'ewallet', payoutProvider: '', payoutAccountName: `${o.firstName} ${o.lastName}`, payoutAccountNumber: '' });
  const [errors, setErrors] = useState({});
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    setErrors({});
    const body = { token, firstName: f.firstName, lastName: f.lastName, phone: f.phone, ...(o.hasAccount ? {} : { payoutMethod: f.payoutMethod, payoutProvider: f.payoutProvider, payoutAccountName: f.payoutAccountName, payoutAccountNumber: f.payoutAccountNumber }) };
    const r = await join(body);
    if (r.error) {
      setErrors(r.error.fields ?? {});
      return toast.error(r.error.message);
    }
    onDone(r.data);
  };
  const who = o.kind === 'plan' ? 'businesses' : 'attendees';
  return (
    <div className="grid gap-5 desktop:grid-cols-[1fr_1.2fr]">
      <Card title={o.kind === 'plan' ? 'The Byte Bun affiliate program' : `Promote ${o.event.title}`} description={`A proposal from ${o.owner}`}>
        <dl className="flex flex-col gap-3 text-sm">
          {o.event && (
            <div>
              <dt className="text-muted">Event</dt>
              <dd className="font-medium">
                {o.event.title} · {o.event.when}
              </dd>
            </div>
          )}
          <div>
            <dt className="text-muted">Discount for {who}</dt>
            <dd className="text-lg font-semibold">{o.discountPercent}% off with your code</dd>
          </div>
          <div>
            <dt className="text-muted">Your commission</dt>
            <dd className="text-lg font-semibold">{o.commissionPercent}% of what they pay</dd>
          </div>
          <div>
            <dt className="text-muted">When you’re paid</dt>
            <dd>Once their payment is verified, {o.owner} sends your commission to your payout account.</dd>
          </div>
        </dl>
      </Card>
      <Card title="Accept and sign up" description={o.hasAccount ? 'You’re already a Byte Bun affiliate: we’ll use the payout account we have.' : 'Confirm your details and tell us where to send your commissions.'}>
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <Field label="Email">{(p) => <Input {...p} value={o.email} disabled />}</Field>
          <div className="grid gap-4 desktop:grid-cols-2">
            <Field label="First name" error={errors.firstName}>
              {(p) => <Input {...p} value={f.firstName} maxLength={60} onChange={set('firstName')} />}
            </Field>
            <Field label="Last name" error={errors.lastName}>
              {(p) => <Input {...p} value={f.lastName} maxLength={60} onChange={set('lastName')} />}
            </Field>
          </div>
          <Field label="Phone number" error={errors.phone}>
            {(p) => <Input {...p} type="tel" value={f.phone} maxLength={40} onChange={set('phone')} />}
          </Field>
          {!o.hasAccount && <PayoutFields f={f} set={set} errors={errors} />}
          <Button type="submit" loading={state.isLoading}>
            Accept the proposal
          </Button>
        </form>
      </Card>
    </div>
  );
}

function PayoutFields({ f, set, errors }) {
  return (
    <fieldset className="flex flex-col gap-4 rounded-card border border-line p-4">
      <legend className="px-1 text-sm font-semibold">Where to send your commissions</legend>
      <Field label="Method" error={errors.payoutMethod}>
        {(p) => (
          <Select {...p} value={f.payoutMethod} onChange={set('payoutMethod')}>
            <option value="ewallet">E-wallet (GCash, Maya…)</option>
            <option value="bank">Bank account</option>
          </Select>
        )}
      </Field>
      <Field label={f.payoutMethod === 'bank' ? 'Bank' : 'E-wallet'} error={errors.payoutProvider}>
        {(p) => <Input {...p} value={f.payoutProvider} maxLength={80} placeholder={f.payoutMethod === 'bank' ? 'e.g. BDO' : 'e.g. GCash'} onChange={set('payoutProvider')} />}
      </Field>
      <Field label="Account name" error={errors.payoutAccountName}>
        {(p) => <Input {...p} value={f.payoutAccountName} maxLength={120} onChange={set('payoutAccountName')} />}
      </Field>
      <Field label={f.payoutMethod === 'bank' ? 'Account number' : 'Mobile or account number'} error={errors.payoutAccountNumber}>
        {(p) => <Input {...p} value={f.payoutAccountNumber} maxLength={60} onChange={set('payoutAccountNumber')} />}
      </Field>
    </fieldset>
  );
}

// ---- Signing in ----

function Home() {
  const me = useAffiliateMeQuery();
  if (me.isLoading) return <Loading screen />;
  if (me.error?.status === 401 || !me.data) return <SignIn />;
  return <Dashboard d={me.data} />;
}

function SignIn() {
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState(null);
  const [send, sendState] = useAffiliateCodeMutation();
  const [verify, verifyState] = useAffiliateVerifyMutation();
  const ask = async (e) => {
    e?.preventDefault();
    setError(null);
    const r = await send(email.trim());
    if (r.error) return setError(r.error.fields?.email ?? r.error.message);
    setSentTo(email.trim());
    setCode('');
  };
  const check = async (e) => {
    e.preventDefault();
    setError(null);
    const r = await verify({ email: sentTo, code: code.trim() });
    if (r.error) setError(r.error.fields?.code ?? r.error.message);
  };
  return (
    <Shell>
      <div className="mx-auto max-w-sm">
        <Card title="Sign in" description={sentTo ? `If ${sentTo} belongs to an affiliate, we emailed a 6-digit code to it.` : 'Your affiliate dashboard: earnings, events and bookings waiting for verification.'}>
          {!sentTo ? (
            <form onSubmit={ask} className="flex flex-col gap-4" noValidate>
              <Field label="Email" error={error}>
                {(p) => <Input {...p} type="email" autoComplete="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />}
              </Field>
              <Button type="submit" loading={sendState.isLoading} disabled={!email.includes('@')}>
                Email me a code
              </Button>
            </form>
          ) : (
            <form onSubmit={check} className="flex flex-col gap-4" noValidate>
              <Field label="6-digit code" error={error}>
                {(p) => <Input {...p} inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={6} className="text-center font-mono text-2xl tracking-[0.4em]" value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />}
              </Field>
              <Button type="submit" loading={verifyState.isLoading} disabled={code.length !== 6}>
                Sign in
              </Button>
              <div className="flex justify-between text-sm">
                <button type="button" className="cursor-pointer text-brand hover:underline" onClick={() => (setSentTo(null), setError(null))}>
                  Use another email
                </button>
                <button type="button" className="cursor-pointer text-brand hover:underline" onClick={ask}>
                  Send a new code
                </button>
              </div>
            </form>
          )}
        </Card>
        <p className="mt-4 text-center text-xs text-muted">Not an affiliate yet? You join with the link in a proposal email.</p>
      </div>
    </Shell>
  );
}

// ---- The dashboard ----

const EVENT_STATUS = { active: ['ok', 'Active'], disabled: ['neutral', 'Disabled'] };

function Dashboard({ d }) {
  const [signOut] = useAffiliateSignOutMutation();
  const [editing, setEditing] = useState(false);
  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Copied');
    } catch {
      toast.error('Couldn’t copy. Please copy it by hand.');
    }
  };
  const now = Date.now();
  const upcoming = d.events.filter((e) => new Date(e.endsAt).getTime() > now);
  const past = d.events.filter((e) => new Date(e.endsAt).getTime() <= now);
  return (
    <Shell
      right={
        <Button size="sm" variant="ghost" onClick={() => signOut()}>
          Sign out
        </Button>
      }
    >
      <h1 className="text-2xl font-semibold tracking-tight">Hi {d.firstName}</h1>
      <p className="mb-6 text-sm text-muted">Your earnings count once each payment is verified.</p>

      <section className="mb-6 grid gap-3 desktop:grid-cols-2">
        {!d.earnings.length ? (
          <Card title="Earnings">
            <p className="text-sm text-muted">Nothing yet. Share your promo code to start earning.</p>
          </Card>
        ) : (
          d.earnings.map((t) => (
            <Card key={t.currency} title={`Earnings (${t.currency})`}>
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <Money label="Earned" value={t.earned} />
                <Money label="Paid to you" value={t.paidOut} />
                <Money label="Still to be paid" value={t.balance} strong />
                <Money label="Pending verification" value={t.pending} />
              </dl>
            </Card>
          ))
        )}
      </section>

      <Card title={`Bookings waiting for verification (${d.pending.length})`} description="You earn from these once the payment is verified." className="mb-6">
        {!d.pending.length ? (
          <p className="text-sm text-muted">None right now.</p>
        ) : (
          <ul className="divide-y divide-line rounded-card border border-line text-sm">
            {d.pending.map((p, i) => (
              <li key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                <span className="font-medium">{p.title}</span>
                <span className="text-muted">
                  {p.who}
                  {p.spots > 1 ? ` · ${p.spots} spots` : ''} · {fmtDay(p.createdAt)}
                </span>
                <Badge tone="warn">{p.status}</Badge>
                <span className="flex-1" />
                <span className="text-muted">≈ {p.amount}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {d.plan && (
        <Card title="Byte Bun Bookings plans" description="Businesses enter your code when they upgrade to a paid plan." className="mb-6">
          <div className="flex flex-wrap items-center gap-3">
            <CodeChip code={d.plan.promoCode} onCopy={copy} />
            <span className="text-sm text-muted">
              {d.plan.discountPercent}% off for businesses · you earn {d.plan.commissionPercent}%
            </span>
            {d.plan.status === 'disabled' && <Badge>Disabled</Badge>}
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm desktop:grid-cols-4">
            <Money label="Verified referrals" value={d.plan.referrals} strong />
            <Money label="Pending" value={d.plan.pendingReferrals} />
            <Money label="Earned" value={d.plan.earned} />
            <Money label="Paid to you" value={d.plan.paidOut} />
          </dl>
        </Card>
      )}

      <h2 className="mb-3 text-lg font-semibold">Your events ({d.events.length})</h2>
      {!d.events.length ? (
        <p className="mb-6 rounded-card border border-dashed border-line-strong px-4 py-6 text-center text-sm text-muted">No events yet. When a business adds you to its event, you get a proposal email.</p>
      ) : (
        <div className="mb-6 flex flex-col gap-4">
          {[...upcoming, ...past].map((e) => (
            <EventCard key={e.id} e={e} past={new Date(e.endsAt).getTime() <= now} onCopy={copy} />
          ))}
        </div>
      )}

      <Card title="Your details" actions={<Button size="sm" variant="secondary" onClick={() => setEditing(true)}>Edit</Button>}>
        <p className="text-sm">
          {d.firstName} {d.lastName} · {d.email} · {d.phone}
        </p>
        <p className="mt-1 text-sm text-muted">{d.payout ? `Payouts to ${d.payout.provider} · ${d.payout.accountName} · ${d.payout.accountNumber}` : 'No payout account yet.'}</p>
      </Card>
      {editing && <ProfileDialog d={d} onClose={() => setEditing(false)} />}
    </Shell>
  );
}

function EventCard({ e, past, onCopy }) {
  const [open, setOpen] = useState(false);
  return (
    <Card title={e.title} description={`${e.business} · ${fmtWhen(e.startsAt, e.timeZone)}${e.price ? ` · ${e.price}` : ''}`} actions={<span className="flex gap-2">{past && <Badge>Ended</Badge>}{!e.published && !past && <Badge tone="warn">Not published</Badge>}<Badge tone={EVENT_STATUS[e.status]?.[0]}>{EVENT_STATUS[e.status]?.[1] ?? e.status}</Badge></span>}>
      <div className="flex flex-wrap items-center gap-3">
        <CodeChip code={e.promoCode} onCopy={onCopy} />
        <span className="text-sm text-muted">
          {e.discountPercent}% off for attendees · you earn {e.commissionPercent}%
        </span>
        {e.url && !past && (
          <Button size="sm" variant="secondary" onClick={() => onCopy(e.url)}>
            Copy event link with my code
          </Button>
        )}
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm desktop:grid-cols-5">
        <Money label="Verified spots" value={e.stats.verifiedSpots} strong />
        <Money label="Pending" value={e.stats.pendingSpots} />
        <Money label="Earned" value={e.labels.earned} />
        <Money label="Paid to you" value={e.labels.paidOut} />
        <Money label="Still to be paid" value={e.labels.balance} strong />
      </dl>
      {e.payouts.length > 0 && (
        <>
          <button type="button" className="mt-3 cursor-pointer text-xs font-medium text-brand hover:underline" onClick={() => setOpen(!open)} aria-expanded={open}>
            {open ? 'Hide payouts' : `Payouts (${e.payouts.length})`}
          </button>
          {open && (
            <ul className="mt-2 text-sm text-muted">
              {e.payouts.map((p, i) => (
                <li key={i}>
                  {fmtDay(p.createdAt)} · {p.amount}
                  {p.reference && ` · ${p.reference}`}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Card>
  );
}

function CodeChip({ code, onCopy }) {
  return (
    <button type="button" onClick={() => onCopy(code)} className="cursor-pointer rounded-md bg-sunken px-3 py-1.5 font-mono text-lg font-bold tracking-widest hover:bg-brand-soft" title="Copy">
      {code}
    </button>
  );
}

function Money({ label, value, strong }) {
  return (
    <div className="rounded-btn border border-line px-3 py-2">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={strong ? 'text-base font-semibold' : 'text-base'}>{value}</dd>
    </div>
  );
}

function ProfileDialog({ d, onClose }) {
  const [update, state] = useAffiliateUpdateMutation();
  const [f, setF] = useState({ phone: d.phone, payoutMethod: d.payout?.method ?? 'ewallet', payoutProvider: d.payout?.provider ?? '', payoutAccountName: d.payout?.accountName ?? '', payoutAccountNumber: d.payout?.accountNumber ?? '' });
  const [errors, setErrors] = useState({});
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async (e) => {
    e?.preventDefault();
    const r = await update(f);
    if (r.error) {
      setErrors(r.error.fields ?? {});
      return toast.error(r.error.message);
    }
    toast.success('Saved');
    onClose();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      busy={state.isLoading}
      title="Your details"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="aff-profile" loading={state.isLoading}>
            Save
          </Button>
        </>
      }
    >
      <form id="aff-profile" onSubmit={save} className="flex flex-col gap-4" noValidate>
        <Field label="Phone number" error={errors.phone}>
          {(p) => <Input {...p} type="tel" value={f.phone} maxLength={40} onChange={set('phone')} />}
        </Field>
        <PayoutFields f={f} set={set} errors={errors} />
        <p className="text-xs text-muted">Your name and email are changed by whoever runs your program. Reply to any of our emails to ask.</p>
      </form>
    </Dialog>
  );
}
