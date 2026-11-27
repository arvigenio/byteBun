import { useState } from 'react';
import { toast } from 'sonner';
import { useAddEventAffiliateMutation, useDeleteEventAffiliateMutation, useEventAffiliatesQuery, usePayEventAffiliateMutation, useResendEventAffiliateMutation, useUpdateEventAffiliateMutation } from '../api.js';
import { MoneyField } from '../components/Money.jsx';
import { RowMenu } from '../components/RowMenu.jsx';
import { Badge, Button, Card, Dialog, Field, Input, Loading, Notice, useConfirm } from '../ui.jsx';

// A paid event's affiliates (backend booking/event-affiliates.ts): up to 5 people who promote it.
// Each gets a promo code (a percentage off for attendees) and a commission (a percentage of what
// each attendee paid), earned once the attendee's payment is verified. Ranked by verified spots.
// The business pays them directly and records each payout here.

const STATUS = { invited: ['warn', 'Invited'], active: ['ok', 'Active'], disabled: ['neutral', 'Disabled'] };
const fmtDay = (iso) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(iso));

export function EventAffiliatesTab({ e, canEdit }) {
  const q = useEventAffiliatesQuery(e.id);
  const [dialog, setDialog] = useState(null); // { kind: 'add' | 'edit' | 'payout', a? }
  if (q.isLoading) return <Loading />;
  if (q.error) return <Notice tone="danger">{q.error.message}</Notice>;
  const { affiliates, max } = q.data;
  const full = affiliates.length >= max;
  return (
    <Card
      title={`Affiliates (${affiliates.length} of ${max})`}
      description="People who promote this event. Attendees get a discount with their promo code; affiliates earn a commission on every spot once its payment is verified. You pay them yourself and record it here."
      actions={
        canEdit && (
          <Button size="sm" variant="secondary" disabled={full} onClick={() => setDialog({ kind: 'add' })}>
            Add affiliate
          </Button>
        )
      }
    >
      {full && canEdit && (
        <Notice tone="info" className="mb-4">
          An event can have up to {max} affiliates. Remove one whose code hasn’t been used to add another.
        </Notice>
      )}
      {!affiliates.length ? (
        <p className="rounded-card border border-dashed border-line-strong px-4 py-6 text-center text-sm text-muted">No affiliates yet. Add someone to promote this event: they’re emailed a proposal and a link to accept.</p>
      ) : (
        <ol className="divide-y divide-line overflow-hidden rounded-card border border-line">
          {affiliates.map((a) => (
            <AffiliateRow key={a.id} e={e} a={a} canEdit={canEdit} onEdit={() => setDialog({ kind: 'edit', a })} onPay={() => setDialog({ kind: 'payout', a })} />
          ))}
        </ol>
      )}
      {dialog?.kind === 'add' && <AffiliateDialog e={e} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'edit' && <AffiliateDialog e={e} a={dialog.a} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'payout' && <PayoutDialog e={e} a={dialog.a} onClose={() => setDialog(null)} />}
    </Card>
  );
}

