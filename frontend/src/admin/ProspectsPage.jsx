import { lazy, Suspense, useEffect, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useAdminForm } from '../hooks/admin/useAdminForm.js';
import { downloadProspectsCsv, useProspects } from '../hooks/admin/useProspects.js';
import { prospectSearchSchema } from '../lib/adminSchemas.js';
import { onRouteLinkClick, usePathname } from '../lib/router.js';
import { noWebsiteOnlyToggled, prospectSelected, recheckWebsite, searchProspects, sortChanged, tierToggled } from '../store/adminProspectsSlice.js';
import { PageTitle } from './AdminLayout.jsx';
import { AdminButton, Field, Notice, Panel, SelectInput, Spinner, TextInput } from './ui.jsx';
import { Chance, EmailCell, ExternalLink, prospectMailto, SocialCell, TIERS, WebsiteCell } from './prospectCells.jsx';
import { BulkSave, SaveCell, SavedTab, useLoadProspectGroups } from './SavedProspects.jsx';

// Leaflet is only downloaded when this page opens.
const ProspectMap = lazy(() => import('./ProspectMap.jsx'));

const INDUSTRIES = ['Dentist', 'Dental clinic', 'Veterinary clinic', 'Medical clinic', 'Dermatologist', 'Hair salon', 'Barbershop', 'Beauty salon', 'Nail salon', 'Spa', 'Gym', 'Physiotherapy', 'Chiropractor', 'Optometrist', 'Restaurant', 'Cafe', 'Bakery', 'Law firm', 'Accountant', 'Real estate agency', 'Car repair', 'Plumber', 'Electrician', 'Tutoring center', 'Daycare'];

