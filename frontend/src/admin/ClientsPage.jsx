import { useState } from 'react';
import { ClientEventsPanel } from './ClientEventsPanel.jsx';
import { clientExportUrl, useCatalogQuery, useClientActionMutation, useClientQuery, useClientsQuery, useEventsQuery } from './clientsApi.js';
import { PageTitle } from './AdminLayout.jsx';
import { Dialog } from './dialogs.jsx';
import { AdminButton, Badge, Field, formatDateTime, Notice, Panel, SelectInput, Spinner, TextInput } from './ui.jsx';

// Clients of the Byte Bun apps (Bookings, client portal): plans, deactivate / reactivate,
// delete (30-day grace) / restore, and the audit log. Backend: backend/src/clients/admin/.
const STATUS_TONE = { active: 'teal', deactivated: 'gold', deleted: 'danger' };
const EVENT_LABEL = {
  plan_started: 'Signed up',
  plan_changed: 'Plan changed',
  deactivated: 'Deactivated',
  reactivated: 'Reactivated',
  deleted: 'Deleted',
  restored: 'Restored',
  purged: 'Permanently removed',
  retention_deleted: 'Old bookings deleted (free plan)',
};

export function ClientsPage() {
  const [tab, setTab] = useState('clients');
  const [selected, setSelected] = useState(null);
  if (selected) return <ClientDetail id={selected} onBack={() => setSelected(null)} />;
  return (
    <>
      <PageTitle title="Clients">Businesses using Byte Bun Bookings and the client portal.</PageTitle>
      <div className="mb-5 flex gap-2" role="tablist">
        {[
          ['clients', 'All clients'],
          ['audit', 'Audit log'],
        ].map(([k, label]) => (
          <AdminButton key={k} variant={tab === k ? 'primary' : 'outline'} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
            {label}
          </AdminButton>
        ))}
      </div>
      {tab === 'clients' ? <ClientList onOpen={setSelected} /> : <AuditLog />}
    </>
  );
}