function AffiliateRow({ e, a, canEdit, onEdit, onPay }) {
  const [update] = useUpdateEventAffiliateMutation();
  const [resend] = useResendEventAffiliateMutation();
  const [del] = useDeleteEventAffiliateMutation();
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const s = a.stats;
  const run = async (p, done) => {
    const r = await p;
    if (r.error) toast.error(r.error.message);
    else toast.success(done);
  };
  const items = [
    { label: 'Edit', onClick: onEdit },
    a.status !== 'invited' && { label: 'Record a payout', onClick: onPay },
    a.status === 'invited' && { label: 'Resend invitation', onClick: () => run(resend({ id: e.id, aid: a.id }), `Invitation sent to ${a.email}`) },
    a.status === 'active' && { label: 'Disable', hint: 'Their code stops working', onClick: () => run(update({ id: e.id, aid: a.id, status: 'disabled' }), `${a.firstName} disabled`) },
    a.status === 'disabled' && { label: 'Enable', onClick: () => run(update({ id: e.id, aid: a.id, status: 'active' }), `${a.firstName} enabled`) },
    {
      label: 'Remove',
      tone: 'danger',
      onClick: async () => {
        if (!(await confirm({ title: `Remove ${a.firstName} ${a.lastName}?`, body: 'Their promo code is deleted. Only possible while nobody has registered with it.', action: 'Remove' }))) return;
        run(del({ id: e.id, aid: a.id }), 'Affiliate removed');
      },
    },
  ];
  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="grid size-7 place-items-center rounded-full bg-brand-soft text-xs font-bold text-brand" title="Rank by verified referrals">
          {a.rank}
        </span>
        <span className="font-semibold">
          {a.firstName} {a.lastName}
        </span>
        <Badge tone={STATUS[a.status][0]}>{STATUS[a.status][1]}</Badge>
        <span className="rounded-md bg-sunken px-2 py-0.5 font-mono text-sm font-bold tracking-wider">{a.promoCode}</span>
        <span className="text-xs text-muted">
          {a.discountPercent}% off · {a.commissionPercent}% commission
        </span>
        <span className="flex-1" />
        {canEdit && <RowMenu label={`Actions for ${a.firstName}`} items={items} />}
      </div>
      <dl className="mt-2 grid grid-cols-2 gap-2 text-sm desktop:grid-cols-5">
        <Stat label="Verified spots" value={s.verifiedSpots} strong />
        <Stat label="Pending" value={s.pendingSpots} />
        <Stat label="Earned" value={a.labels.earned} />
        <Stat label="Paid out" value={a.labels.paidOut} />
        <Stat label="To pay" value={a.labels.balance} strong={s.balance > 0} />
      </dl>
      <button type="button" className="mt-2 cursor-pointer text-xs font-medium text-brand hover:underline" onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? 'Hide details' : 'Details'}
      </button>
      {open && (
        <div className="mt-2 grid gap-3 rounded-btn bg-sunken p-3 text-sm desktop:grid-cols-2">
          <div>
            <p className="text-muted">
              {a.email} · {a.phone}
            </p>
            <p className="text-muted">{a.joinedAt ? `Accepted ${fmtDay(a.joinedAt)}` : `Invited ${fmtDay(a.invitedAt)}${a.inviteExpiresAt ? ` · link valid until ${fmtDay(a.inviteExpiresAt)}` : ''}`}</p>
            {a.payout && (
              <p className="mt-1">
                <span className="font-medium">Pay to:</span> {a.payout.provider} · {a.payout.accountName} · {a.payout.accountNumber}
              </p>
            )}
          </div>
          <div>
            <p className="font-medium">Payouts</p>
            {!a.payouts.length ? (
              <p className="text-muted">None yet.</p>
            ) : (
              <ul className="text-muted">
                {a.payouts.map((p) => (
                  <li key={p.id}>
                    {fmtDay(p.createdAt)} · {p.amountLabel}
                    {p.reference && ` · ${p.reference}`}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

function Stat({ label, value, strong }) {
  return (
    <div className="rounded-btn border border-line px-3 py-2">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={strong ? 'font-semibold text-ink' : 'text-ink'}>{value}</dd>
    </div>
  );
}

function AffiliateDialog({ e, a, onClose }) {
  const [add, addState] = useAddEventAffiliateMutation();
  const [update, updateState] = useUpdateEventAffiliateMutation();
  const [f, setF] = useState(() => ({
    firstName: a?.firstName ?? '',
    lastName: a?.lastName ?? '',
    email: a?.email ?? '',
    phone: a?.phone ?? '',
    discountPercent: a ? String(a.discountPercent) : '10',
    commissionPercent: a ? String(a.commissionPercent) : '10',
    promoCode: '',
  }));
  const [errors, setErrors] = useState({});
  const set = (patch) => setF((x) => ({ ...x, ...patch }));
  const busy = addState.isLoading || updateState.isLoading;
  const pct = (v, max) => v !== '' && Number(v) >= 0 && Number(v) <= max;
  const ok = f.firstName.trim() && f.lastName.trim() && /\S+@\S+\.\S+/.test(f.email) && f.phone.trim().length >= 5 && pct(f.discountPercent, 99) && pct(f.commissionPercent, 100);
  const save = async (ev) => {
    ev?.preventDefault();
    setErrors({});
    const body = { firstName: f.firstName, lastName: f.lastName, phone: f.phone, discountPercent: Number(f.discountPercent), commissionPercent: Number(f.commissionPercent) };
    const r = a ? await update({ id: e.id, aid: a.id, ...body }) : await add({ id: e.id, ...body, email: f.email, promoCode: f.promoCode || null });
    if (r.error) {
      setErrors(r.error.fields ?? {});
      return toast.error(r.error.message);
    }
    toast.success(a ? 'Affiliate saved' : `Proposal emailed to ${f.email}`);
    onClose();
  };
  const price = Number(e.price ?? 0);
  const withCode = price ? price * (1 - Number(f.discountPercent || 0) / 100) : 0;
  return (
    <Dialog
      open
      onClose={onClose}
      busy={busy}
      dirty={!a && !!(f.firstName || f.email)}
      title={a ? `Edit ${a.firstName} ${a.lastName}` : 'Add an affiliate'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="affiliate-form" loading={busy} disabled={!ok}>
            {a ? 'Save' : 'Add and email proposal'}
          </Button>
        </>
      }
    >
      <form id="affiliate-form" onSubmit={save} className="flex flex-col gap-4" noValidate>
        <div className="grid gap-4 desktop:grid-cols-2">
          <Field label="First name" error={errors.firstName}>
            {(p) => <Input {...p} autoFocus value={f.firstName} maxLength={60} onChange={(x) => set({ firstName: x.target.value })} />}
          </Field>
          <Field label="Last name" error={errors.lastName}>
            {(p) => <Input {...p} value={f.lastName} maxLength={60} onChange={(x) => set({ lastName: x.target.value })} />}
          </Field>
        </div>
        <Field label="Email" hint={a ? 'The email can’t be changed.' : 'The proposal and their sign-up link go here.'} error={errors.email}>
          {(p) => <Input {...p} type="email" value={f.email} disabled={!!a} maxLength={254} onChange={(x) => set({ email: x.target.value })} />}
        </Field>
        <Field label="Phone number" error={errors.phone}>
          {(p) => <Input {...p} type="tel" value={f.phone} maxLength={40} onChange={(x) => set({ phone: x.target.value })} />}
        </Field>
        <div className="grid gap-4 desktop:grid-cols-2">
          <Field label="Attendee discount (%)" hint={price ? `A spot costs ${withCode.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${e.currency ?? ''} with their code.` : 'Off each spot, with their code.'} error={errors.discountPercent}>
            {(p) => <Input {...p} inputMode="decimal" value={f.discountPercent} onChange={(x) => set({ discountPercent: x.target.value.replace(/[^0-9.]/g, '') })} />}
          </Field>
          <Field label="Their commission (%)" hint="Of what each attendee pays, once verified." error={errors.commissionPercent}>
            {(p) => <Input {...p} inputMode="decimal" value={f.commissionPercent} onChange={(x) => set({ commissionPercent: x.target.value.replace(/[^0-9.]/g, '') })} />}
          </Field>
        </div>
        {!a && (
          <Field label="Promo code (optional)" hint="Leave empty to make one from their first name, e.g. MARIA7K2Q." error={errors.promoCode}>
            {(p) => <Input {...p} value={f.promoCode} maxLength={20} className="max-w-64 font-mono uppercase" onChange={(x) => set({ promoCode: x.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })} />}
          </Field>
        )}
      </form>
    </Dialog>
  );
}

function PayoutDialog({ e, a, onClose }) {
  const [pay, state] = usePayEventAffiliateMutation();
  const [amount, setAmount] = useState(a.stats.balance > 0 ? String(a.stats.balance) : '');
  const [reference, setReference] = useState('');
  const save = async (ev) => {
    ev?.preventDefault();
    const r = await pay({ id: e.id, aid: a.id, amount: Number(amount), reference: reference || null });
    if (r.error) return toast.error(r.error.message);
    toast.success(`Payout recorded. ${a.firstName} was emailed.`);
    onClose();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      busy={state.isLoading}
      title={`Record a payout to ${a.firstName}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="payout-form" loading={state.isLoading} disabled={!(Number(amount) > 0)}>
            Record payout
          </Button>
        </>
      }
    >
      <form id="payout-form" onSubmit={save} className="flex flex-col gap-4" noValidate>
        <p className="text-sm text-muted">
          Earned {a.labels.earned} · paid out {a.labels.paidOut} · <strong className="text-ink">to pay {a.labels.balance}</strong>
        </p>
        {a.payout && (
          <Notice tone="info">
            Send it to {a.payout.provider} · {a.payout.accountName} · {a.payout.accountNumber}
          </Notice>
        )}
        <Field label="Amount sent">{(p) => <MoneyField id={p.id} amount={amount} currency={e.currency ?? 'PHP'} fixedCurrency onAmount={setAmount} />}</Field>
        <Field label="Reference (optional)" hint="The transfer’s reference number.">
          {(p) => <Input {...p} value={reference} maxLength={120} onChange={(x) => setReference(x.target.value)} />}
        </Field>
      </form>
    </Dialog>
  );
}
