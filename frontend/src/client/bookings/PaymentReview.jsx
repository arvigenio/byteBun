import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useApprovePaymentMutation, useRejectPaymentMutation, useRequestProofMutation } from '../api.js';
import { FileViewer } from '../components/Payments.jsx';
import { fmtMoney, MoneyField } from '../components/Money.jsx';
import { fmtTime } from '../lib/format.js';
import { fmtBytes } from '../lib/upload.js';
import { Badge, Button, Dialog, Field, Icon, ICONS, Textarea, usePrompt } from '../ui.jsx';

// Paid events, the business's side (backend: booking/event-payments.ts):
//   verify a registration's proofs of payment: approve, request another proof (replaces the last),
//   request an additional proof (an insufficient amount: the amount still due), or reject (not
//   approved: emailed, registration cancelled). Each request emails a new, unique upload link
//   (10 hours, then the place is released).
//   refunds: full (optionally cancelling the registration; proof of refund optional) or partial
//   (an excess amount; proof of refund required). The attendee is emailed with the proof attached.

const proofUrl = (e, t, p) => `/api/client/bookings/events/${e.id}/tickets/${t.id}/proofs/${p.id}`;
const REQUEST_LABEL = { replace: 'Asked for another proof', additional: 'Asked for an additional proof' };

/** Just the counts, above the registrations: what needs doing. */
/** One entry per booking: a bulk booking's spots count once. */
const bookingsIn = (list) => new Set(list.map((t) => t.groupId ?? `t${t.id}`)).size;

export function PaymentsSummary({ tickets, onShow }) {
  const review = bookingsIn(tickets.filter((t) => t.status === 'review'));
  const waiting = bookingsIn(tickets.filter((t) => t.status === 'rejected'));
  if (!review && !waiting) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-card border-2 border-warn/60 bg-warn/10 px-4 py-3">
      <span className="grid size-9 shrink-0 place-items-center rounded-full bg-warn text-white">
        <Icon d={ICONS.clock} className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold">
          {review > 0 ? `${review} payment${review === 1 ? '' : 's'} for verification` : 'No payments for verification'}
          {waiting > 0 && <span className="font-normal text-muted"> · {waiting} waiting for a proof</span>}
        </p>
        <p className="text-xs text-muted">Click a registration to view its proof and approve it, ask for another or an additional proof, or reject it.</p>
      </div>
      <Button size="sm" variant="secondary" onClick={onShow}>
        Show them
      </Button>
    </div>
  );
}

/**
 * Verifying payments from the registrations list: `open(t)` shows a registration's proofs (with
 * the actions in the viewer), `actions(t)` the buttons for its row, `info(t)` a line about the
 * proofs or the request, `dialogs` the modals (render once).
 */
