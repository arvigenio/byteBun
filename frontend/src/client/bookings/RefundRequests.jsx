import { useState } from 'react';
import { toast } from 'sonner';
import { useCancelRefundRequestMutation, useCompleteRefundRequestMutation, useRefundRequestsQuery, useResendRefundRequestMutation, useSendRefundRequestMutation } from '../api.js';
import { fmtMoney, MoneyField } from '../components/Money.jsx';
import { FilePicker, FileViewer } from '../components/Payments.jsx';
import { compressImage, fileProblem, MAX_UPLOAD_MB, PROOF_ACCEPT } from '../lib/upload.js';
import { Badge, Button, Checkbox, Dialog, Field, Icon, ICONS, Loading, Textarea, useConfirm } from '../ui.jsx';

// Refund requests (paid events; backend: booking/event-refund-requests.ts): ask an attendee
// where to send their refund (a unique emailed link: QR code or bank details), then mark it
// completed with the proof of refund (emailed to them, the refund recorded).

const STATUS = { waiting: ['warn', 'Waiting for their details'], submitted: ['brand', 'Details received'], completed: ['ok', 'Completed'], cancelled: ['neutral', 'Cancelled'] };
const when = (iso, tz) => new Intl.DateTimeFormat(undefined, { timeZone: tz, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));

/** "Send a refund request" from a registration. */
/** What's left to refund on a registration (paid minus refunds, in the paid currency); null if unknown. */
export function refundableLeft(e, t) {
  if (t.amountPaid == null && e.price == null) return null;
  const cur = t.paidCurrency ?? e.currency ?? 'PHP';
  const paid = t.amountPaid ?? e.price ?? 0;
  const refunded = (t.refunds ?? []).filter((r) => (r.currency ?? cur) === cur).reduce((a, r) => a + (r.amountValue ?? 0), 0);
  return Math.max(0, Math.round((paid - refunded) * 100) / 100);
}

/** Paid, refunded and what's left over several spots (a bulk booking), in the paid currency. */
export function refundTotals(e, list) {
  const cur = list[0].paidCurrency ?? e.currency ?? 'PHP';
  const round = (v) => Math.round(v * 100) / 100;
  let paid = 0;
  let refunded = 0;
  for (const t of list) {
    paid += t.amountPaid ?? e.price ?? 0;
    refunded += (t.refunds ?? []).filter((r) => (r.currency ?? cur) === cur).reduce((a, r) => a + (r.amountValue ?? 0), 0);
  }
  return { cur, paid: round(paid), refunded: round(refunded), remaining: Math.max(0, round(paid - refunded)) };
}

/** A bulk booking: act on the whole booking (default) or only this spot. */
export function ScopeChoice({ spots, scope, onChange }) {
  if (spots.length < 2) return null;
  return (
    <div className="grid gap-2 desktop:grid-cols-2" role="radiogroup" aria-label="Which spots">
      {[
        ['booking', `Whole booking (${spots.length} spots)`, 'Every spot of this bulk booking, in one go.'],
        ['spot', 'Only this spot', 'Just this one code; the other spots stay as they are.'],
      ].map(([k, l, h]) => (
        <button key={k} type="button" role="radio" aria-checked={scope === k} onClick={() => onChange(k)} className={`cursor-pointer rounded-card border-2 p-3 text-left ${scope === k ? 'border-brand bg-brand-soft' : 'border-line hover:border-line-strong'}`}>
          <span className="block text-sm font-semibold text-ink">{l}</span>
          <span className="block text-xs text-muted">{h}</span>
        </button>
      ))}
    </div>
  );
}