function Details({ p, searchId }) {
  const dispatch = useDispatch();
  const rechecking = useSelector((st) => st.adminProspects.rechecking);
  const c = p.checkup;
  return (
    <div className="grid gap-5 bg-lavender-mist/40 px-5 py-4 text-sm desktop:grid-cols-3">
      <div>
        <h3 className="mb-2 text-xs font-bold tracking-wider text-soft-violet uppercase">Why this rank</h3>
        <ul className="space-y-1">
          {p.reasons.map((r) => (
            <li key={r.key} className="flex justify-between gap-3">
              <span className="text-midnight-plum">{r.label}</span>
              <span className={`font-semibold ${r.points < 0 ? 'text-danger' : 'text-circuit-teal'}`}>
                {r.points > 0 ? '+' : ''}
                {r.points}
              </span>
            </li>
          ))}
          {!p.reasons.length && <li className="text-muted">Not much to go on for this business.</li>}
        </ul>
      </div>
      <div>
        <h3 className="mb-2 text-xs font-bold tracking-wider text-soft-violet uppercase">What to pitch</h3>
        {p.pitch.length ? (
          <ul className="list-disc space-y-1 pl-5 text-midnight-plum">
            {p.pitch.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        ) : (
          <p className="text-muted">Nothing obvious: they look well set up.</p>
        )}
      </div>
      <div>
        <h3 className="mb-2 text-xs font-bold tracking-wider text-soft-violet uppercase">Contact</h3>
        <div className="space-y-1 text-midnight-plum">
          {p.address && <div>{p.address}</div>}
          {p.email && (
            <div>
              <a href={prospectMailto(p)} className="font-semibold text-soft-violet hover:underline">
                {p.email}
              </a>
            </div>
          )}
          {p.phone && (
            <div>
              <a href={`tel:${p.phone.replace(/[^\d+]/g, '')}`} className="font-semibold text-soft-violet hover:underline">
                {p.phone}
              </a>
            </div>
          )}
          {p.mapsUrl && <ExternalLink href={p.mapsUrl}>Open on the map</ExternalLink>}
          {c && (
            <p className="pt-2 text-xs text-muted">
              Website checkup: {c.reachable ? `${c.responseMs ? `${(c.responseMs / 1000).toFixed(1)} s` : ''}${c.onlineBooking ? ', has online booking' : ', no online booking'}${c.chat ? ', has chat' : ''}${c.copyrightYear ? `, © ${c.copyrightYear}` : ''}` : c.error}
            </p>
          )}
          {p.website && (
            <AdminButton variant="link" className="text-sm" busy={rechecking === p.id} onClick={() => dispatch(recheckWebsite({ searchId, itemId: p.id }))}>
              Check the website again
            </AdminButton>
          )}
        </div>
      </div>
    </div>
  );
}

const TABS = [
  { href: '/admin/prospects', label: 'Search' },
  { href: '/admin/prospects/saved', label: 'Saved' },
];

// Prospecting: the Search tab (find and rank businesses) and the Saved tab (groups).
export function ProspectsPage() {
  const savedTab = usePathname().replace(/\/+$/, '').startsWith('/admin/prospects/saved');
  const total = useSelector((s) => s.adminSavedProspects.total);
  useLoadProspectGroups();
  return (
    <>
      <PageTitle title="Prospecting">Find local businesses by industry and location, ranked by how likely they are to sign up, and keep the best ones in groups.</PageTitle>
      <nav className="mb-5 flex gap-1 border-b border-line" aria-label="Prospecting">
        {TABS.map((t) => {
          const active = (t.href === '/admin/prospects/saved') === savedTab;
          return (
            <a
              key={t.href}
              href={t.href}
              onClick={onRouteLinkClick}
              aria-current={active ? 'page' : undefined}
              className={`-mb-px border-b-2 px-4 py-2.5 text-sm font-semibold ${active ? 'border-byte-purple text-byte-purple' : 'border-transparent text-muted hover:text-midnight-plum'}`}
            >
              {t.label}
              {t.label === 'Saved' && total > 0 && <span className="ml-1.5 rounded-full bg-lavender-mist px-2 py-0.5 text-xs text-byte-purple">{total}</span>}
            </a>
          );
        })}
      </nav>
      {savedTab ? <SavedTab /> : <SearchTab />}
    </>
  );
}

function SearchTab() {
  const dispatch = useDispatch();
  const { meta, query, search, visible, items, status, error, fieldErrors, reused, sort, tiers, noWebsiteOnly, selectedId } = useProspects();
  const { register, handleSubmit, setError, formState } = useAdminForm(prospectSearchSchema, query);
  const rowRefs = useRef(new Map());

  useEffect(() => {
    for (const [name, message] of Object.entries(fieldErrors)) setError(name, { type: 'server', message });
  }, [fieldErrors, setError]);

  // A pin clicked on the map: bring its row into view.
  useEffect(() => {
    if (selectedId) rowRefs.current.get(selectedId)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selectedId]);

  const loading = status === 'loading';
  const onSearch = (refresh) => handleSubmit((v) => dispatch(searchProspects({ industry: v.industry, location: v.location, refresh })));
  const select = (id) => dispatch(prospectSelected(id === selectedId ? null : id));
  const errors = formState.errors;

  return (
    <>
      <Panel className="mb-5">
        <form onSubmit={onSearch(false)} className="grid items-start gap-x-4 desktop:grid-cols-[1fr_1fr_auto]" role="search" noValidate>
          <Field label="Industry" id="industry" error={errors.industry?.message}>
            <TextInput id="industry" list="industry-options" placeholder="e.g. Dentist" autoComplete="off" error={errors.industry} {...register('industry')} />
            <datalist id="industry-options">
              {INDUSTRIES.map((i) => (
                <option key={i} value={i} />
              ))}
            </datalist>
          </Field>
          <Field label="Location" id="location" hint="A city or a country" error={errors.location?.message}>
            <TextInput id="location" placeholder="e.g. Makati or Philippines" autoComplete="off" error={errors.location} {...register('location')} />
          </Field>
          <div className="pt-7 mobile:pt-0">
            <AdminButton type="submit" busy={loading} className="w-full">
              {loading ? 'Searching…' : 'Find prospects'}
            </AdminButton>
          </div>
        </form>
        {meta && (
          <p className="text-[13px] text-muted">
            Data: {meta.sourceLabel}.{' '}
            {meta.source === 'osm' && 'Free map data has no ratings or reviews, and a search can take up to a minute. Add a HERE key (HERE_API_KEY) for fast, accurate searches.'}
            {meta.source === 'here' && 'HERE has no ratings or reviews, so the rank is based on website, social media, phone and email.'}
            {meta.source === 'geoapify' && 'OpenStreetMap data has no ratings or reviews, so the rank is based on website, social media and phone.'}
            {meta.websiteChecks && ' Websites are checked automatically; results update live.'}
          </p>
        )}
      </Panel>

      {error && <Notice tone="danger">{error}</Notice>}
      {loading && !items.length && (
        <Panel>
          <Spinner label={meta?.source === 'osm' ? 'Searching the map… this can take up to a minute.' : 'Searching the map…'} />
        </Panel>
      )}

      {search && (
        <>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-semibold text-midnight-plum">
                {search.total} {search.industry.toLowerCase()} in {search.location}
              </span>
              {Object.entries(TIERS).map(([key, t]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => dispatch(tierToggled(key))}
                  aria-pressed={tiers[key]}
                  className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-opacity ${tiers[key] ? 'border-line bg-cream-dough text-midnight-plum' : 'border-dashed border-line bg-transparent text-muted opacity-60'}`}
                >
                  <span className={`size-2.5 rounded-full ${t.dot}`} aria-hidden="true" />
                  {t.label} {search.tiers[key]}
                </button>
              ))}
              <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-semibold text-midnight-plum">
                <input type="checkbox" checked={noWebsiteOnly} onChange={() => dispatch(noWebsiteOnlyToggled())} className="size-4 accent-byte-purple" />
                No website only
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <SelectInput aria-label="Sort by" className="w-52 py-2" value={sort} onChange={(e) => dispatch(sortChanged(e.target.value))}>
                <option value="chance">Rank: chance to sign up</option>
                {meta?.hasReviews && <option value="rating">Rating</option>}
                {meta?.hasReviews && <option value="reviews">Most reviews</option>}
                <option value="name">Name</option>
              </SelectInput>
              <BulkSave searchId={search.id} items={visible} />
              <AdminButton variant="outline" className="min-h-10 py-2" onClick={() => downloadProspectsCsv(search, visible)} disabled={!visible.length}>
                Download CSV
              </AdminButton>
            </div>
          </div>
          {reused && (
            <Notice tone="info">
              Showing results from a search in the last 30 minutes.{' '}
              <AdminButton variant="link" className="text-sm" onClick={onSearch(true)} busy={loading}>
                Search again for fresh data
              </AdminButton>
            </Notice>
          )}

          <Panel className="mb-5 h-[440px] overflow-hidden p-0 mobile:h-[320px] mobile:p-0">
            <Suspense fallback={<Spinner label="Loading the map…" />}>
              <ProspectMap tiles={meta?.tiles} searchId={search.id} items={visible} selectedId={selectedId} onSelect={(id) => dispatch(prospectSelected(id))} />
            </Suspense>
          </Panel>

          <Panel className="overflow-x-auto p-0 mobile:p-0">
            {visible.length === 0 ? (
              <p className="px-6 py-10 text-center text-muted">{items.length ? 'No businesses match these filters.' : 'No businesses found. Try another industry or a bigger area.'}</p>
            ) : (
              <table className="w-full text-left text-sm">
                <thead className="border-b border-line text-xs tracking-wider text-soft-violet uppercase">
                  <tr>
                    <th className="px-4 py-3">Rank</th>
                    <th className="px-4 py-3">Save</th>
                    <th className="px-4 py-3">Business</th>
                    <th className="px-4 py-3">Chance to sign up</th>
                    <th className="px-4 py-3">Website</th>
                    <th className="px-4 py-3">Social media</th>
                    <th className="px-4 py-3">Email</th>
                    <th className="px-4 py-3">Phone</th>
                    {meta?.hasReviews && <th className="px-4 py-3">Rating</th>}
                    <th className="px-4 py-3">Top reason</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((p) => {
                    const open = p.id === selectedId;
                    return [
                      <tr
                        key={p.id}
                        ref={(el) => (el ? rowRefs.current.set(p.id, el) : rowRefs.current.delete(p.id))}
                        onClick={() => select(p.id)}
                        aria-expanded={open}
                        className={`cursor-pointer border-b border-line/70 align-top hover:bg-lavender-mist/50 ${open ? 'bg-lavender-mist/60' : ''}`}
                      >
                        <td className="px-4 py-3">
                          <span className={`inline-flex size-7 items-center justify-center rounded-full text-xs font-bold ${TIERS[p.tier].chip}`}>{p.rank}</span>
                        </td>
                        <td className="px-4 py-3">
                          <SaveCell p={p} searchId={search.id} />
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-semibold text-midnight-plum">{p.name}</div>
                          <div className="text-muted">{[p.category, p.city].filter(Boolean).join(' · ')}</div>
                          {p.businessStatus && p.businessStatus !== 'OPERATIONAL' && <div className="text-xs font-semibold text-danger">Closed</div>}
                        </td>
                        <td className="px-4 py-3">
                          <Chance p={p} />
                        </td>
                        <td className="px-4 py-3">
                          <WebsiteCell p={p} />
                        </td>
                        <td className="px-4 py-3">
                          <SocialCell p={p} />
                        </td>
                        <td className="px-4 py-3">
                          <EmailCell p={p} />
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-midnight-plum">{p.phone || <span className="text-muted">—</span>}</td>
                        {meta?.hasReviews && (
                          <td className="px-4 py-3 whitespace-nowrap text-midnight-plum">
                            {p.rating != null ? (
                              <>
                                <span className="font-semibold">★ {p.rating.toFixed(1)}</span> <span className="text-muted">({p.reviewCount})</span>
                              </>
                            ) : (
                              <span className="text-muted">No reviews</span>
                            )}
                          </td>
                        )}
                        <td className="max-w-56 px-4 py-3 text-midnight-plum">{p.reasons.find((r) => r.points > 0)?.label ?? '—'}</td>
                      </tr>,
                      open && (
                        <tr key={`${p.id}-details`} className="border-b border-line/70">
                          <td colSpan={meta?.hasReviews ? 10 : 9} className="p-0">
                            <Details p={p} searchId={search.id} />
                          </td>
                        </tr>
                      ),
                    ];
                  })}
                </tbody>
              </table>
            )}
          </Panel>
          <p className="mt-3 text-xs text-muted">
            The chance score (0–100) is an estimate from what's public: website, reviews and contact details. Hot is 70 and up, Warm 45–69. Results expire after 30 minutes unless you save them.
          </p>
        </>
      )}
    </>
  );
}