export function usePaymentReview(e, tz, tickets = []) {
  // A bulk booking is verified as one: its spots waiting for verification (or just this one).
  const bookingOf = (t) => (t.groupId ? tickets.filter((x) => x.groupId === t.groupId && (x.status === 'review' || x.status === 'rejected')) : [t]);
  const totalOf = (spots) => {
    if (e.price == null || !e.currency) return null;
    const sum = spots.reduce((a, x) => a + Math.max(0, e.price - (x.discount ?? 0)), 0);
    return fmtMoney(sum, e.currency);
  };
  const whose = (t) => {
    const n = bookingOf(t).length;
    return n > 1 ? `${t.name}’s booking (${n} spots)` : `${t.name}’s payment`;
  };
  const [viewing, setViewing] = useState(null); // { t, start } | null
  const [asking, setAsking] = useState(null); // { ticket, kind }
  const [listing, setListing] = useState(null); // ticket: its uploaded files
  const [refundView, setRefundView] = useState(null); // { r, name }: a proof of refund
  const [approving, setApproving] = useState(null); // ticket: the confirmation, with its proofs
  const [approve, approveState] = useApprovePaymentMutation();
  const [reject] = useRejectPaymentMutation();
  const prompt = usePrompt();

  // Approve: first a confirmation showing the proofs, then the approval.
  const doApprove = (t) => {
    setViewing(null);
    setApproving(t);
  };
  const confirmApprove = async (t) => {
    const r = await approve({ id: e.id, ticketId: t.id });
    if (r.error) return toast.error(r.error.message);
    toast.success(r.data?.places > 1 ? `${t.name}’s booking approved: ${r.data.places} spots` : `${t.name}’s payment approved`, { description: r.data?.places > 1 ? 'Every QR code (and one PDF of them all) is on the way.' : 'Their confirmation and QR code are on the way.' });
    setApproving(null);
  };
  const doReject = async (t) => {
    const reason = await prompt({
      title: `Reject ${whose(t)}?`,
      label: 'Reason (optional, emailed to them)',
      hint: bookingOf(t).length > 1
        ? `They’re emailed once that the payment was not approved. All ${bookingOf(t).length} spots of this booking are cancelled and freed. To let them try again, ask for another proof instead.`
        : 'They’re emailed that the payment was not approved. Their registration is cancelled, the spot is freed, and the proofs are deleted. To let them try again, ask for another proof instead.',
      action: 'Reject payment',
      required: false,
    });
    if (reason === null) return;
    const r = await reject({ id: e.id, ticketId: t.id, reason: reason || null });
    if (r.error) return toast.error(r.error.message);
    toast.success('Payment rejected. They were emailed that it was not approved.');
    setViewing(null);
  };
  const ask = (t, kind) => {
    setViewing(null);
    setAsking({ ticket: t, kind });
  };

  const actions = (t) =>
    t.status === 'review' ? (
      <>
        <ActionMenu
          label="Ask for…"
          items={[
            ['Another proof', 'The proof is unclear or wrong: the new one replaces it.', () => ask(t, 'replace')],
            ['An additional proof', 'They paid too little: ask for the rest.', () => ask(t, 'additional')],
          ]}
        />
        <Button size="sm" variant="danger" onClick={() => doReject(t)}>
          Reject
        </Button>
        <Button size="sm" onClick={() => doApprove(t)} loading={approveState.isLoading && approveState.originalArgs?.ticketId === t.id}>
          <Icon d={ICONS.check} className="size-4" /> Approve
        </Button>
      </>
    ) : t.status === 'rejected' ? (
      <>
        <Button size="sm" variant="secondary" onClick={() => ask(t, t.proofRequest === 'additional' ? 'additional' : 'replace')}>
          Send a new link
        </Button>
        <Button size="sm" variant="danger" onClick={() => doReject(t)}>
          Reject
        </Button>
      </>
    ) : null;

  const info = (t) =>
    t.status === 'review' && t.proofs?.length ? (
      <p className="mt-0.5 text-xs text-warn">
        {bookingOf(t).length > 1 && <strong className="mr-1 rounded bg-warn/15 px-1.5 py-0.5 font-bold">Bulk booking · {bookingOf(t).length} spots{totalOf(bookingOf(t)) ? ` · ${totalOf(bookingOf(t))}` : ''}</strong>}
        {t.proofs.length > 1 ? `${t.proofs.length} proofs · last sent ` : 'Proof sent '}
        {fmtTime(t.proofs[t.proofs.length - 1].uploadedAt, tz)}
        {t.proofRequest === 'additional' && t.amountDue ? ` · includes the additional ${t.amountDue}` : ''} · click to view
      </p>
    ) : t.status === 'rejected' ? (
      <p className="mt-0.5 text-xs text-danger">
        {bookingOf(t).length > 1 && <strong className="mr-1">Bulk booking · {bookingOf(t).length} spots ·</strong>}
        {REQUEST_LABEL[t.proofRequest] ?? 'Asked for a proof'}
        {t.proofRequest === 'additional' && t.amountDue ? ` (${t.amountDue} still due)` : ''}
        {t.paymentNote ? `: “${t.paymentNote}”` : ''} · until {fmtTime(t.reuploadBy, tz)}, then the place is released
      </p>
    ) : null;

  const canOpen = (t) => (t.status === 'review' || t.status === 'rejected') && t.proofs?.length > 0;

  /** A paperclip with the number of files in the history: opens it. */
  const filesButton = (t) => {
    const count = (t.uploads?.length ?? 0) + (t.refunds ?? []).filter((r) => r.proofName).length;
    return count > 0 ? (
      <button
        type="button"
        onClick={() => setListing(t)}
        title={`File history: ${count} file${count === 1 ? '' : 's'}`}
        aria-label={`Show ${t.name}’s file history`}
        className="inline-flex h-9 cursor-pointer items-center gap-1 rounded-btn px-2 text-sm font-semibold text-muted hover:bg-sunken hover:text-ink"
      >
        <Icon d={CLIP} className="size-[18px]" />
        {count}
      </button>
    ) : null;
  };

  const dialogs = (
    <>
      {viewing && (
        <ProofsViewer
          e={e}
          t={viewing.t}
          start={viewing.start}
          onClose={() => setViewing(null)}
          footer={
            !viewing.history && (viewing.t.status === 'review' || viewing.t.status === 'rejected') ? (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="ghost" onClick={() => setViewing(null)}>
                  Close
                </Button>
                {actions(viewing.t)}
              </div>
            ) : undefined
          }
        />
      )}
      {listing && (
        <FilesDialog
          e={e}
          t={listing}
          tz={tz}
          onClose={() => setListing(null)}
          onView={(n) => {
            setListing(null);
            setViewing({ t: { ...listing, proofs: listing.uploads }, start: n, history: true });
          }}
          onViewRefund={(r) => setRefundView({ r, name: listing.name })}
        />
      )}
      {refundView && (
        <FileViewer
          open
          onClose={() => setRefundView(null)}
          url={`/api/client/bookings/events/${e.id}/refunds/${refundView.r.id}/proof`}
          type={refundView.r.proofType}
          title={`Proof of refund · ${refundView.name}${refundView.r.amount ? ` · ${refundView.r.amount}` : ''}`}
        />
      )}
      {approving && <ApproveDialog e={e} t={approving} spots={bookingOf(approving)} total={totalOf(bookingOf(approving))} tz={tz} busy={approveState.isLoading} onConfirm={() => confirmApprove(approving)} onClose={() => setApproving(null)} />}
      {asking && <RequestProofDialog e={e} t={asking.ticket} spots={bookingOf(asking.ticket).length} kind={asking.kind} onClose={() => setAsking(null)} />}
    </>
  );

  /** The same actions as menu items (the row's pop-over). */
  const fileCount = (t) => (t.uploads?.length ?? 0) + (t.refunds ?? []).filter((r) => r.proofName).length;
  const menuItems = (t) =>
    t.status === 'review'
      ? [
          t.proofs?.length ? { label: `View proof${t.proofs.length > 1 ? `s (${t.proofs.length})` : ''}`, icon: ICONS.eye, onClick: () => setViewing({ t, start: t.proofs.length - 1 }) } : null,
          { label: 'Approve payment', icon: ICONS.check, tone: 'primary', onClick: () => doApprove(t) },
          { label: 'Ask for another proof', hint: 'Unclear or wrong: the new one replaces it.', icon: ICONS.mail, onClick: () => ask(t, 'replace') },
          { label: 'Ask for an additional proof', hint: 'They paid too little.', icon: ICONS.mail, onClick: () => ask(t, 'additional') },
          { label: 'Reject payment', hint: 'Emailed: not approved. Registration cancelled.', icon: ICONS.xCircle, tone: 'danger', onClick: () => doReject(t) },
        ]
      : t.status === 'rejected'
        ? [
            t.proofs?.length ? { label: 'View proofs', icon: ICONS.eye, onClick: () => setViewing({ t, start: t.proofs.length - 1 }) } : null,
            { label: 'Send a new upload link', icon: ICONS.mail, onClick: () => ask(t, t.proofRequest === 'additional' ? 'additional' : 'replace') },
            { label: 'Reject payment', icon: ICONS.xCircle, tone: 'danger', onClick: () => doReject(t) },
          ]
        : [];

  return { open: (t) => setViewing({ t, start: t.proofs.length - 1 }), canOpen, actions, info, filesButton, menuItems, fileCount, openFiles: (t) => setListing(t), dialogs };
}