export function SendRefundRequestDialog({ e, t, spots = [t], onClose }) {
  const [send, state] = useSendRefundRequestMutation();
  const [scope, setScope] = useState('booking');
  const chosen = scope === 'spot' || spots.length < 2 ? [t] : spots;
  const { cur, paid, refunded, remaining } = refundTotals(e, chosen);
  const [type, setType] = useState('full');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [cancel, setCancel] = useState(false);
  const [errors, setErrors] = useState({});
  // Unknown paid amount (older registrations): the server works it out.
  const unknown = t.amountPaid == null && e.price == null;
  const nothing = !unknown && remaining <= 0;
  const amountProblem = type === 'partial' && amount !== '' ? (Number(amount) <= 0 ? 'Please enter the amount.' : !unknown && Number(amount) > remaining ? `At most ${fmtMoney(remaining, cur)}.` : null) : null;
  const ok = !nothing && (type === 'full' || (Number(amount) > 0 && !amountProblem));
  const submit = async (ev) => {
    ev?.preventDefault();
    setErrors({});
    const r = await send({ id: e.id, ticketId: t.id, type, amount: type === 'partial' ? Number(amount) : null, note: note.trim() || null, cancel: type === 'full' && cancel, scope: chosen.length > 1 ? 'booking' : 'spot' });
    if (r.error) {
      setErrors(r.error.fields ?? {});
      return toast.error(r.error.message);
    }
    toast.success(`Refund request sent to ${t.name}${chosen.length > 1 ? ` (${chosen.length} spots)` : ''}`, { description: 'They get a link to give their QR code or bank details. Find it in the Refund requests tab.' });
    onClose();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      busy={state.isLoading}
      title={`Send ${t.name} a refund request${chosen.length > 1 ? ` (${chosen.length} spots)` : ''}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="refund-request" loading={state.isLoading} disabled={!ok}>
            Email the request
          </Button>
        </>
      }
    >
      <form id="refund-request" onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <ScopeChoice spots={spots} scope={scope} onChange={setScope} />
        {nothing && (
          <div className="rounded-card border border-warn/50 bg-warn/10 px-4 py-3 text-sm">
            <p className="font-semibold text-ink">Nothing left to refund</p>
            <p className="text-muted">
              {paid <= 0 ? 'This spot was free (₱0 paid).' : `They paid ${fmtMoney(paid, cur)} and ${fmtMoney(refunded, cur)} was already refunded.`}
            </p>
          </div>
        )}
        <p className="text-sm text-muted">They get an email with a private link to upload their QR code or enter their bank details (bank name, account name, account number). You then send the refund and mark the request completed with the proof.</p>
        <div className="grid gap-2 desktop:grid-cols-2" role="radiogroup" aria-label="Refund type">
          {[
            ['full', 'Full refund', unknown ? 'What they paid' : remaining > 0 ? `The remaining ${fmtMoney(remaining, cur)}` : 'Nothing left to refund'],
            ['partial', 'Partial refund', 'An amount you choose'],
          ].map(([k, l, h]) => (
            <button key={k} type="button" role="radio" aria-checked={type === k} onClick={() => setType(k)} className={`cursor-pointer rounded-card border-2 p-3 text-left ${type === k ? 'border-brand bg-brand-soft' : 'border-line hover:border-line-strong'}`}>
              <span className="block text-sm font-semibold text-ink">{l}</span>
              <span className="block text-xs text-muted">{h}</span>
            </button>
          ))}
        </div>
        {type === 'partial' && (
          <Field label="Amount to refund" hint={unknown ? undefined : `At most ${fmtMoney(remaining, cur)}.`} error={errors.amount || amountProblem}>
            {(a) => <MoneyField id={a.id} amount={amount} currency={cur} fixedCurrency onAmount={setAmount} invalid={!!errors.amount} />}
          </Field>
        )}
        {type === 'full' && <Checkbox label={chosen.length > 1 ? `Cancel all ${chosen.length} spots when it’s completed` : 'Cancel the registration when it’s completed'} hint={chosen.length > 1 ? 'The spots are freed and their QR codes stop working.' : 'Their spot is freed and their QR code stops working.'} checked={cancel} onChange={(x) => setCancel(x.target.checked)} />}
        <Field label="Note (optional, in the email)" error={errors.note}>
          {(a) => <Textarea {...a} value={note} maxLength={500} rows={2} onChange={(x) => setNote(x.target.value)} />}
        </Field>
      </form>
    </Dialog>
  );
}

function CompleteDialog({ e, r, onClose }) {
  const [complete, state] = useCompleteRefundRequestMutation();
  const [file, setFile] = useState(null);
  const [note, setNote] = useState('');
  const [preparing, setPreparing] = useState(false);
  const problem = file ? fileProblem(file) : null;
  const submit = async (ev) => {
    ev?.preventDefault();
    setPreparing(true);
    const up = await compressImage(file);
    setPreparing(false);
    const form = new FormData();
    form.append('file', up, up.name);
    if (note.trim()) form.append('note', note.trim());
    const res = await complete({ id: e.id, requestId: r.id, form });
    if (res.error) return toast.error(res.error.message);
    toast.success(`Refund completed. ${r.name} was emailed the proof.`);
    onClose();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      busy={state.isLoading || preparing}
      title={`Complete ${r.name}’s refund`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="complete-refund" loading={state.isLoading || preparing} disabled={!file || !!problem}>
            Mark as completed
          </Button>
        </>
      }
    >
      <form id="complete-refund" onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <p className="text-sm text-muted">
          Send {r.amount ? <strong className="text-ink">{r.amount}</strong> : 'the refund'} to them first. Then attach the proof of refund: it’s emailed to {r.name} and the refund is recorded{r.cancel ? ', and their registration is cancelled' : ''}.
        </p>
        <div>
          <p className="mb-1.5 text-sm font-medium">Proof of refund (required)</p>
          <FilePicker id="refund-proof-complete" accept={PROOF_ACCEPT} file={file} onChange={setFile} error={problem ?? undefined} label="Attach the proof of refund" hint={`Image or PDF · up to ${MAX_UPLOAD_MB} MB`} disabled={state.isLoading} />
        </div>
        <Field label="Note (optional, in the email)">{(a) => <Textarea {...a} value={note} maxLength={500} rows={2} onChange={(x) => setNote(x.target.value)} />}</Field>
      </form>
    </Dialog>
  );
}

/** The Refund requests tab. */
export function RefundRequestsTab({ e, tz }) {
  const q = useRefundRequestsQuery(e.id);
  const [resend] = useResendRefundRequestMutation();
  const [cancel] = useCancelRefundRequestMutation();
  const confirm = useConfirm();
  const [completing, setCompleting] = useState(null);
  const [viewingQr, setViewingQr] = useState(null);
  if (q.isLoading) return <Loading />;
  if (q.error) return <p className="text-sm text-danger">{q.error.message}</p>;
  const list = q.data.requests;
  const open = list.filter((r) => r.status === 'waiting' || r.status === 'submitted').length;
  return (
    <section className="overflow-hidden rounded-card border border-line bg-surface">
      <header className="border-b border-line px-4 py-3">
        <h2 className="font-semibold">
          Refund requests {open > 0 && <Badge tone="warn">{open} open</Badge>}
        </h2>
        <p className="text-xs text-muted">Send one from a registration’s refund menu. Once they send their details, refund them and mark it completed with the proof.</p>
      </header>
      {!list.length ? (
        <p className="px-4 py-8 text-center text-sm text-faint">No refund requests yet.</p>
      ) : (
        <ul className="divide-y divide-line">
          {list.map((r) => {
            const [tone, label] = STATUS[r.status];
            return (
              <li key={r.id} className="flex flex-wrap items-start gap-x-4 gap-y-2 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    {r.name} <span className="font-mono text-xs text-faint">{r.code}</span>
                  </p>
                  <p className="text-sm text-muted">
                    {r.type === 'full' ? 'Full refund' : 'Partial refund'}
                    {r.spots > 1 ? ` · bulk booking, ${r.spots} spots` : ''}
                    {r.amount ? ` · ${r.amount}` : ''}
                    {r.cancel ? ' · cancels the registration' : ''}
                  </p>
                  <p className="text-xs text-faint">
                    Asked {when(r.createdAt, tz)} by {r.createdBy}
                    {r.completedAt ? ` · completed ${when(r.completedAt, tz)} by ${r.completedBy}` : ''}
                  </p>
                  {r.status === 'submitted' &&
                    (r.method === 'bank' ? (
                      <div className="mt-2 inline-grid grid-cols-[auto_1fr] gap-x-3 rounded-btn bg-sunken px-3 py-2 text-sm">
                        <span className="text-muted">Bank</span>
                        <span className="font-semibold">{r.bankName}</span>
                        <span className="text-muted">Name</span>
                        <span className="font-semibold">{r.accountName}</span>
                        <span className="text-muted">Number</span>
                        <button type="button" className="cursor-pointer text-left font-mono font-semibold hover:text-brand" title="Copy" onClick={() => navigator.clipboard?.writeText(r.accountNumber.replace(/\s/g, '')).then(() => toast.success('Account number copied'))}>
                          {r.accountNumber}
                        </button>
                      </div>
                    ) : (
                      <Button size="sm" variant="secondary" className="mt-2" onClick={() => setViewingQr(r)}>
                        <Icon d={ICONS.qr} className="size-4" /> View their QR code
                      </Button>
                    ))}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={tone}>{label}</Badge>
                  {(r.status === 'waiting' || r.status === 'submitted') && (
                    <>
                      <Button size="sm" onClick={() => setCompleting(r)}>
                        <Icon d={ICONS.check} className="size-4" /> Mark as completed
                      </Button>
                      {r.status === 'waiting' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={async () => {
                            const res = await resend({ id: e.id, requestId: r.id });
                            if (res.error) toast.error(res.error.message);
                            else toast.success('A new link was emailed (the old one stops working).');
                          }}
                        >
                          Resend link
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={async () => {
                          if (!(await confirm({ title: 'Cancel this refund request?', body: 'Its link stops working. No refund is recorded.', action: 'Cancel request' }))) return;
                          const res = await cancel({ id: e.id, requestId: r.id });
                          if (res.error) toast.error(res.error.message);
                        }}
                      >
                        Cancel
                      </Button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {completing && <CompleteDialog e={e} r={completing} onClose={() => setCompleting(null)} />}
      {viewingQr && <FileViewer open onClose={() => setViewingQr(null)} url={`/api/client/bookings/events/${e.id}/refund-requests/${viewingQr.id}/qr`} type="image/webp" title={`${viewingQr.name}’s QR code for the refund`} />}
    </section>
  );
}
