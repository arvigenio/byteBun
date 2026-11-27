import { useState } from 'react';
import { useAdminForm } from '../hooks/admin/useAdminForm.js';
import { affiliateSchema } from '../lib/adminSchemas.js';
import { PageTitle } from './AdminLayout.jsx';
import { useAddAffiliateMutation, useAffiliateQuery, useAffiliatesQuery, useDeleteAffiliateMutation, usePayAffiliateMutation, useResendAffiliateMutation, useUpdateAffiliateMutation } from './clientsApi.js';
import { Dialog, useConfirm, usePrompt } from './dialogs.jsx';
import { AdminButton, Badge, Field, formatDateTime, Notice, Panel, SelectInput, Spinner, TextInput } from './ui.jsx';

// Byte Bun's affiliates (backend clients/affiliates/). An admin adds one with the customer
// discount and their commission; they're emailed a proposal with a unique sign-up link. Once
// they sign up, businesses can use their promo code on a plan payment. A commission is pending
// until Byte Bun verifies that payment (Plan payments tab), then earned; mark it paid once sent.
// Ranked by verified referrals.

const usd = (cents) => new Intl.NumberFormat('en', { style: 'currency', currency: 'USD', minimumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);
const STATUS_TONE = { invited: 'gold', active: 'teal', disabled: 'neutral' };
const COMMISSION_TONE = { pending: 'gold', earned: 'teal', paid: 'neutral', void: 'danger' };
const SORTS = [
  ['referrals', 'Rank: verified referrals'],
  ['earnings', 'Rank: earnings'],
  ['newest', 'Newest first'],
];

export function AffiliatesPage() {
  const [selected, setSelected] = useState(null);
  const [sort, setSort] = useState('referrals');
  const [adding, setAdding] = useState(false);
  const q = useAffiliatesQuery(sort);
  if (selected) return <AffiliateDetail id={selected} onBack={() => setSelected(null)} />;
  return (
    <>
      <PageTitle
        title="Affiliates"
        actions={<AdminButton onClick={() => setAdding(true)}>Add affiliate</AdminButton>}
      >
        People who promote Byte Bun Bookings. Businesses get a discount with their promo code; affiliates earn a commission once the business’s payment is verified.
      </PageTitle>
      <Panel>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted">{q.data ? `${q.data.length} affiliate${q.data.length === 1 ? '' : 's'}` : ' '}</p>
          <SelectInput className="max-w-64" value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">
            {SORTS.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </SelectInput>
        </div>
        {q.isLoading ? (
          <Spinner />
        ) : q.error ? (
          <Notice tone="danger">{q.error.message}</Notice>
        ) : !q.data.length ? (
          <p className="text-muted">No affiliates yet. Add one: they get an email with your proposal and a link to sign up.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-sm">
              <thead className="text-xs tracking-wider text-soft-violet uppercase">
                <tr className="border-b border-line">
                  <th className="py-2 pr-3">#</th>
                  <th className="py-2 pr-3">Affiliate</th>
                  <th className="py-2 pr-3">Code</th>
                  <th className="py-2 pr-3">Terms</th>
                  <th className="py-2 pr-3">Verified</th>
                  <th className="py-2 pr-3">Pending</th>
                  <th className="py-2 pr-3">To pay</th>
                  <th className="py-2">Paid</th>
                </tr>
              </thead>
              <tbody>
                {q.data.map((a) => (
                  <tr key={a.id} className="cursor-pointer border-b border-line hover:bg-lavender-mist" onClick={() => setSelected(a.id)}>
                    <td className="py-3 pr-3 font-bold text-byte-purple">{a.rank}</td>
                    <td className="py-3 pr-3">
                      <div className="font-semibold text-midnight-plum">
                        {a.firstName} {a.lastName} <Badge tone={STATUS_TONE[a.status]}>{a.status}</Badge>
                      </div>
                      <div className="text-xs text-muted">{a.email}</div>
                    </td>
                    <td className="py-3 pr-3 font-mono font-bold">{a.promoCode}</td>
                    <td className="py-3 pr-3">
                      {a.discountPercent}% off · {a.commissionPercent}%
                    </td>
                    <td className="py-3 pr-3 font-semibold">{a.totals.referrals}</td>
                    <td className="py-3 pr-3">
                      {a.totals.pendingReferrals}
                      {a.totals.pendingCents > 0 && <span className="text-xs text-muted"> ({usd(a.totals.pendingCents)})</span>}
                    </td>
                    <td className="py-3 pr-3 font-semibold">{usd(a.totals.earnedCents)}</td>
                    <td className="py-3">{usd(a.totals.paidCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      {adding && <AffiliateDialog onClose={() => setAdding(false)} onSaved={(a) => (setAdding(false), setSelected(a.id))} />}
    </>
  );
}

function AffiliateDetail({ id, onBack }) {
  const q = useAffiliateQuery(id);
  const [editing, setEditing] = useState(false);
  const [update, updateState] = useUpdateAffiliateMutation();
  const [resend, resendState] = useResendAffiliateMutation();
  const [del] = useDeleteAffiliateMutation();
  const [pay, payState] = usePayAffiliateMutation();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const [notice, setNotice] = useState(null); // { tone, text }
  const back = (
    <AdminButton variant="link" onClick={onBack}>
      ← All affiliates
    </AdminButton>
  );
  if (q.isLoading) return <Spinner />;
  if (q.error)
    return (
      <>
        {back}
        <Notice tone="danger">{q.error.message}</Notice>
      </>
    );
  const a = q.data;
  const done = (r, text) => setNotice(r.error ? { tone: 'danger', text: r.error.message } : { tone: 'success', text });
  const markPaid = async () => {
    const reference = await prompt({ title: `Mark ${usd(a.totals.earnedCents)} as paid`, label: 'Reference or note', hint: 'The transfer’s reference number (or how it was paid). The affiliate is emailed.', placeholder: 'e.g. GCash ref 1234', action: 'Mark as paid' });
    if (reference === null) return;
    done(await pay({ id, reference: reference || null }), `Marked as paid. ${a.firstName} was emailed.`);
  };
  return (
    <>
      {back}
      <PageTitle title={`${a.firstName} ${a.lastName}`}>
        <Badge tone={STATUS_TONE[a.status]}>{a.status}</Badge> · {a.email} · {a.phone}
      </PageTitle>
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
      {a.status === 'invited' && (
        <Notice tone="warning">
          Invited {formatDateTime(a.invitedAt)}. They haven’t signed up yet{a.inviteExpiresAt ? `; the link works until ${formatDateTime(a.inviteExpiresAt)}` : ''}. Their code works once they do.
        </Notice>
      )}
      <div className="mb-6 flex flex-wrap gap-3">
        <AdminButton onClick={() => setEditing(true)}>Edit</AdminButton>
        {a.totals.earnedCents > 0 && (
          <AdminButton variant="accent" busy={payState.isLoading} onClick={markPaid}>
            Mark {usd(a.totals.earnedCents)} as paid
          </AdminButton>
        )}
        {a.status === 'invited' && (
          <AdminButton variant="outline" busy={resendState.isLoading} onClick={async () => done(await resend(id), `A new sign-up link was emailed to ${a.email}.`)}>
            Resend invitation
          </AdminButton>
        )}
        {a.status === 'active' && (
          <AdminButton variant="outline" busy={updateState.isLoading} onClick={async () => done(await update({ id, status: 'disabled' }), 'Disabled: their promo code no longer works.')}>
            Disable
          </AdminButton>
        )}
        {a.status === 'disabled' && (
          <AdminButton variant="outline" busy={updateState.isLoading} onClick={async () => done(await update({ id, status: 'active' }), 'Enabled: their promo code works again.')}>
            Enable
          </AdminButton>
        )}
        <AdminButton
          variant="danger"
          onClick={async () => {
            if (!(await confirm({ title: `Delete ${a.firstName} ${a.lastName}?`, body: 'Only affiliates with no commissions can be deleted. Otherwise, disable them.', action: 'Delete' }))) return;
            const r = await del(id);
            if (r.error) return done(r);
            onBack();
          }}
        >
          Delete
        </AdminButton>
      </div>

      <div className="grid gap-6 desktop:grid-cols-2">
        <Panel>
          <h2 className="mb-3 text-lg font-bold text-midnight-plum">Program</h2>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <Item label="Promo code" value={<span className="font-mono font-bold">{a.promoCode}</span>} />
            <Item label="Business discount" value={`${a.discountPercent}%`} />
            <Item label="Commission" value={`${a.commissionPercent}% of the amount paid`} />
            <Item label="Signed up" value={a.joinedAt ? formatDateTime(a.joinedAt) : 'Not yet'} />
            <Item label="Added by" value={a.createdBy} />
            {a.note && <Item label="Note" value={a.note} />}
          </dl>
        </Panel>
        <Panel>
          <h2 className="mb-3 text-lg font-bold text-midnight-plum">Earnings</h2>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <Item label="Verified referrals" value={a.totals.referrals} />
            <Item label="Pending verification" value={`${a.totals.pendingReferrals} (${usd(a.totals.pendingCents)})`} />
            <Item label="Earned, to pay" value={<strong>{usd(a.totals.earnedCents)}</strong>} />
            <Item label="Paid" value={usd(a.totals.paidCents)} />
          </dl>
          <h3 className="mt-4 mb-1 text-sm font-semibold text-midnight-plum">Payout account</h3>
          <p className="text-sm text-muted">{a.payout ? `${a.payout.method === 'bank' ? 'Bank' : 'E-wallet'}: ${a.payout.provider} · ${a.payout.accountName} · ${a.payout.accountNumber}` : 'Given when they sign up.'}</p>
        </Panel>
        <Panel className="desktop:col-span-2">
          <h2 className="mb-3 text-lg font-bold text-midnight-plum">Commissions</h2>
          {!a.commissions.length ? (
            <p className="text-sm text-muted">No businesses have used this code yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="text-xs tracking-wider text-soft-violet uppercase">
                  <tr className="border-b border-line">
                    <th className="py-2 pr-3">Date</th>
                    <th className="py-2 pr-3">Business</th>
                    <th className="py-2 pr-3">Plan</th>
                    <th className="py-2 pr-3">Paid</th>
                    <th className="py-2 pr-3">Commission</th>
                    <th className="py-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {a.commissions.map((c) => (
                    <tr key={c.id} className="border-b border-line">
                      <td className="py-2 pr-3">{formatDateTime(c.createdAt)}</td>
                      <td className="py-2 pr-3">{c.businessName}</td>
                      <td className="py-2 pr-3">
                        {c.payment.plan} ({c.payment.cycle})
                      </td>
                      <td className="py-2 pr-3">{usd(c.payment.amountCents)}</td>
                      <td className="py-2 pr-3 font-semibold">
                        {usd(c.amountCents)} <span className="text-xs font-normal text-muted">({c.commissionPercent}%)</span>
                      </td>
                      <td className="py-2">
                        <Badge tone={COMMISSION_TONE[c.status]}>{c.status}</Badge>
                        {c.paidAt && <div className="text-xs text-muted">{formatDateTime(c.paidAt)}{c.payoutReference ? ` · ${c.payoutReference}` : ''}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </div>
      {editing && <AffiliateDialog affiliate={a} onClose={() => setEditing(false)} onSaved={() => setEditing(false)} />}
    </>
  );
}

function Item({ label, value }) {
  return (
    <div>
      <dt className="text-xs font-semibold tracking-wider text-soft-violet uppercase">{label}</dt>
      <dd className="mt-0.5 text-midnight-plum">{value}</dd>
    </div>
  );
}

function AffiliateDialog({ affiliate: a, onClose, onSaved }) {
  const [add, addState] = useAddAffiliateMutation();
  const [update, updateState] = useUpdateAffiliateMutation();
  const [formError, setFormError] = useState(null);
  const form = useAdminForm(affiliateSchema, {
    firstName: a?.firstName ?? '',
    lastName: a?.lastName ?? '',
    email: a?.email ?? '',
    phone: a?.phone ?? '',
    discountPercent: a ? a.discountPercent : 10,
    commissionPercent: a ? a.commissionPercent : 20,
    promoCode: a?.promoCode ?? '',
    note: a?.note ?? '',
  });
  const { register, handleSubmit, formState } = form;
  const e = formState.errors;
  const emailLocked = !!a && a.status !== 'invited';
  const save = handleSubmit(async (v) => {
    setFormError(null);
    const body = { ...v, promoCode: v.promoCode || null, note: v.note || null };
    if (emailLocked) delete body.email;
    const r = a ? await update({ id: a.id, ...body }) : await add(body);
    if (r.error) {
      form.applyServerErrors(r.error);
      return setFormError(r.error.message);
    }
    onSaved(r.data);
  });
  const busy = addState.isLoading || updateState.isLoading;
  return (
    <Dialog
      eyebrow="Affiliates"
      title={a ? `Edit ${a.firstName} ${a.lastName}` : 'Add an affiliate'}
      onClose={onClose}
      wide
      footer={
        <>
          <AdminButton busy={busy} onClick={save}>
            {a ? 'Save' : 'Add and email the proposal'}
          </AdminButton>
          <AdminButton variant="outline" onClick={onClose}>
            Cancel
          </AdminButton>
        </>
      }
    >
      <form onSubmit={save} className="px-6 py-5 mobile:px-5" noValidate>
        {formError && <Notice tone="danger">{formError}</Notice>}
        <div className="grid gap-x-4 desktop:grid-cols-2">
          <Field id="af-first" label="First name" error={e.firstName?.message}>
            <TextInput id="af-first" autoFocus autoComplete="off" error={e.firstName} {...register('firstName')} />
          </Field>
          <Field id="af-last" label="Last name" error={e.lastName?.message}>
            <TextInput id="af-last" autoComplete="off" error={e.lastName} {...register('lastName')} />
          </Field>
          <Field id="af-email" label="Email" hint={emailLocked ? 'Can’t be changed after they sign up.' : a ? 'Changing it sends a new sign-up link to the new address.' : 'The proposal and sign-up link go here.'} error={e.email?.message}>
            <TextInput id="af-email" type="email" inputMode="email" autoComplete="off" disabled={emailLocked} error={e.email} {...register('email')} />
          </Field>
          <Field id="af-phone" label="Phone number" error={e.phone?.message}>
            <TextInput id="af-phone" type="tel" autoComplete="off" error={e.phone} {...register('phone')} />
          </Field>
          <Field id="af-discount" label="Discount for the business (%)" hint="Off the plan price when they use the code." error={e.discountPercent?.message}>
            <TextInput id="af-discount" inputMode="decimal" error={e.discountPercent} {...register('discountPercent')} />
          </Field>
          <Field id="af-commission" label="Affiliate’s commission (%)" hint="Of what the business pays, once verified." error={e.commissionPercent?.message}>
            <TextInput id="af-commission" inputMode="decimal" error={e.commissionPercent} {...register('commissionPercent')} />
          </Field>
          <Field id="af-code" label="Promo code" hint={a ? 'Changing it stops the old code working.' : 'Optional: leave empty to make one from the first name.'} error={e.promoCode?.message}>
            <TextInput id="af-code" autoComplete="off" className="font-mono uppercase" error={e.promoCode} {...register('promoCode')} />
          </Field>
          <Field id="af-note" label="Note (only admins see it)" error={e.note?.message}>
            <TextInput id="af-note" autoComplete="off" error={e.note} {...register('note')} />
          </Field>
        </div>
      </form>
    </Dialog>
  );
}
