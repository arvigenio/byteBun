import { useState } from 'react';
import { toast } from 'sonner';
import { useCreateEventVoucherMutation, useEventVouchersQuery, useHostedEventsQuery, useSetEventLimitMutation } from './clientsApi.js';
import { Dialog, usePrompt } from './dialogs.jsx';
import { AdminButton, Badge, Field, formatDateTime, Panel, TextInput } from './ui.jsx';

// A client's events and the vouchers for bigger ones (backend: clients/admin, booking/events.ts).
// No payment gateway yet: the client pays Byte Bun by hand, an admin creates a voucher here and
// gives it to them; they enter it when making (or growing) the event. Upon a new payment, an
// admin can also raise one event's participant limit directly.
//   Every event: 50 participants included (any plan). 51-300: $10. 301-500: $20. More: custom pricing.

const SIZES = [
  { participants: 300, price: '$10', label: 'Up to 300 participants · $10' },
  { participants: 500, price: '$20', label: 'Up to 500 participants · $20' },
];

export function ClientEventsPanel({ clientId }) {
  const events = useHostedEventsQuery(clientId);
  const vouchers = useEventVouchersQuery(clientId);
  const [setLimit] = useSetEventLimitMutation();
  const prompt = usePrompt();
  const [creating, setCreating] = useState(false);

  const raise = async (e) => {
    const value = await prompt({
      eyebrow: 'Event participant limit',
      title: `Participants for “${e.title}”`,
      label: 'Most participants allowed',
      hint: `Plan includes ${e.planLimit ?? 'no limit'}. Only raise it after the client has paid.`,
      value: String(e.participantLimit ?? e.planLimit ?? ''),
      action: 'Save limit',
      validate: (v) => (/^\d+$/.test(v) && Number(v) > 0 ? null : 'A whole number, please.'),
    });
    if (!value) return;
    const r = await setLimit({ id: clientId, eventId: e.id, participantLimit: Number(value), reason: 'New payment' });
    if (r.error) return toast.error(r.error.message);
    toast.success(`“${e.title}” can now have up to ${value} participants`);
  };

  return (
    <Panel className="desktop:col-span-2">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-midnight-plum">Events</h2>
          <p className="text-sm text-muted">Every event includes 50 participants (any plan). Bigger events are paid per event: 51–300 for $10, up to 500 for $20, more: custom.</p>
        </div>
        <AdminButton onClick={() => setCreating(true)}>New voucher</AdminButton>
      </div>

      <h3 className="mt-2 mb-2 text-sm font-bold text-midnight-plum">Their events</h3>
      {!events.data?.length ? (
        <p className="text-sm text-muted">No events yet.</p>
      ) : (
        <ul className="divide-y divide-line rounded-btn border-2 border-line">
          {events.data.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-sm">
              <span className="min-w-0 flex-1">
                <span className="font-semibold">{e.title}</span> <span className="text-muted">· {formatDateTime(e.startsAt)}</span>
              </span>
              <Badge>{e.kind}</Badge>
              <span className="text-muted">
                {e.registered} registered{e.capacity ? ` / ${e.capacity}` : ''} · limit {e.participantLimit ?? e.planLimit ?? 'none'}
              </span>
              <AdminButton variant="outline" className="min-h-9 px-3 py-1 text-sm" onClick={() => raise(e)}>
                Change limit
              </AdminButton>
            </li>
          ))}
        </ul>
      )}

      <h3 className="mt-5 mb-2 text-sm font-bold text-midnight-plum">Vouchers</h3>
      {!vouchers.data?.length ? (
        <p className="text-sm text-muted">No vouchers yet.</p>
      ) : (
        <ul className="divide-y divide-line rounded-btn border-2 border-line">
          {vouchers.data.map((v) => (
            <li key={v.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5 text-sm">
              <button type="button" className="cursor-pointer font-mono font-bold tracking-wider text-byte-purple" title="Copy" onClick={() => navigator.clipboard?.writeText(v.code).then(() => toast.success('Voucher copied'))}>
                {v.code}
              </button>
              <span>
                up to {v.participants}
                {v.priceLabel ? ` · ${v.priceLabel}` : ''}
              </span>
              <span className="min-w-0 flex-1 truncate text-muted">{v.note}</span>
              {v.usedAt ? <Badge tone="teal">Used{v.event ? `: ${v.event.title}` : ''}</Badge> : <Badge tone="gold">Not used yet</Badge>}
              <span className="text-xs text-muted">
                {formatDateTime(v.createdAt)} · {v.createdBy}
              </span>
            </li>
          ))}
        </ul>
      )}

      {creating && <VoucherDialog clientId={clientId} onClose={() => setCreating(false)} />}
    </Panel>
  );
}

