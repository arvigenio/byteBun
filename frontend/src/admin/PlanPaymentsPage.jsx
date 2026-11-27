import { useState } from 'react';
import { PageTitle } from './AdminLayout.jsx';
import { planProofUrl, useAddPlanChannelMutation, useDeletePlanChannelMutation, usePlanChannelsQuery, usePlanPaymentsQuery, useReviewPlanPaymentMutation } from './clientsApi.js';
import { Dialog, useConfirm, usePrompt } from './dialogs.jsx';
import { AdminButton, Badge, Field, formatDateTime, Notice, Panel, SelectInput, Spinner, TextInput } from './ui.jsx';

// Businesses paying for a plan from their Plan page (backend clients/affiliates/): check the
// proof, then approve (the plan changes, an affiliate's commission is earned) or reject (the
// business is emailed the reason, the commission is void). Byte Bun's payment channels, shown
// on the Plan page, are managed here too.

const usd = (cents) => new Intl.NumberFormat('en', { style: 'currency', currency: 'USD', minimumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100);
const TONE = { review: 'gold', approved: 'teal', rejected: 'danger', cancelled: 'neutral' };

export function PlanPaymentsPage() {
  const [tab, setTab] = useState('review');
  return (
    <>
      <PageTitle title="Plan payments">Businesses paying for Bookings Pro from their Plan page. Verify each proof of payment: approving changes their plan.</PageTitle>
      <div className="mb-5 flex flex-wrap gap-2" role="tablist">
        {[
          ['review', 'To verify'],
          ['all', 'All payments'],
          ['channels', 'Payment channels'],
        ].map(([k, label]) => (
          <AdminButton key={k} variant={tab === k ? 'primary' : 'outline'} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
            {label}
          </AdminButton>
        ))}
      </div>
      {tab === 'channels' ? <Channels /> : <Payments key={tab} status={tab} />}
    </>
  );
}

function Payments({ status }) {
  const q = usePlanPaymentsQuery(status);
  const [review, reviewState] = useReviewPlanPaymentMutation();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const [viewing, setViewing] = useState(null);
  const [notice, setNotice] = useState(null);
  const run = async (p, text) => {
    const r = await p;
    setNotice(r.error ? { tone: 'danger', text: r.error.message } : { tone: 'success', text });
  };
  const approve = async (p) => {
    if (!(await confirm({ title: `Approve ${usd(p.amountCents)} from ${p.businessName}?`, body: `They move to ${p.planName} right away and are emailed.${p.affiliate ? ` ${p.affiliate.name} earns ${usd(p.commission.amountCents)}.` : ''}`, action: 'Approve' }))) return;
    run(review({ id: p.id, action: 'approve' }), `Approved: ${p.businessName} is on ${p.planName}.`);
  };
  const reject = async (p) => {
    const reason = await prompt({ title: `Reject the payment from ${p.businessName}`, label: 'Reason (emailed to the business)', placeholder: 'e.g. We haven’t received this amount', action: 'Reject', validate: (t) => (t.length < 3 ? 'Please give a reason.' : null) });
    if (!reason) return;
    run(review({ id: p.id, action: 'reject', reason }), 'Rejected. The business was emailed.');
  };
  if (q.isLoading) return <Spinner />;
  if (q.error) return <Notice tone="danger">{q.error.message}</Notice>;
  return (
    <Panel>
      {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
      {!q.data.length ? (
        <p className="text-muted">{status === 'review' ? 'Nothing to verify.' : 'No plan payments yet.'}</p>
      ) : (
        <ul className="divide-y divide-line">
          {q.data.map((p) => (
            <li key={p.id} className="flex flex-wrap items-start gap-4 py-4">
              <div className="min-w-0 flex-1 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-base font-semibold text-midnight-plum">{p.businessName}</span>
                  <Badge tone={TONE[p.status]}>{p.status}</Badge>
                </div>
                <div className="mt-1 text-midnight-plum">
                  {p.planName} ({p.cycle}) · <strong>{usd(p.amountCents)}</strong>
                  {p.discountCents > 0 && (
                    <span className="text-muted">
                      {' '}
                      (list {usd(p.listCents)}, promo {p.promoCode} −{usd(p.discountCents)})
                    </span>
                  )}
                </div>
                {p.affiliate && (
                  <div className="text-muted">
                    Affiliate: {p.affiliate.name} · commission {usd(p.commission.amountCents)} ({p.commission.status})
                  </div>
                )}
                <div className="text-muted">
                  Sent {formatDateTime(p.createdAt)} by {p.submittedBy}
                  {p.reference && ` · ref ${p.reference}`} · currently on {p.currentPlan ?? '—'}
                </div>
                {p.reviewedAt && (
                  <div className="text-muted">
                    {p.status === 'cancelled' ? 'Cancelled' : 'Reviewed'} {formatDateTime(p.reviewedAt)} by {p.reviewedBy}
                    {p.reviewNote && ` · “${p.reviewNote}”`}
                  </div>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {p.hasProof && (
                  <AdminButton variant="outline" onClick={() => setViewing(p)}>
                    View proof
                  </AdminButton>
                )}
                {p.status === 'review' && (
                  <>
                    <AdminButton busy={reviewState.isLoading} onClick={() => approve(p)}>
                      Approve
                    </AdminButton>
                    <AdminButton variant="danger" onClick={() => reject(p)}>
                      Reject
                    </AdminButton>
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {viewing && (
        <Dialog eyebrow={viewing.businessName} title={`Proof of payment · ${usd(viewing.amountCents)}`} wide onClose={() => setViewing(null)} footer={<AdminButton onClick={() => setViewing(null)}>Close</AdminButton>}>
          <div className="px-6 py-5 mobile:px-5">
            <p className="mb-3 text-sm text-muted">
              {viewing.proofName}
              {viewing.reference && ` · ref ${viewing.reference}`} ·{' '}
              <a className="text-soft-violet underline" href={planProofUrl(viewing.id)} target="_blank" rel="noreferrer">
                open in a new tab
              </a>
            </p>
            {viewing.proofType === 'application/pdf' ? (
              <iframe src={planProofUrl(viewing.id)} title="Proof of payment" className="h-[65vh] w-full rounded-btn border border-line bg-white" />
            ) : (
              <img src={planProofUrl(viewing.id)} alt="Proof of payment" className="mx-auto max-h-[65vh] w-auto rounded-btn border border-line object-contain" />
            )}
          </div>
        </Dialog>
      )}
    </Panel>
  );
}

function Channels() {
  const q = usePlanChannelsQuery();
  const [del] = useDeletePlanChannelMutation();
  const confirm = useConfirm();
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState(null);
  if (q.isLoading) return <Spinner />;
  if (q.error) return <Notice tone="danger">{q.error.message}</Notice>;
  return (
    <Panel>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">Shown on businesses’ Plan page as the ways to pay Byte Bun (up to 4). Without one, businesses can’t pay online.</p>
        <AdminButton disabled={q.data.length >= 4} onClick={() => setAdding(true)}>
          Add payment channel
        </AdminButton>
      </div>
      {error && <Notice tone="danger">{error}</Notice>}
      {!q.data.length ? (
        <p className="text-muted">No payment channels yet.</p>
      ) : (
        <ul className="grid gap-3 desktop:grid-cols-2">
          {q.data.map((c) => (
            <li key={c.id} className="flex items-start gap-3 rounded-card border border-line p-4">
              {c.qrUrl && <img src={c.qrUrl} alt="" className="size-20 rounded-btn border border-line object-contain" />}
              <div className="min-w-0 flex-1 text-sm">
                <div className="font-semibold text-midnight-plum">{c.label}</div>
                <div className="text-muted">{c.type === 'bank' ? `${c.bankName} · ${c.accountName} · ${c.accountNumber}` : ['QR code', c.accountName, c.accountNumber].filter(Boolean).join(' · ')}</div>
              </div>
              <AdminButton
                variant="danger"
                onClick={async () => {
                  if (!(await confirm({ title: `Delete ${c.label}?`, body: 'Businesses won’t see it on their Plan page any more.', action: 'Delete' }))) return;
                  const r = await del(c.id);
                  setError(r.error ? r.error.message : null);
                }}
              >
                Delete
              </AdminButton>
            </li>
          ))}
        </ul>
      )}
      {adding && <ChannelDialog onClose={() => setAdding(false)} />}
    </Panel>
  );
}

function ChannelDialog({ onClose }) {
  const [add, state] = useAddPlanChannelMutation();
  const [f, setF] = useState({ type: 'bank', label: '', bankName: '', accountName: '', accountNumber: '' });
  const [file, setFile] = useState(null);
  const [errors, setErrors] = useState({});
  const [formError, setFormError] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const save = async (e) => {
    e?.preventDefault();
    const form = new FormData();
    for (const [k, v] of Object.entries(f)) if (v && (f.type === 'bank' || k !== 'bankName')) form.append(k, v);
    if (f.type === 'qr' && file) form.append('file', file);
    const r = await add(form);
    if (r.error) {
      setErrors(r.error.fields ?? {});
      return setFormError(r.error.message);
    }
    onClose();
  };
  return (
    <Dialog
      eyebrow="Plan payments"
      title="Add a payment channel"
      onClose={onClose}
      footer={
        <>
          <AdminButton busy={state.isLoading} onClick={save}>
            Add
          </AdminButton>
          <AdminButton variant="outline" onClick={onClose}>
            Cancel
          </AdminButton>
        </>
      }
    >
      <form onSubmit={save} className="px-6 py-5 mobile:px-5" noValidate>
        {formError && <Notice tone="danger">{formError}</Notice>}
        <Field id="ch-type" label="Type">
          <SelectInput id="ch-type" value={f.type} onChange={set('type')}>
            <option value="bank">Bank transfer</option>
            <option value="qr">QR code (GCash, Maya…)</option>
          </SelectInput>
        </Field>
        <Field id="ch-label" label="Name shown to businesses" error={errors.label}>
          <TextInput id="ch-label" placeholder={f.type === 'bank' ? 'e.g. BDO' : 'e.g. GCash'} value={f.label} onChange={set('label')} error={errors.label} />
        </Field>
        {f.type === 'bank' && (
          <Field id="ch-bank" label="Bank name" error={errors.bankName}>
            <TextInput id="ch-bank" value={f.bankName} onChange={set('bankName')} error={errors.bankName} />
          </Field>
        )}
        <Field id="ch-name" label={f.type === 'bank' ? 'Account name' : 'Account name (optional)'} error={errors.accountName}>
          <TextInput id="ch-name" value={f.accountName} onChange={set('accountName')} error={errors.accountName} />
        </Field>
        <Field id="ch-number" label={f.type === 'bank' ? 'Account number' : 'Number (optional)'} error={errors.accountNumber}>
          <TextInput id="ch-number" value={f.accountNumber} onChange={set('accountNumber')} error={errors.accountNumber} />
        </Field>
        {f.type === 'qr' && (
          <Field id="ch-file" label="QR code image" hint="JPG, PNG or WebP, up to 10 MB." error={errors.file}>
            <input id="ch-file" type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block text-sm" />
          </Field>
        )}
      </form>
    </Dialog>
  );
}