/**
 * A small menu button: [label, hint, onClick] items. The menu is placed against the window
 * (fixed), so a list that clips its overflow doesn't cut it off; near the bottom it opens upward.
 */
function ActionMenu({ label, items }) {
  const [pos, setPos] = useState(null); // { top|bottom, right }
  const btn = useRef(null);
  useEffect(() => {
    if (!pos) return undefined;
    const close = () => setPos(null);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [pos]);
  const toggle = () => {
    if (pos) return setPos(null);
    const r = btn.current.getBoundingClientRect();
    const right = Math.max(8, window.innerWidth - r.right);
    setPos(window.innerHeight - r.bottom < 180 ? { bottom: window.innerHeight - r.top + 6, right } : { top: r.bottom + 6, right });
  };
  return (
    <div onBlur={(ev) => !ev.currentTarget.contains(ev.relatedTarget) && setPos(null)}>
      <span ref={btn} className="inline-flex">
        <Button size="sm" variant="secondary" aria-expanded={!!pos} onClick={toggle}>
          {label} <Icon d="M6 9l6 6 6-6" className="size-4" />
        </Button>
      </span>
      {pos && (
        <div className="fixed z-50 w-64 rounded-xl border border-line bg-surface p-1.5 shadow-lg" style={pos}>
          {items.map(([title, hint, onClick]) => (
            <button
              key={title}
              type="button"
              onClick={() => {
                setPos(null);
                onClick();
              }}
              className="flex w-full cursor-pointer flex-col rounded-lg px-3 py-2 text-left hover:bg-sunken"
            >
              <span className="text-sm font-semibold text-ink">{title}</span>
              <span className="text-xs text-muted">{hint}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const CLIP = 'M21 12.5l-8.5 8.5a5.5 5.5 0 01-7.8-7.8l9-9a3.7 3.7 0 015.2 5.2l-9 9a1.8 1.8 0 01-2.6-2.6l8.3-8.3';

const OUTCOME = {
  replaced: ['neutral', 'Replaced'],
  approved: ['ok', 'Approved'],
  rejected: ['danger', 'Rejected'],
  refunded: ['neutral', 'Refunded'],
  expired: ['neutral', 'Expired (no proof in time)'],
  removed: ['neutral', 'Registration removed'],
};
const when = (iso, tz) => new Intl.DateTimeFormat(undefined, { timeZone: tz, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));

/**
 * The history of a registration's files, newest first: every proof of payment uploaded (current
 * ones can be viewed or downloaded; deleted ones show why) and every proof of refund emailed.
 */
function FilesDialog({ e, t, tz, onClose, onView, onViewRefund }) {
  const items = [
    ...(t.uploads ?? []).map((u) => ({ kind: 'proof', at: u.uploadedAt, u })),
    ...(t.refunds ?? []).filter((r) => r.proofName).map((r) => ({ kind: 'refund', at: r.at, r })),
  ].sort((a, b) => new Date(b.at) - new Date(a.at));
  const position = (u) => t.uploads.findIndex((p) => p.id === u.id);
  return (
    <Dialog open onClose={onClose} title={`File history · ${t.name}`} footer={<Button onClick={onClose}>Close</Button>}>
      <p className="mb-3 text-sm text-muted">Every file for this registration, with what became of it. Proofs of payment and of refund are kept until the event is deleted (they’re in the zipped export too).</p>
      {!items.length ? (
        <p className="py-6 text-center text-sm text-faint">No files yet.</p>
      ) : (
        <ol className="relative flex flex-col gap-3 border-l-2 border-line pl-5">
          {items.map((it) => {
            if (it.kind === 'refund') {
              const r = it.r;
              return (
                <li key={`r${r.id}`} className="relative">
                  <span className="absolute top-3 -left-[27px] size-3 rounded-full border-2 border-surface bg-brand" aria-hidden="true" />
                  <div className="flex items-center gap-3 rounded-card border border-line px-3 py-2.5">
                    <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-brand-soft text-[10px] font-bold text-brand">REFUND</span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{r.proofName}</p>
                      <p className="text-xs text-muted">
                        Proof of {r.type === 'partial' ? 'partial ' : ''}refund{r.amount ? ` (${r.amount})` : ''} emailed by {r.by} · {when(r.at, tz)}
                      </p>
                    </div>
                    {r.hasProof ? (
                      <div className="flex items-center gap-1">
                        <Button size="sm" variant="secondary" onClick={() => onViewRefund(r)}>
                          View
                        </Button>
                        <a href={`/api/client/bookings/events/${e.id}/refunds/${r.id}/proof`} download={r.proofName ?? 'proof-of-refund'} className="inline-flex size-9 items-center justify-center rounded-btn text-muted hover:bg-sunken hover:text-ink" title="Download" aria-label="Download the proof of refund">
                          <Icon d="M12 4v12M7 11l5 5 5-5M4 20h16" className="size-[18px]" />
                        </a>
                      </div>
                    ) : (
                      <Badge>Emailed (not kept)</Badge>
                    )}
                  </div>
                </li>
              );
            }
            const u = it.u;
            const n = position(u);
            const pdf = u.type === 'application/pdf';
            const settled = !!u.outcome;
            return (
              <li key={`p${u.id}`} className="relative">
                <span className={`absolute top-3 -left-[27px] size-3 rounded-full border-2 border-surface ${settled ? 'bg-line-strong' : 'bg-warn'}`} aria-hidden="true" />
                <div className={`flex flex-wrap items-center gap-3 rounded-card border px-3 py-2.5 ${settled ? 'border-line' : 'border-warn/50'}`}>
                  <span className={`grid size-10 shrink-0 place-items-center rounded-lg text-[11px] font-bold ${pdf ? 'bg-danger/10 text-danger' : 'bg-brand-soft text-brand'}`}>{pdf ? 'PDF' : 'IMG'}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{u.name}</p>
                    <p className="text-xs text-muted">
                      Proof of payment · {fmtBytes(u.size)} · uploaded {when(u.uploadedAt, tz)}
                      {u.outcomeAt ? ` · ${(OUTCOME[u.outcome] ?? [null, u.outcome])[1].toLowerCase()} ${when(u.outcomeAt, tz)}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    {settled ? <Badge tone={(OUTCOME[u.outcome] ?? ['neutral'])[0]}>{(OUTCOME[u.outcome] ?? [null, u.outcome])[1]}</Badge> : <Badge tone="warn">To verify</Badge>}
                    <Button size="sm" variant="secondary" onClick={() => onView(n)}>
                      View
                    </Button>
                    <a href={proofUrl(e, t, u)} download={u.name} className="inline-flex size-9 items-center justify-center rounded-btn text-muted hover:bg-sunken hover:text-ink" title="Download" aria-label={`Download ${u.name}`}>
                      <Icon d="M12 4v12M7 11l5 5 5-5M4 20h16" className="size-[18px]" />
                    </a>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      )}
    </Dialog>
  );
}

/** Every proof of a registration, one at a time, in the modal viewer. */
function ProofsViewer({ e, t, start, onClose, footer }) {
  const [i, setI] = useState(start ?? t.proofs.length - 1);
  const p = t.proofs[i];
  if (!p) return null;
  return (
    <FileViewer
      open
      onClose={onClose}
      url={proofUrl(e, t, p)}
      type={p.type}
      title={`Proof of payment${t.proofs.length > 1 ? ` ${i + 1} of ${t.proofs.length}` : ''} · ${t.name}`}
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          {t.proofs.length > 1 ? (
            <div className="flex gap-1">
              {t.proofs.map((x, n) => (
                <button key={x.id} type="button" onClick={() => setI(n)} className={`cursor-pointer rounded-md px-2.5 py-1 text-xs font-semibold ${n === i ? 'bg-brand text-brand-ink' : 'bg-sunken text-muted hover:text-ink'}`} title={`${x.name} · ${fmtBytes(x.size)}`}>
                  {n + 1}
                </button>
              ))}
            </div>
          ) : (
            <span />
          )}
          {footer ?? <Button onClick={onClose}>Close</Button>}
        </div>
      }
    />
  );
}

/** "Approve this payment?" with every proof being verified shown, to check one last time. */
function ApproveDialog({ e, t, spots = [t], total = null, tz, busy, onConfirm, onClose }) {
  const proofs = t.proofs ?? [];
  const n = spots.length;
  const promoted = spots.filter((x) => x.promoCode).length;
  return (
    <Dialog
      open
      wide
      onClose={onClose}
      busy={busy}
      title={n > 1 ? `Approve ${t.name}’s booking (${n} spots)?` : `Approve ${t.name}’s payment?`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onConfirm} loading={busy}>
            <Icon d={ICONS.check} className="size-4" /> {n > 1 ? `Approve all ${n} spots` : 'Approve payment'}
          </Button>
        </>
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-1 rounded-card bg-sunken/60 px-4 py-3 text-sm">
        <span>
          <span className="text-muted">Attendee </span>
          <strong>{t.name}</strong> · {t.email}
        </span>
        {e.priceLabel && (
          <span>
            <span className="text-muted">Price </span>
            <strong>{n > 1 ? `${n} × ${e.priceLabel}` : e.priceLabel}</strong>
          </span>
        )}
        {total && (n > 1 || promoted > 0) && (
          <span>
            <span className="text-muted">To be paid </span>
            <strong>{total}</strong>
            {promoted > 0 && <span className="text-muted"> (promo {spots.find((x) => x.promoCode)?.promoCode} on {promoted === n ? (n > 1 ? `all ${n} spots` : 'it') : `${promoted} of ${n} spots`})</span>}
          </span>
        )}
        {t.proofRequest === 'additional' && t.amountDue && (
          <span>
            <span className="text-muted">Additional </span>
            <strong>{t.amountDue}</strong>
          </span>
        )}
      </div>
      <p className="mb-3 text-sm text-muted">Check that the proof{proofs.length > 1 ? 's match' : ' matches'} a payment in your account. {n > 1 ? `This is one bulk booking: approving confirms all ${n} spots and emails ${t.name} every QR code, with one PDF of them all.` : `Approving emails ${t.name} their confirmation and QR code.`}</p>
      {!proofs.length ? (
        <p className="rounded-card border border-dashed border-line-strong px-4 py-6 text-center text-sm text-muted">No proof of payment to show.</p>
      ) : (
        <div className={`grid gap-3 ${proofs.length > 1 ? 'desktop:grid-cols-2' : ''}`}>
          {proofs.map((p, n) => (
            <figure key={p.id} className="overflow-hidden rounded-card border border-line bg-surface">
              <div className="bg-sunken">
                {p.type === 'application/pdf' ? (
                  <iframe src={proofUrl(e, t, p)} title={p.name} className="h-80 w-full bg-white" />
                ) : (
                  <a href={proofUrl(e, t, p)} target="_blank" rel="noreferrer" title="Open full size">
                    <img src={proofUrl(e, t, p)} alt={`Proof of payment ${n + 1}`} className="mx-auto max-h-80 w-auto object-contain" />
                  </a>
                )}
              </div>
              <figcaption className="flex items-center justify-between gap-2 border-t border-line px-3 py-2 text-xs text-muted">
                <span className="truncate">
                  {proofs.length > 1 ? `${n + 1}. ` : ''}
                  {p.name}
                </span>
                <span className="shrink-0">{fmtTime(p.uploadedAt, tz)}</span>
              </figcaption>
            </figure>
          ))}
        </div>
      )}
    </Dialog>
  );
}

/** Ask for another proof (replaces the last) or an additional one (the amount still due). */
function RequestProofDialog({ e, t, spots = 1, kind: initialKind, onClose }) {
  const [request, state] = useRequestProofMutation();
  const [kind, setKind] = useState(initialKind);
  const [note, setNote] = useState('');
  const [amountDue, setAmountDue] = useState('');
  const [errors, setErrors] = useState({});
  const send = async (ev) => {
    ev?.preventDefault();
    setErrors({});
    const r = await request({ id: e.id, ticketId: t.id, kind, note: note.trim() || null, amountDue: kind === 'additional' ? Number(amountDue) || null : null });
    if (r.error) {
      setErrors(r.error.fields ?? {});
      return toast.error(r.error.message);
    }
    toast.success(`${t.name} was emailed a new upload link`, { description: 'It works for 10 hours, then their spot is released.' });
    onClose();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      busy={state.isLoading}
      title={`Ask ${t.name} for ${kind === 'additional' ? 'an additional' : 'another'} proof${spots > 1 ? ` (booking of ${spots} spots)` : ''}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="request-proof" loading={state.isLoading} disabled={kind === 'additional' && !(Number(amountDue) > 0)}>
            Email the upload link
          </Button>
        </>
      }
    >
      <form id="request-proof" onSubmit={send} className="flex flex-col gap-4" noValidate>
        <div className="flex gap-1 rounded-btn bg-sunken p-1" role="tablist" aria-label="What to ask for">
          {[
            ['replace', 'Another proof'],
            ['additional', 'Additional proof'],
          ].map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={kind === k} onClick={() => setKind(k)} className={`flex-1 cursor-pointer rounded-md px-3 py-1.5 text-sm font-medium ${kind === k ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'}`}>
              {l}
            </button>
          ))}
        </div>
        <p className="text-sm text-muted">
          {kind === 'additional' ? 'They paid less than the full amount. They pay the rest and upload its proof; their first proof is kept.' : 'The proof is unclear, the wrong file, or you can’t find the payment. Their new upload replaces the current proof.'} They get a new, unique link by email (any earlier link stops working) and have 10 hours, then their place is released.
        </p>
        {kind === 'additional' && (
          <Field label="Still to pay" hint={`In the event’s currency${e.priceLabel ? ` (the price is ${e.priceLabel})` : ''}. Shown in the email.`} error={errors.amountDue}>
            {(a) => <MoneyField id={a.id} amount={amountDue} currency={e.currency ?? 'PHP'} fixedCurrency onAmount={setAmountDue} invalid={!!errors.amountDue} autoFocus />}
          </Field>
        )}
        <Field label="Note (optional, emailed to them)" error={errors.note}>
          {(a) => <Textarea {...a} value={note} maxLength={500} rows={3} placeholder={kind === 'additional' ? 'E.g. We received ₱300 of ₱500.' : 'E.g. The screenshot is blurry.'} onChange={(x) => setNote(x.target.value)} />}
        </Field>
      </form>
    </Dialog>
  );
}

