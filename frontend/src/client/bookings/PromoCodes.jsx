import { useState } from 'react';
import { toast } from 'sonner';
import { useAddPromoCodeMutation, useDeletePromoCodeMutation, usePromoCodesQuery, useUpdatePromoCodeMutation } from '../api.js';
import { MoneyField } from '../components/Money.jsx';
import { DatePicker } from '../components/Pickers.jsx';
import { addDays, fmtLongDate, todayIn } from '../lib/format.js';
import { Badge, Button, Card, Checkbox, Dialog, Field, IconButton, ICONS, Input, useConfirm } from '../ui.jsx';

// Paid events' promo codes (Details tab; backend: booking/event-promos.ts): an amount or a
// percentage off per place, one-time / limited / unlimited uses, an optional last day.

const STATUS = { active: ['ok', 'Active'], off: ['neutral', 'Off'], expired: ['neutral', 'Expired'], used_up: ['warn', 'Used up'] };

export function PromoCodesCard({ e, canEdit }) {
  const q = usePromoCodesQuery(e.id);
  const [del] = useDeletePromoCodeMutation();
  const confirm = useConfirm();
  const [editing, setEditing] = useState(null); // null | 'new' | promo
  const promos = q.data?.promoCodes ?? [];
  return (
    <Card
      title="Promo codes"
      description="Discounts attendees can enter when they register: an amount or a percentage off each spot. In bulk registrations a code applies spot by spot until its uses run out."
      actions={
        canEdit && (
          <Button size="sm" variant="secondary" onClick={() => setEditing('new')}>
            Add promo code
          </Button>
        )
      }
    >
      {!promos.length ? (
        <p className="rounded-card border border-dashed border-line-strong px-4 py-6 text-center text-sm text-muted">No promo codes yet.</p>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-card border border-line">
          {promos.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
              <span className="rounded-md bg-sunken px-2 py-1 font-mono text-sm font-bold tracking-wider">{p.code}</span>
              <span className="text-sm font-semibold">{p.label}</span>
              <Badge tone={STATUS[p.status][0]}>{STATUS[p.status][1]}</Badge>
              <span className="min-w-0 flex-1 text-xs text-muted">
                {p.usageLimit === null ? `Used ${p.used} times · unlimited` : p.usageLimit === 1 ? `One-time · ${p.used ? 'used' : 'not used yet'}` : `Used ${p.used} of ${p.usageLimit}`}
                {p.expiresOn ? ` · until ${fmtLongDate(p.expiresOn)}` : ' · no expiry'}
              </span>
              {canEdit && (
                <span className="flex gap-0.5">
                  <IconButton icon={ICONS.pencil} label={`Edit ${p.code}`} onClick={() => setEditing(p)} />
                  <IconButton
                    icon={ICONS.trash}
                    tone="danger"
                    label={`Delete ${p.code}`}
                    onClick={async () => {
                      if (!(await confirm({ title: `Delete ${p.code}?`, body: 'It stops working. Spots that already used it keep their discount.', action: 'Delete' }))) return;
                      const r = await del({ id: e.id, promoId: p.id });
                      if (r.error) toast.error(r.error.message);
                      else toast.success('Promo code deleted');
                    }}
                  />
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {editing && <PromoDialog e={e} promo={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </Card>
  );
}

function PromoDialog({ e, promo, onClose }) {
  const [add, addState] = useAddPromoCodeMutation();
  const [update, updateState] = useUpdatePromoCodeMutation();
  const [f, setF] = useState(() => ({
    code: promo?.code ?? '',
    discountType: promo?.discountType ?? 'amount',
    discountValue: promo ? String(promo.discountValue) : '',
    usage: promo ? (promo.usageLimit === null ? 'unlimited' : promo.usageLimit === 1 ? 'once' : 'limited') : 'limited',
    usageLimit: promo?.usageLimit && promo.usageLimit > 1 ? String(promo.usageLimit) : '10',
    expires: !!promo?.expiresOn,
    expiresOn: promo?.expiresOn ?? '',
    active: promo?.active ?? true,
  }));
  const [errors, setErrors] = useState({});
  const set = (patch) => setF((x) => ({ ...x, ...patch }));
  const busy = addState.isLoading || updateState.isLoading;
  // The last day can be at most the day before the event (and not before today).
  const lastAllowed = addDays(e.date, -1);
  const today = todayIn(e.timeZone);
  const expiryOk = !f.expires || (!!f.expiresOn && f.expiresOn <= lastAllowed);
  const value = Number(f.discountValue);
  const limit = f.usage === 'unlimited' ? null : f.usage === 'once' ? 1 : Number(f.usageLimit);
  const ok = /^[A-Za-z0-9_\- ]{3,30}$/.test(f.code.trim()) && value > 0 && (f.discountType !== 'percent' || value <= 100) && (limit === null || (Number.isInteger(limit) && limit >= 1)) && expiryOk;
  const save = async (ev) => {
    ev?.preventDefault();
    setErrors({});
    const body = { code: f.code, discountType: f.discountType, discountValue: value, usageLimit: limit, expiresOn: f.expires ? f.expiresOn : null, active: f.active };
    const r = promo ? await update({ id: e.id, promoId: promo.id, ...body }) : await add({ id: e.id, ...body });
    if (r.error) {
      setErrors(r.error.fields ?? {});
      return toast.error(r.error.message);
    }
    toast.success(promo ? 'Promo code saved' : `${r.data.code} added`);
    onClose();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      busy={busy}
      title={promo ? `Edit ${promo.code}` : 'Add a promo code'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="promo-form" loading={busy} disabled={!ok}>
            {promo ? 'Save' : 'Add'}
          </Button>
        </>
      }
    >
      <form id="promo-form" onSubmit={save} className="flex flex-col gap-4" noValidate>
        <Field label="Code" hint="What attendees type, e.g. EARLYBIRD. Letters, numbers, dashes." error={errors.code}>
          {(a) => <Input {...a} autoFocus value={f.code} maxLength={30} className="max-w-64 font-mono uppercase" onChange={(x) => set({ code: x.target.value.toUpperCase() })} />}
        </Field>
        <div>
          <p className="mb-1.5 text-sm font-medium">Discount per spot</p>
          <div className="mb-2 flex max-w-xs gap-1 rounded-btn bg-sunken p-1" role="tablist" aria-label="Discount type">
            {[
              ['amount', 'Amount'],
              ['percent', 'Percentage'],
            ].map(([k, l]) => (
              <button key={k} type="button" role="tab" aria-selected={f.discountType === k} onClick={() => set({ discountType: k })} className={`flex-1 cursor-pointer rounded-md px-3 py-1.5 text-sm font-medium ${f.discountType === k ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'}`}>
                {l}
              </button>
            ))}
          </div>
          {f.discountType === 'amount' ? (
            <MoneyField amount={f.discountValue} currency={e.currency ?? 'PHP'} fixedCurrency onAmount={(v) => set({ discountValue: v })} invalid={!!errors.discountValue} />
          ) : (
            <div className="relative w-32">
              <Input type="number" inputMode="decimal" min="1" max="100" step="1" value={f.discountValue} onChange={(x) => set({ discountValue: x.target.value })} className="pr-8 tabular-nums" aria-label="Percentage off" />
              <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-sm font-semibold text-muted">%</span>
            </div>
          )}
          {errors.discountValue && <p className="mt-1 text-[13px] text-danger">{errors.discountValue}</p>}
          {e.price != null && value > 0 && (
            <p className="mt-1 text-xs text-muted">
              Price {e.priceLabel} → {new Intl.NumberFormat('en', { style: 'currency', currency: e.currency ?? 'PHP', maximumFractionDigits: 2 }).format(Math.max(0, f.discountType === 'percent' ? e.price * (1 - Math.min(100, value) / 100) : e.price - value))} per place
            </p>
          )}
        </div>
        <div>
          <p className="mb-1.5 text-sm font-medium">Uses</p>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Uses">
            {[
              ['once', 'One-time'],
              ['limited', 'Limited'],
              ['unlimited', 'Unlimited'],
            ].map(([k, l]) => (
              <button key={k} type="button" role="radio" aria-checked={f.usage === k} onClick={() => set({ usage: k })} className={`cursor-pointer rounded-btn border-2 px-3 py-1.5 text-sm font-medium ${f.usage === k ? 'border-brand bg-brand-soft text-ink' : 'border-line text-muted hover:border-line-strong'}`}>
                {l}
              </button>
            ))}
          </div>
          {f.usage === 'limited' && (
            <div className="mt-2 flex items-center gap-2 text-sm">
              <Input type="number" inputMode="numeric" min={Math.max(1, promo?.used ?? 1)} step="1" value={f.usageLimit} onChange={(x) => set({ usageLimit: x.target.value })} className="w-24 tabular-nums" aria-label="Usage limit" />
              <span className="text-muted">spots can use it{promo?.used ? ` (used ${promo.used} so far)` : ''}</span>
            </div>
          )}
          {errors.usageLimit && <p className="mt-1 text-[13px] text-danger">{errors.usageLimit}</p>}
        </div>
        <div className="flex flex-col gap-2">
          <Checkbox label="Expires" hint={`It works until the end of the date you choose: at the latest ${fmtLongDate(lastAllowed)}, the day before the event.`} checked={f.expires} onChange={(x) => set({ expires: x.target.checked })} />
          {f.expires && (
            <Field label="Last day" hint="Up to the day before the event." error={errors.expiresOn || (f.expiresOn && f.expiresOn > lastAllowed ? `At the latest ${fmtLongDate(lastAllowed)}.` : undefined)}>
              {(a) => <DatePicker {...a} value={f.expiresOn} min={today <= lastAllowed ? today : undefined} max={lastAllowed} onChange={(d) => set({ expiresOn: d })} className="max-w-56" />}
            </Field>
          )}
        </div>
        {promo && <Checkbox label="Active" hint="Untick to switch it off without deleting it." checked={f.active} onChange={(x) => set({ active: x.target.checked })} />}
      </form>
    </Dialog>
  );
}
