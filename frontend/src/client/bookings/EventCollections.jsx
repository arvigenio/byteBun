import { BulkHeader, bulkBlocks } from './BulkGroups.jsx';
import { useState } from 'react';
import { toast } from 'sonner';
import { useEventCollectionsQuery, useManualRegisterMutation } from '../api.js';
import { fmtMoney, MoneyField } from '../components/Money.jsx';
import { Badge, Button, Checkbox, Dialog, Field, Icon, ICONS, Input, Loading } from '../ui.jsx';

// Paid events (backend: booking/events.ts):
//   Manual Register: the business registers someone itself, confirmed straight away (QR code by
//   email): paid to the business directly (the amount, default the price) or marked as free.
//   Collections: the running collections: every payment (approved proof, organizer code, manual,
//   free at 0) and refund (negative), oldest first, with totals and a running total.

/** Manual Register (any event; paid events: the amount paid, or free). */
export function ManualRegisterDialog({ e, taken = 0, onClose }) {
  const [register, state] = useManualRegisterMutation();
  const paid = e.kind === 'paid';
  // Places left: bulk registrations can't go past them (checked again when saving).
  const left = e.capacity == null ? null : Math.max(0, e.capacity - taken);
  const [f, setF] = useState({ firstName: '', lastName: '', email: '', phone: '', quantity: '1', free: false, amount: e.price != null ? String(e.price) : '' });
  const [errors, setErrors] = useState({});
  const set = (patch) => setF((x) => ({ ...x, ...patch }));
  const amountOk = !paid || f.free || Number(f.amount) > 0;
  const qty = Number(f.quantity);
  const qtyOk = Number.isInteger(qty) && qty >= 1 && qty <= 500 && (left === null || qty <= left);
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim());
  const phoneValid = /^\+?[\d\s().-]+$/.test(f.phone.trim()) && f.phone.replace(/\D/g, '').length >= 7;
  const [touched, setTouched] = useState({});
  const fullName = `${f.firstName.trim()} ${f.lastName.trim()}`.trim();
  const ok = !!f.firstName.trim() && !!f.lastName.trim() && emailValid && phoneValid && amountOk && qtyOk;
  const submit = async (ev) => {
    ev?.preventDefault();
    setErrors({});
    const r = await register({ id: e.id, name: fullName, email: f.email.trim(), phone: f.phone.trim(), quantity: qty, free: paid && f.free, amount: paid && !f.free ? Number(f.amount) : null, promoCode: null });
    if (r.error) {
      setErrors(r.error.fields ?? {});
      return toast.error(r.error.message);
    }
    toast.success(r.data.count > 1 ? `${r.data.count} spots registered for ${r.data.name}` : `${r.data.name} is registered`, { description: r.data.count > 1 ? `All ${r.data.count} QR codes were emailed to ${r.data.email}.` : `Their QR code was emailed to ${r.data.email}.` });
    onClose();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      busy={state.isLoading}
      title="Manual Register"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="manual-register" loading={state.isLoading} disabled={!ok}>
            {qty > 1 ? `Register ${qty} spots` : 'Register'}
          </Button>
        </>
      }
    >
      <form id="manual-register" onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <p className="text-sm text-muted">Register someone yourself{paid ? ', for example someone who paid you in cash, or a guest' : ''}. They’re confirmed straight away and get their QR code by email.</p>
        <div className="grid gap-3 desktop:grid-cols-2">
          <Field label="First name" error={errors.name}>
            {(a) => <Input {...a} autoFocus value={f.firstName} maxLength={60} autoComplete="off" onChange={(x) => set({ firstName: x.target.value })} />}
          </Field>
          <Field label="Last name">
            {(a) => <Input {...a} value={f.lastName} maxLength={60} autoComplete="off" onChange={(x) => set({ lastName: x.target.value })} />}
          </Field>
        </div>
        <div className="grid gap-3 desktop:grid-cols-2">
          <Field label="Email" hint="Their QR code is sent here." error={errors.email || (touched.email && f.email.trim() && !emailValid ? 'Please enter a valid email address.' : undefined)}>
            {(a) => <Input {...a} type="email" value={f.email} onBlur={() => setTouched((x) => ({ ...x, email: true }))} onChange={(x) => set({ email: x.target.value })} />}
          </Field>
          <Field label="Mobile number" error={errors.phone || (touched.phone && f.phone.trim() && !phoneValid ? 'Please enter a valid mobile number.' : undefined)}>
            {(a) => <Input {...a} type="tel" inputMode="tel" value={f.phone} maxLength={40} onBlur={() => setTouched((x) => ({ ...x, phone: true }))} onChange={(x) => set({ phone: x.target.value })} />}
          </Field>
        </div>
        <Field
          label="Number of spots"
          hint={left === null ? 'Bulk: one name and email, each spot gets its own code and QR code (all in one email).' : left === 0 ? 'The event is full.' : `${left} spot${left === 1 ? '' : 's'} left. Bulk: each spot gets its own code and QR code (all in one email).`}
          error={errors.quantity || (f.quantity && !qtyOk ? (left !== null && qty > left ? `At most ${left}.` : 'Between 1 and 500.') : undefined)}
        >
          {(a) => <Input {...a} type="number" inputMode="numeric" min="1" max={left ?? 500} step="1" value={f.quantity} className="max-w-32" onChange={(x) => set({ quantity: x.target.value })} />}
        </Field>
        {paid && (
          <div className="flex flex-col gap-3 rounded-card border border-line p-3">
            <Checkbox label="Mark as free" hint="A complimentary spot: no payment. Shown as Free in Collections." checked={f.free} onChange={(x) => set({ free: x.target.checked })} />
            {!f.free && (
              <Field label={qty > 1 ? 'Amount paid per spot' : 'Amount they paid you'} hint={[e.priceLabel ? `The price is ${e.priceLabel}.` : null, qty > 1 && Number(f.amount) > 0 ? `Total: ${fmtMoney(Number(f.amount) * qty, e.currency ?? 'PHP')}.` : null].filter(Boolean).join(' ') || undefined} error={errors.amount}>
                {(a) => <MoneyField id={a.id} amount={f.amount} currency={e.currency ?? 'PHP'} fixedCurrency onAmount={(v) => set({ amount: v })} invalid={!!errors.amount} />}
              </Field>
            )}
          </div>
        )}
      </form>
    </Dialog>
  );
}

