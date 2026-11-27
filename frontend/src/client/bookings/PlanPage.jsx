import { useState } from 'react';
import { toast } from 'sonner';
import { site } from '../../content/site.js';
import { useCancelPlanPaymentMutation, useCheckoutQuery, useMeQuery, useOverviewQuery, usePayPlanMutation, usePlanPromoMutation } from '../api.js';
import { FilePicker, PaymentChannelsView } from '../components/Payments.jsx';
import { compressImage, fileProblem, PROOF_ACCEPT } from '../lib/upload.js';
import { Badge, Button, Card, Field, Input, LinkButton, Notice, PageHeader, useConfirm } from '../ui.jsx';
import { can } from './BookingsApp.jsx';

// Plans and limits, from the same pricing as bytebuntech.com (site.packages). Bookings Pro is
// bought here (backend affiliates/affiliates.service.ts): choose monthly or yearly, maybe enter an
// affiliate's promo code, pay Byte Bun through one of its payment channels and upload the proof.
// Byte Bun verifies it, then the plan changes. Premium and Growth start with a free consultation.
const PLAN_CODE = { Free: 'free', 'Bookings Pro': 'bookings', Premium: 'premium', Growth: 'growth' };
const usd = (cents) => new Intl.NumberFormat('en', { style: 'currency', currency: 'USD', minimumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);
const fmtDay = (iso) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(iso));
const STATUS = { review: ['warn', 'Being verified'], approved: ['ok', 'Verified'], rejected: ['danger', 'Not verified'], cancelled: ['neutral', 'Cancelled'] };

export function PlanPage() {
  const { data: me } = useMeQuery();
  const { data: o } = useOverviewQuery();
  const checkout = useCheckoutQuery();
  const b = me.business;
  const p = site.packages;
  return (
    <>
      <PageHeader title="Plan" description={`${b.name} is on the ${b.plan.name} plan.`} />
      <div className="flex flex-col gap-5">
        {o?.usage.limit !== null && o && (
          <Notice tone={o.usage.used >= o.usage.limit ? 'danger' : 'info'}>
            {o.usage.used} of {o.usage.limit} bookings used this month.
          </Notice>
        )}
        <div className="grid gap-4 desktop:grid-cols-2">
          {p.plans.map((plan) => {
            const current = PLAN_CODE[plan.name] === b.plan.code;
            return (
              <Card
                key={plan.name}
                title={plan.name}
                description={`${plan.price.monthly}/month${plan.price.yearly !== '$0' ? ` · ${plan.price.yearly}/year` : ''}`}
                actions={current ? <Badge tone="brand">Current</Badge> : plan.featured ? <Badge tone="ok">{plan.featuredLabel}</Badge> : null}
                className={current ? 'border-brand' : ''}
              >
                <ul className="flex flex-col gap-1 text-sm text-muted">
                  {plan.features.map((f) => (
                    <li key={f}>✓ {f}</li>
                  ))}
                </ul>
              </Card>
            );
          })}
        </div>
        {checkout.data && <Checkout data={checkout.data} canPay={can(me, 'account.manage')} />}
        <Card title="Premium and Growth">
          <p className="text-sm text-muted">
            Book a free consultation, or email{' '}
            <a className="font-medium text-brand underline" href={`mailto:${site.contact.email}?subject=${encodeURIComponent(`Plan change: ${b.name}`)}`}>
              {site.contact.email}
            </a>
            . Upgrading stops data deletion right away and keeps everything you have. Prices in USD.
          </p>
          <div className="mt-4">
            <LinkButton href="https://bytebuntech.com/#packages" target="_blank" rel="noreferrer">
              Compare plans
            </LinkButton>
          </div>
        </Card>
      </div>
    </>
  );
}

function Checkout({ data, canPay }) {
  const [cancel] = useCancelPlanPaymentMutation();
  const confirm = useConfirm();
  const plan = data.plans[0];
  if (!plan) return null;
  return (
    <Card title={data.currentPlan === plan.code ? `Renew ${plan.name}` : `Upgrade to ${plan.name}`} description="Pay Byte Bun, upload your proof of payment, and your plan changes as soon as we verify it (usually within one business day).">
      {data.open ? (
        <Notice tone="info" title="We’re verifying your payment">
          {data.open.planName} ({data.open.cycle}) · {usd(data.open.amountCents)}
          {data.open.promoCode && ` · promo ${data.open.promoCode}`} · sent {fmtDay(data.open.createdAt)}. You’ll get an email once it’s verified.
          {canPay && (
            <div className="mt-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  if (!(await confirm({ title: 'Cancel this payment?', body: 'Byte Bun stops verifying it. Do this if you uploaded the wrong proof; you can then send a new one.', action: 'Cancel payment', cancel: 'Keep it' }))) return;
                  const r = await cancel(data.open.id);
                  if (r.error) toast.error(r.error.message);
                  else toast.success('Payment cancelled');
                }}
              >
                Cancel this payment
              </Button>
            </div>
          )}
        </Notice>
      ) : !canPay ? (
        <p className="text-sm text-muted">Only owners can change the plan.</p>
      ) : !data.channels.length ? (
        <p className="text-sm text-muted">Online payment isn’t set up yet. Email us to upgrade.</p>
      ) : (
        <PayForm plan={plan} channels={data.channels} />
      )}
      {data.payments.some((x) => x.status !== 'review') && (
        <div className="mt-5">
          <h3 className="mb-2 text-sm font-semibold">Past payments</h3>
          <ul className="divide-y divide-line rounded-card border border-line text-sm">
            {data.payments
              .filter((x) => x.status !== 'review')
              .map((x) => (
                <li key={x.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                  <span>{fmtDay(x.createdAt)}</span>
                  <span className="font-medium">
                    {x.planName} ({x.cycle}) · {usd(x.amountCents)}
                  </span>
                  <Badge tone={STATUS[x.status][0]}>{STATUS[x.status][1]}</Badge>
                  {x.status === 'rejected' && x.reviewNote && <span className="text-muted">Reason: {x.reviewNote}</span>}
                </li>
              ))}
          </ul>
        </div>
      )}
    </Card>
  );
}

