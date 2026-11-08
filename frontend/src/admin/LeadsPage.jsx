import { useDispatch } from 'react-redux';
import { leadsExportUrl } from '../api/admin.js';
import { useAdminForm } from '../hooks/admin/useAdminForm.js';
import { useLeads } from '../hooks/admin/useAdminPages.js';
import { LEAD_STATUSES, leadFilterSchema } from '../lib/adminSchemas.js';
import { statusTone } from './LeadDrawer.jsx';
import { fetchLead, queryChanged } from '../store/adminDataSlices.js';
import { PageTitle } from './AdminLayout.jsx';
import { AdminButton, Badge, formatDateTime, Notice, Panel, SelectInput, Spinner, TextInput } from './ui.jsx';

export function LeadsPage() {
  const dispatch = useDispatch();
  const { items, total, pageSize, status, error, query } = useLeads();
  const { register, handleSubmit } = useAdminForm(leadFilterSchema, { q: query.q, status: query.status });
  const onFilter = handleSubmit((v) => dispatch(queryChanged({ q: v.q ?? '', status: v.status ?? '', page: 1 })));
  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <>
      <PageTitle
        title="Leads"
        actions={
          <a
            href={leadsExportUrl(query)}
            download
            className="inline-flex min-h-11 items-center rounded-btn border-2 border-line bg-cream-dough px-5 text-[15px] font-semibold text-byte-purple hover:bg-lavender-mist"
          >
            Export CSV
          </a>
        }
      >
        Everyone who filled in the lead form, newest first.
      </PageTitle>

      <form onSubmit={onFilter} className="mb-5 flex flex-wrap gap-3" role="search">
        <TextInput placeholder="Search name, email, business, phone" className="max-w-sm flex-1" aria-label="Search leads" {...register('q')} />
        <SelectInput className="w-44" aria-label="Status" {...register('status')}>
          <option value="">All statuses</option>
          {LEAD_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </SelectInput>
        <AdminButton type="submit">Filter</AdminButton>
      </form>

      {error && <Notice tone="danger">{error}</Notice>}
      <Panel className="overflow-x-auto p-0 mobile:p-0">
        {status === 'loading' && !items.length ? (
          <div className="px-6">
            <Spinner />
          </div>
        ) : items.length === 0 ? (
          <p className="px-6 py-10 text-center text-muted">No leads match.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-line text-xs tracking-wider text-soft-violet uppercase">
              <tr>
                <th className="px-5 py-3">Received</th>
                <th className="px-5 py-3">Name</th>
                <th className="px-5 py-3">Business</th>
                <th className="px-5 py-3">Call</th>
                <th className="px-5 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {items.map((l) => (
                <tr key={l.id} onClick={() => dispatch(fetchLead(l.id))} className="cursor-pointer border-b border-line/70 last:border-0 hover:bg-lavender-mist/50">
                  <td className="px-5 py-3 whitespace-nowrap text-muted">{formatDateTime(l.createdAt)}</td>
                  <td className="px-5 py-3">
                    <div className="font-semibold text-midnight-plum">
                      {l.firstName} {l.lastName}
                    </div>
                    <div className="text-muted">{l.email}</div>
                  </td>
                  <td className="px-5 py-3 text-midnight-plum">
                    {l.businessName || '—'}
                    <div className="text-muted">{l.businessType}</div>
                  </td>
                  <td className="px-5 py-3 whitespace-nowrap text-midnight-plum">{l.booking ? formatDateTime(l.booking.startsAt) : '—'}</td>
                  <td className="px-5 py-3">
                    <Badge tone={statusTone[l.status]}>{l.status}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <div className="mt-4 flex items-center justify-between text-sm text-muted">
        <span>
          {total} lead{total === 1 ? '' : 's'}
        </span>
        <div className="flex items-center gap-2">
          <AdminButton variant="outline" disabled={query.page <= 1} onClick={() => dispatch(queryChanged({ page: query.page - 1 }))}>
            Previous
          </AdminButton>
          <span>
            Page {query.page} of {pages}
          </span>
          <AdminButton variant="outline" disabled={query.page >= pages} onClick={() => dispatch(queryChanged({ page: query.page + 1 }))}>
            Next
          </AdminButton>
        </div>
      </div>
    </>
  );
}