const METHOD = {
  proof: ['brand', 'Proof of payment'],
  code: ['neutral', 'Organizer code'],
  manual: ['neutral', 'Manual'],
  free: ['ok', 'Free'],
  full: ['danger', 'Full refund'],
  partial: ['danger', 'Partial refund'],
};
const cx = (...c) => c.filter(Boolean).join(' ');
const when = (iso, tz) => new Intl.DateTimeFormat(undefined, { timeZone: tz, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));

/** The Collections tab. */
export function EventCollections({ e, tz }) {
  const q = useEventCollectionsQuery(e.id);
  const [query, setQuery] = useState('');
  if (q.isLoading) return <Loading />;
  if (q.error) return <p className="text-sm text-danger">{q.error.message}</p>;
  const { rows, totals, currency } = q.data;
  const s = query.trim().toLowerCase();
  const sCode = s.replace(/[^a-z0-9]/g, '');
  const shown = rows.filter((r) => !s || r.name.toLowerCase().includes(s) || r.email.toLowerCase().includes(s) || (sCode.length >= 2 && (r.code ?? '').replace('-', '').toLowerCase().includes(sCode)));
  const tile = (label, value, sub, tone = 'ink') => (
    <div className="bg-surface px-4 py-3">
      <p className="text-xs font-semibold tracking-wide text-muted uppercase">{label}</p>
      <p className={`mt-0.5 text-2xl font-bold tabular-nums ${tone === 'danger' ? 'text-danger' : tone === 'ok' ? 'text-ok' : 'text-ink'}`}>{value}</p>
      {sub && <p className="text-xs text-faint">{sub}</p>}
    </div>
  );
  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-px overflow-hidden rounded-card border border-line bg-line desktop:grid-cols-4 mobile:grid-cols-2">
        {tile('Collected', totals.labels.collected, `${totals.payments} payment${totals.payments === 1 ? '' : 's'}`)}
        {tile('Refunded', totals.refunded ? `−${totals.labels.refunded}` : totals.labels.refunded, `${totals.refunds} refund${totals.refunds === 1 ? '' : 's'}`, totals.refunded ? 'danger' : 'ink')}
        {tile('Net', totals.labels.net, `In ${currency}`, 'ok')}
        {tile('Discounts', totals.discounts ? `−${totals.labels.discounts}` : totals.labels.discounts, `${totals.promoUses} promo use${totals.promoUses === 1 ? '' : 's'} · free spots: ${totals.free}`)}
      </div>

      <section className="overflow-hidden rounded-card border border-line bg-surface">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div>
            <h2 className="font-semibold">Running collections</h2>
            <p className="text-xs text-muted">Every payment and refund, oldest first, with the running total.</p>
          </div>
          <div className="relative w-full desktop:w-72">
            <Icon d="M21 21l-4.3-4.3M17 10.5a6.5 6.5 0 11-13 0 6.5 6.5 0 0113 0z" className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-faint" />
            <Input type="search" value={query} onChange={(x) => setQuery(x.target.value)} placeholder="Search by name, email or code" className="pl-9" aria-label="Search collections" />
          </div>
        </header>
        {!rows.length ? (
          <p className="px-4 py-8 text-center text-sm text-faint">No payments yet. They appear here as payments are approved or people are registered manually.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-max text-sm">
              <thead>
                <tr className="border-b border-line bg-sunken/50 text-left text-xs font-semibold tracking-wide text-muted uppercase">
                  <th className="px-4 py-2.5">When</th>
                  <th className="px-4 py-2.5">Attendee</th>
                  <th className="px-4 py-2.5">Type</th>
                  <th className="px-4 py-2.5">Promo</th>
                  <th className="px-4 py-2.5 text-right">Amount</th>
                  <th className="px-4 py-2.5 text-right">Running total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {!shown.length && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-faint">
                      Nothing matches “{query.trim()}”.
                    </td>
                  </tr>
                )}
                {bulkBlocks(shown, { consecutive: true, keyOf: (x) => (x.groupId ? `${x.groupId}-${x.kind}` : null) }).flatMap((blk) => {
                const bulk = blk.groupId && blk.items.length > 1;
                const sum = blk.items.filter((x) => x.currency === currency).reduce((a, x) => a + x.amount, 0);
                const head = bulk ? (
                  <tr key={blk.key} className="bg-brand-soft/50">
                    <td colSpan={6} className="border-l-4 border-l-brand px-4 py-2">
                      <span className="flex flex-wrap items-center justify-between gap-2">
                        <BulkHeader name={blk.items[0].name} spots={blk.items.length} facts={[blk.items[0].kind === 'refund' ? 'refund' : 'payment', blk.items.filter((x) => x.promoCode).length ? `promo on ${blk.items.filter((x) => x.promoCode).length}` : null]} />
                        <span className={`font-bold tabular-nums ${sum < 0 ? 'text-danger' : 'text-ink'}`}>{sum < 0 ? `−${fmtMoney(-sum, currency)}` : fmtMoney(sum, currency)}</span>
                      </span>
                    </td>
                  </tr>
                ) : null;
                return [head, ...blk.items.map((r) => {
                  const [tone, label] = METHOD[r.method] ?? ['neutral', r.method];
                  const refund = r.kind === 'refund';
                  return (
                    <tr key={r.id} className={cx(refund ? 'bg-danger/5' : bulk ? 'bg-brand-soft/15' : undefined)}>
                      <td className={cx('px-4 py-2.5 whitespace-nowrap text-muted', bulk && 'border-l-4 border-l-brand pl-8')}>{when(r.at, tz)}</td>
                      <td className="px-4 py-2.5">
                        <p className="font-medium">{r.name}</p>
                        <p className="font-mono text-xs tracking-wider text-faint">{r.code}</p>
                      </td>
                      <td className="px-4 py-2.5">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <Badge tone={tone}>{label}</Badge>
                          {r.status === 'cancelled' && <Badge>Registration cancelled</Badge>}
                        </span>
                        {r.note && <p className="mt-0.5 max-w-xs truncate text-xs text-faint">{r.note}</p>}
                      </td>
                      <td className="px-4 py-2.5">
                        {r.promoCode ? (
                          <span className="flex flex-col">
                            <span className="font-mono text-xs font-bold tracking-wider">{r.promoCode}</span>
                            <span className="text-xs text-ok">−{r.discountLabel}</span>
                          </span>
                        ) : (
                          <span className="text-faint">·</span>
                        )}
                      </td>
                      <td className={`px-4 py-2.5 text-right font-semibold tabular-nums ${refund ? 'text-danger' : r.method === 'free' ? 'text-faint' : 'text-ink'}`}>
                        {refund ? `−${r.label}` : r.method === 'free' ? fmtMoney(0, r.currency) : r.label}
                        {r.currency !== currency && <span className="ml-1 text-xs font-normal text-faint">(not in total)</span>}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-muted">{r.running < 0 ? `−${r.runningLabel}` : r.runningLabel}</td>
                    </tr>
                  );
                })].filter(Boolean);
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

/** The button that opens Manual Register. */
export function ManualRegisterButton({ e, taken = 0 }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        <Icon d={ICONS.user} className="size-4" /> Manual Register
      </Button>
      {open && <ManualRegisterDialog e={e} taken={taken} onClose={() => setOpen(false)} />}
    </>
  );
}