function PayForm({ plan, channels }) {
  const [cycle, setCycle] = useState('yearly');
  const [promoInput, setPromoInput] = useState('');
  const [promo, setPromo] = useState(null); // { promoCode, discountPercent, listCents, discountCents, amountCents, cycle }
  const [promoError, setPromoError] = useState('');
  const [picked, setPicked] = useState(null);
  const [file, setFile] = useState(null);
  const [fileError, setFileError] = useState('');
  const [reference, setReference] = useState('');
  const [quote, quoteState] = usePlanPromoMutation();
  const [pay, payState] = usePayPlanMutation();
  const list = cycle === 'yearly' ? plan.yearlyCents : plan.monthlyCents;
  const applied = promo && promo.cycle === cycle ? promo : null;
  const amount = applied ? applied.amountCents : list;

  const apply = async (c = cycle) => {
    setPromoError('');
    const r = await quote({ planCode: plan.code, cycle: c, promoCode: promoInput.trim() });
    if (r.error) {
      setPromo(null);
      return setPromoError(r.error.fields?.promoCode ?? r.error.message);
    }
    setPromo({ ...r.data, cycle: c });
  };
  const switchCycle = (c) => {
    setCycle(c);
    if (promo) apply(c);
  };
  const submit = async (ev) => {
    ev.preventDefault();
    const problem = fileProblem(file);
    if (problem) return setFileError(problem);
    const form = new FormData();
    form.append('planCode', plan.code);
    form.append('cycle', cycle);
    if (applied) form.append('promoCode', applied.promoCode);
    if (reference.trim()) form.append('reference', reference.trim());
    form.append('file', await compressImage(file));
    const r = await pay(form);
    if (r.error) {
      if (r.error.fields?.promoCode) setPromoError(r.error.fields.promoCode);
      if (r.error.fields?.file) setFileError(r.error.fields.file);
      return toast.error(r.error.message);
    }
    toast.success('Payment sent. We’ll email you once it’s verified.');
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
      <div>
        <p className="mb-1.5 text-sm font-medium">1. Choose how to pay</p>
        <div className="flex max-w-sm gap-1 rounded-btn bg-sunken p-1" role="tablist" aria-label="Billing">
          {[
            ['monthly', `Monthly · ${usd(plan.monthlyCents)}`],
            ['yearly', `Yearly · ${usd(plan.yearlyCents)}`],
          ].map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={cycle === k} onClick={() => switchCycle(k)} className={`flex-1 cursor-pointer rounded-md px-3 py-1.5 text-sm font-medium ${cycle === k ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'}`}>
              {l}
            </button>
          ))}
        </div>
        {cycle === 'yearly' && <p className="mt-1 text-[13px] text-faint">2 months free compared with monthly.</p>}
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="plan-promo" className="text-sm font-medium">
          Have a promo code?
        </label>
        {applied ? (
          <Notice tone="ok">
            Promo <strong className="font-mono">{applied.promoCode}</strong> applied: {applied.discountPercent}% off, you save {usd(applied.discountCents)}.{' '}
            <button type="button" className="cursor-pointer font-medium underline" onClick={() => (setPromo(null), setPromoInput(''))}>
              Remove
            </button>
          </Notice>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Input id="plan-promo" value={promoInput} maxLength={20} placeholder="CODE" className="max-w-48 font-mono uppercase" onChange={(x) => (setPromoInput(x.target.value.toUpperCase()), setPromoError(''))} onKeyDown={(x) => x.key === 'Enter' && (x.preventDefault(), apply())} />
            <Button variant="secondary" onClick={() => apply()} loading={quoteState.isLoading} disabled={!promoInput.trim()}>
              Apply
            </Button>
          </div>
        )}
        {promoError && <p className="text-[13px] text-danger">{promoError}</p>}
      </div>

      <p className="text-lg font-semibold">
        To pay: {usd(amount)}
        {applied && <span className="ml-2 text-sm font-normal text-muted line-through">{usd(list)}</span>}
        <span className="ml-1 text-sm font-normal text-muted">USD</span>
      </p>

      <div>
        <p className="mb-2 text-sm font-medium">2. Pay Byte Bun with one of these</p>
        <PaymentChannelsView channels={channels} picked={picked} onPick={setPicked} />
      </div>

      <div className="flex flex-col gap-4">
        <p className="text-sm font-medium">3. Upload your proof of payment</p>
        <FilePicker id="plan-proof" accept={PROOF_ACCEPT} file={file} onChange={(f) => (setFile(f), setFileError(''))} label="Choose the receipt or screenshot" hint="An image or a PDF, up to 10 MB." error={fileError} />
        <Field label="Reference number (optional)">{(p) => <Input {...p} value={reference} maxLength={120} className="max-w-64" onChange={(x) => setReference(x.target.value)} />}</Field>
      </div>
      <div>
        <Button type="submit" loading={payState.isLoading} disabled={!file}>
          Send for verification
        </Button>
      </div>
    </form>
  );
}
