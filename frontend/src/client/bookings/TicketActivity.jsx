import { useState } from 'react';
import { useTicketLogQuery } from '../api.js';
import { Button, Dialog, Icon, ICONS, Loading } from '../ui.jsx';

// A registration's activity log (backend: GET …/tickets/:tid/log): every action on it, who did
// it and when: registered, proof uploaded, verified, proof requested, refunded, checked in,
// claimed, revoked, cancelled...

const ACTION = {
  registered: ['Registered', 'brand', ICONS.user],
  registered_manually: ['Registered manually', 'brand', ICONS.user],
  code_issued: ['Code given out', 'neutral', ICONS.tag],
  code_used: ['Registered with the code', 'brand', ICONS.tag],
  proof_uploaded: ['Proof of payment uploaded', 'warn', 'M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3'],
  payment_approved: ['Payment approved', 'ok', ICONS.check],
  payment_rejected: ['Payment rejected', 'danger', ICONS.xCircle],
  another_proof_requested: ['Asked for another proof', 'warn', ICONS.mail],
  additional_proof_requested: ['Asked for an additional proof', 'warn', ICONS.mail],
  expired: ['No proof in time: place released', 'danger', ICONS.clock],
  full_refund: ['Full refund', 'danger', ICONS.refund],
  partial_refund: ['Partial refund', 'danger', ICONS.refund],
  checked_in: ['Checked in', 'ok', ICONS.check],
  check_in_undone: ['Check-in undone', 'neutral', ICONS.undo],
  claimed: ['Claimed', 'ok', ICONS.tag],
  claim_undone: ['Claim undone', 'neutral', ICONS.undo],
  revoked: ['Revoked', 'danger', ICONS.xCircle],
  removed: ['Removed from the list', 'danger', ICONS.trash],
  cancelled: ['Cancelled by them', 'neutral', ICONS.xCircle],
};
const TONE = { brand: 'bg-brand text-brand-ink', ok: 'bg-ok text-white', warn: 'bg-warn text-white', danger: 'bg-danger text-white', neutral: 'bg-sunken text-muted' };
const when = (iso, tz) => new Intl.DateTimeFormat(undefined, { timeZone: tz, month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));

export function ActivityDialog({ e, t, tz, onClose }) {
  const q = useTicketLogQuery({ id: e.id, ticketId: t.id });
  return (
    <Dialog open onClose={onClose} title={`Activity · ${t.name}`} footer={<Button onClick={onClose}>Close</Button>}>
      <p className="mb-4 text-sm text-muted">
        {t.email} · <span className="font-mono">{t.code}</span>
      </p>
      {q.isLoading ? (
        <Loading />
      ) : q.error ? (
        <p className="text-sm text-danger">{q.error.message}</p>
      ) : !q.data.entries.length ? (
        <p className="py-6 text-center text-sm text-faint">Nothing recorded yet.</p>
      ) : (
        <ol className="relative flex flex-col gap-4 border-l-2 border-line pl-6">
          {q.data.entries.map((x) => {
            const [label, tone, icon] = ACTION[x.action] ?? [x.action.replace(/_/g, ' '), 'neutral', ICONS.list];
            return (
              <li key={x.id} className="relative">
                <span className={`absolute top-0 -left-[37px] grid size-6 place-items-center rounded-full ring-4 ring-surface ${TONE[tone]}`} aria-hidden="true">
                  <Icon d={icon} className="size-3.5" />
                </span>
                <p className="text-sm font-semibold text-ink">
                  {label}
                  {x.action === 'claimed' || x.action === 'claim_undone' ? (x.detail ? `: ${x.detail}` : '') : ''}
                </p>
                {x.detail && x.action !== 'claimed' && x.action !== 'claim_undone' && <p className="text-sm text-muted">{x.detail}</p>}
                <p className="text-xs text-faint">
                  {when(x.at, tz)}
                  {x.by ? ` · by ${x.by}` : ''}
                </p>
              </li>
            );
          })}
        </ol>
      )}
    </Dialog>
  );
}

/** The Activity button on a registration's row. */
export function ActivityButton({ e, t, tz }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Activity log"
        aria-label={`Show ${t.name}’s activity`}
        className="inline-flex size-9 cursor-pointer items-center justify-center rounded-btn text-muted hover:bg-sunken hover:text-ink"
      >
        <Icon d="M12 8v4l3 2M3.05 11a9 9 0 11.5 4M3 4v5h5" className="size-[18px]" />
      </button>
      {open && <ActivityDialog e={e} t={t} tz={tz} onClose={() => setOpen(false)} />}
    </>
  );
}