function VoucherDialog({ clientId, onClose }) {
  const [create, state] = useCreateEventVoucherMutation();
  const [size, setSize] = useState(300);
  const [custom, setCustom] = useState('');
  const [price, setPrice] = useState('');
  const [note, setNote] = useState('');
  const [made, setMade] = useState(null);
  const [error, setError] = useState('');
  const participants = size === 'custom' ? Number(custom) : size;
  const priceLabel = size === 'custom' ? price || 'Custom' : SIZES.find((s) => s.participants === size).price;

  const submit = async () => {
    setError('');
    const r = await create({ id: clientId, participants, priceLabel, note: note || null });
    if (r.error) return setError(r.error.fields?.participants || r.error.message);
    setMade(r.data);
  };

  return (
    <Dialog
      eyebrow="Bigger event"
      title={made ? 'Voucher ready' : 'New event voucher'}
      onClose={onClose}
      footer={
        made ? (
          <div className="ml-auto flex gap-3">
            <AdminButton variant="outline" onClick={() => navigator.clipboard?.writeText(made.code).then(() => toast.success('Voucher copied'))}>
              Copy voucher
            </AdminButton>
            <AdminButton onClick={onClose}>Done</AdminButton>
          </div>
        ) : (
          <div className="ml-auto flex gap-3">
            <AdminButton variant="outline" onClick={onClose}>
              Cancel
            </AdminButton>
            <AdminButton busy={state.isLoading} disabled={!(participants > 50)} onClick={submit}>
              Create voucher
            </AdminButton>
          </div>
        )
      }
    >
      <div className="px-6 py-5 mobile:px-5">
        {made ? (
          <>
            <p className="text-sm text-muted">Give this to the client. They enter it when creating the event (or in its Participants settings).</p>
            <p className="my-5 rounded-btn bg-lavender-mist py-4 text-center font-mono text-3xl font-bold tracking-[0.3em] text-byte-purple">{made.code}</p>
            <p className="text-sm">
              Up to <strong>{made.participants}</strong> participants{made.priceLabel ? ` · ${made.priceLabel}` : ''}. Works once, for this client only.
            </p>
          </>
        ) : (
          <>
            <p className="mb-4 text-sm text-muted">Only after the client has paid.</p>
            <div className="mb-4 grid gap-2" role="radiogroup" aria-label="Event size">
              {[...SIZES.map((s) => [s.participants, s.label]), ['custom', 'More than 500 · custom pricing']].map(([v, l]) => (
                <label key={v} className={`flex cursor-pointer items-center gap-3 rounded-btn border-2 px-4 py-3 text-sm font-semibold ${size === v ? 'border-byte-purple bg-lavender-mist' : 'border-line'}`}>
                  <input type="radio" name="size" checked={size === v} onChange={() => setSize(v)} className="accent-[var(--color-byte-purple)]" />
                  {l}
                </label>
              ))}
            </div>
            {size === 'custom' && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Participants" id="v-custom">
                  <TextInput id="v-custom" type="number" min={501} value={custom} onChange={(e) => setCustom(e.target.value)} />
                </Field>
                <Field label="Price agreed" id="v-price">
                  <TextInput id="v-price" value={price} placeholder="e.g. $45" onChange={(e) => setPrice(e.target.value)} />
                </Field>
              </div>
            )}
            <Field label="Note (optional)" id="v-note" hint="E.g. the payment reference. Only admins see it." error={error}>
              <TextInput id="v-note" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
            </Field>
          </>
        )}
      </div>
    </Dialog>
  );
}