function ClientList({ onOpen }) {
  const [filter, setFilter] = useState({ q: '', status: '', plan: '' });
  const catalog = useCatalogQuery();
  const q = useClientsQuery(filter);
  return (
    <Panel>
      <div className="mb-4 grid gap-3 desktop:grid-cols-[1fr_180px_200px]">
        <TextInput placeholder="Search name, link or owner email" value={filter.q} onChange={(e) => setFilter({ ...filter, q: e.target.value })} aria-label="Search" />
        <SelectInput value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })} aria-label="Status">
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="deactivated">Deactivated</option>
          <option value="deleted">Deleted</option>
        </SelectInput>
        <SelectInput value={filter.plan} onChange={(e) => setFilter({ ...filter, plan: e.target.value })} aria-label="Plan">
          <option value="">All plans</option>
          {catalog.data?.plans.map((p) => (
            <option key={p.code} value={p.code}>
              {p.name}
            </option>
          ))}
        </SelectInput>
      </div>
      {q.isLoading ? (
        <Spinner />
      ) : q.error ? (
        <Notice tone="danger">{q.error.message}</Notice>
      ) : !q.data.length ? (
        <p className="text-muted">No clients match.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="text-xs tracking-wider text-soft-violet uppercase">
              <tr className="border-b border-line">
                <th className="py-2 pr-3">Business</th>
                <th className="py-2 pr-3">Owner</th>
                <th className="py-2 pr-3">Plan</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2">Since</th>
              </tr>
            </thead>
            <tbody>
              {q.data.map((c) => (
                <tr key={c.id} className="cursor-pointer border-b border-line hover:bg-lavender-mist" onClick={() => onOpen(c.id)}>
                  <td className="py-3 pr-3">
                    <div className="font-semibold text-midnight-plum">{c.name}</div>
                    <div className="text-xs text-muted">/{c.slug}</div>
                  </td>
                  <td className="py-3 pr-3">{c.owners[0]?.email ?? '—'}</td>
                  <td className="py-3 pr-3">
                    {c.plan?.name ?? '—'}
                    {c.addons.length > 0 && <span className="text-xs text-muted"> +{c.addons.length} add-on{c.addons.length === 1 ? '' : 's'}</span>}
                  </td>
                  <td className="py-3 pr-3">
                    <Badge tone={STATUS_TONE[c.status]}>{c.status}</Badge>
                  </td>
                  <td className="py-3">{formatDateTime(c.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

function EventList({ events, showBusiness = false }) {
  if (!events?.length) return <p className="text-sm text-muted">Nothing recorded yet.</p>;
  return (
    <ul className="divide-y divide-line">
      {events.map((e) => (
        <li key={e.id} className="py-3 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-midnight-plum">{EVENT_LABEL[e.type] ?? e.type}</span>
            {showBusiness && <span className="text-muted">· {e.organizationName ?? 'removed business'}</span>}
            {e.type === 'plan_changed' && (
              <span className="text-muted">
                {e.data.from ?? '—'} → {e.data.to}
                {e.data.addonsTo?.length ? ` (+ ${e.data.addonsTo.join(', ')})` : ''}
              </span>
            )}
          </div>
          <div className="text-muted">
            {formatDateTime(e.createdAt)} · by {e.actor}
            {e.reason && <> · “{e.reason}”</>}
          </div>
        </li>
      ))}
    </ul>
  );
}

function AuditLog() {
  const q = useEventsQuery({ limit: 300 });
  return <Panel>{q.isLoading ? <Spinner /> : q.error ? <Notice tone="danger">{q.error.message}</Notice> : <EventList events={q.data} showBusiness />}</Panel>;
}

function ClientDetail({ id, onBack }) {
  const q = useClientQuery(id);
  const catalog = useCatalogQuery();
  const [dialog, setDialog] = useState(null);
  if (q.isLoading || !catalog.data) return <Spinner />;
  if (q.error) {
    return (
      <>
        <AdminButton variant="link" onClick={onBack}>
          ← All clients
        </AdminButton>
        <Notice tone="danger">{q.error.message}</Notice>
      </>
    );
  }
  const c = q.data;
  const sub = c.subscription;
  return (
    <>
      <AdminButton variant="link" onClick={onBack}>
        ← All clients
      </AdminButton>
      <PageTitle title={c.name}>
        <Badge tone={STATUS_TONE[c.status]}>{c.status}</Badge> · client since {formatDateTime(c.createdAt)}
        {c.booking && (
          <>
            {' · '}
            <a className="text-soft-violet underline" href={c.booking.publicUrl} target="_blank" rel="noreferrer">
              booking page
            </a>
          </>
        )}
      </PageTitle>
      {c.status !== 'active' && (
        <Notice tone={c.status === 'deleted' ? 'danger' : 'info'}>
          {c.status === 'deleted' ? `Deleted. Data is removed permanently on ${formatDateTime(c.deleteAfter)} unless restored.` : 'Deactivated: signed out, booking page unavailable, reminders paused. All data kept.'}
          {c.statusReason && ` Reason: ${c.statusReason}`}
        </Notice>
      )}
      <div className="mb-6 flex flex-wrap gap-3">
        {c.status !== 'deleted' && <AdminButton onClick={() => setDialog('plan')}>Change plan</AdminButton>}
        {c.status === 'active' && (
          <AdminButton variant="outline" onClick={() => setDialog('deactivate')}>
            Deactivate
          </AdminButton>
        )}
        {c.status === 'deactivated' && (
          <AdminButton variant="accent" onClick={() => setDialog('reactivate')}>
            Reactivate
          </AdminButton>
        )}
        {c.status === 'deleted' && (
          <AdminButton variant="accent" onClick={() => setDialog('restore')}>
            Restore
          </AdminButton>
        )}
        <a href={clientExportUrl(id)} className="inline-flex min-h-11 items-center rounded-btn border-2 border-line bg-cream-dough px-5 text-[15px] font-semibold text-byte-purple hover:bg-lavender-mist">
          Export bookings (CSV)
        </a>
        {c.status !== 'deleted' && catalog.data.canDelete && (
          <AdminButton variant="danger" onClick={() => setDialog('delete')}>
            Delete
          </AdminButton>
        )}
      </div>

      <div className="grid gap-6 desktop:grid-cols-2">
        <Panel>
          <h2 className="mb-3 text-lg font-bold text-midnight-plum">Plan</h2>
          {sub ? (
            <dl className="grid grid-cols-[120px_1fr] gap-y-1.5 text-sm">
              <dt className="text-muted">Plan</dt>
              <dd className="font-semibold">{sub.planName}</dd>
              <dt className="text-muted">Billing</dt>
              <dd>
                {sub.status} · {sub.currency}
              </dd>
              <dt className="text-muted">Add-ons</dt>
              <dd>{sub.addons.length ? sub.addons.map((a) => a.name).join(', ') : 'None'}</dd>
            </dl>
          ) : (
            <p className="text-muted">No subscription.</p>
          )}
          <h3 className="mt-5 mb-2 text-sm font-bold text-midnight-plum">Active features</h3>
          <div className="flex flex-wrap gap-1.5">
            {c.entitlements.map((e) => (
              <Badge key={e.key}>{e.value !== null ? `${e.key.replace(/^limit:/, '')}: ${e.value}` : e.key.replace(/^(app|feature):/, '')}</Badge>
            ))}
          </div>
        </Panel>
        <Panel>
          <h2 className="mb-3 text-lg font-bold text-midnight-plum">Activity</h2>
          <dl className="grid grid-cols-[170px_1fr] gap-y-1.5 text-sm">
            <dt className="text-muted">Bookings (30 days)</dt>
            <dd>{c.stats.bookingsLast30Days}</dd>
            <dt className="text-muted">Upcoming</dt>
            <dd>{c.stats.upcoming}</dd>
            <dt className="text-muted">Active services</dt>
            <dd>{c.stats.activeServices}</dd>
            {c.booking && (
              <>
                <dt className="text-muted">Time zone</dt>
                <dd>{c.booking.timeZone}</dd>
                <dt className="text-muted">Phone</dt>
                <dd>{c.booking.phone ?? '—'}</dd>
              </>
            )}
          </dl>
          <h3 className="mt-5 mb-2 text-sm font-bold text-midnight-plum">Team</h3>
          <ul className="text-sm">
            {c.members.map((m) => (
              <li key={m.email} className="py-0.5">
                {m.name || m.email} <span className="text-muted">· {m.email} · {m.role}</span>
              </li>
            ))}
          </ul>
        </Panel>
        {c.status !== 'deleted' && <ClientEventsPanel clientId={id} />}
        <Panel className="desktop:col-span-2">
          <h2 className="mb-1 text-lg font-bold text-midnight-plum">Audit log</h2>
          <EventList events={c.events} />
        </Panel>
      </div>

      {dialog && <ActionDialog kind={dialog} client={c} catalog={catalog.data} onClose={() => setDialog(null)} />}
    </>
  );
}

const TITLES = { plan: 'Change plan', deactivate: 'Deactivate client', reactivate: 'Reactivate client', delete: 'Delete client', restore: 'Restore client' };

function ActionDialog({ kind, client, catalog, onClose }) {
  const [run, state] = useClientActionMutation();
  const [form, setForm] = useState({
    planCode: client.subscription?.planCode ?? 'free',
    addons: client.subscription?.addons.map((a) => a.code) ?? [],
    reason: '',
    notifyOwner: true,
    notifyCustomers: false,
    confirmName: '',
  });
  const [errors, setErrors] = useState({});
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const reasonRequired = kind === 'deactivate' || kind === 'delete';

  const submit = async () => {
    const body = {
      plan: { planCode: form.planCode, addons: form.addons, reason: form.reason || null },
      deactivate: { reason: form.reason, notifyOwner: form.notifyOwner },
      reactivate: { reason: form.reason || null, notifyOwner: form.notifyOwner },
      delete: { confirmName: form.confirmName, reason: form.reason, notifyCustomers: form.notifyCustomers, notifyOwner: form.notifyOwner },
      restore: { reason: form.reason || null },
    }[kind];
    const r = await run({ id: client.id, action: kind, ...body });
    if (r.error) return setErrors({ ...r.error.fields, form: r.error.message });
    onClose();
  };

  const plans = catalog.plans.filter((p) => p.active || p.code === client.subscription?.planCode);
  return (
    <Dialog
      eyebrow={client.name}
      title={TITLES[kind]}
      stripe={kind === 'delete' ? 'bg-danger' : 'bg-honey-gold'}
      onClose={onClose}
      footer={
        <>
          <AdminButton variant={kind === 'delete' ? 'dangerSolid' : 'primary'} busy={state.isLoading} onClick={submit} disabled={reasonRequired && form.reason.trim().length < 3}>
            {TITLES[kind]}
          </AdminButton>
          <AdminButton variant="outline" onClick={onClose}>
            Cancel
          </AdminButton>
        </>
      }
    >
      <div className="px-6 py-5 mobile:px-5">
        {errors.form && <Notice tone="danger">{errors.form}</Notice>}
        {kind === 'plan' && (
          <>
            <Field label="Plan" id="plan" error={errors.planCode}>
              <SelectInput id="plan" value={form.planCode} onChange={(e) => set('planCode', e.target.value)}>
                {plans.map((p) => (
                  <option key={p.code} value={p.code}>
                    {p.name}
                    {!p.active ? ' (retired)' : ''}
                  </option>
                ))}
              </SelectInput>
            </Field>
            <Field label="Add-ons" id="addons" error={errors.addons}>
              <div className="grid gap-1.5 desktop:grid-cols-2">
                {catalog.addons
                  .filter((a) => a.active)
                  .map((a) => (
                    <label key={a.code} className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={form.addons.includes(a.code)} onChange={(e) => set('addons', e.target.checked ? [...form.addons, a.code] : form.addons.filter((x) => x !== a.code))} />
                      {a.name}
                    </label>
                  ))}
              </div>
            </Field>
            <p className="mb-4 text-[13px] text-muted">Features change right away. Moving down to Free brings back the 60-bookings-a-month limit and deletion of bookings 60 days after the appointment.</p>
          </>
        )}
        {kind === 'deactivate' && <Notice tone="info">The client and their staff are signed out and blocked, the booking page shows “Online booking is currently unavailable”, reminders and billing pause. All data is kept, and Reactivate restores everything.</Notice>}
        {kind === 'delete' && (
          <>
            <Notice tone="danger">
              The client is blocked right away and everything is permanently removed after 30 days (until then it can be restored). The subscription is cancelled.{' '}
              <a className="underline" href={clientExportUrl(client.id)}>
                Export their bookings (CSV)
              </a>{' '}
              first if needed.
            </Notice>
            <Field label={`Type “${client.name}” to confirm`} id="confirmName" error={errors.confirmName}>
              <TextInput id="confirmName" value={form.confirmName} onChange={(e) => set('confirmName', e.target.value)} autoComplete="off" />
            </Field>
            <label className="mb-3 flex items-center gap-2 text-sm">
              <input type="checkbox" checked={form.notifyCustomers} onChange={(e) => set('notifyCustomers', e.target.checked)} />
              Cancel upcoming bookings and email those customers
            </label>
          </>
        )}
        {kind !== 'plan' && kind !== 'restore' && (
          <label className="mb-4 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.notifyOwner} onChange={(e) => set('notifyOwner', e.target.checked)} />
            Email the business owner(s) an account notice
          </label>
        )}
        <Field label={reasonRequired ? 'Reason (required, kept in the audit log)' : 'Reason (optional, kept in the audit log)'} id="reason" error={errors.reason}>
          <TextInput id="reason" value={form.reason} maxLength={500} onChange={(e) => set('reason', e.target.value)} />
        </Field>
      </div>
    </Dialog>
  );
}
