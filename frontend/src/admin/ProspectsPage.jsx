import { lazy, Suspense, useEffect, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useAdminForm } from '../hooks/admin/useAdminForm.js';
import { downloadProspectsCsv, useProspects } from '../hooks/admin/useProspects.js';
import { prospectSearchSchema } from '../lib/adminSchemas.js';
import { noWebsiteOnlyToggled, prospectSelected, recheckWebsite, searchProspects, sortChanged, tierToggled } from '../store/adminProspectsSlice.js';
import { PageTitle } from './AdminLayout.jsx';
import { AdminButton, Field, Notice, Panel, SelectInput, Spinner, TextInput } from './ui.jsx';

// Leaflet is only downloaded when this page opens.
const ProspectMap = lazy(() => import('./ProspectMap.jsx'));

// Mirrors TIER_COLORS in ProspectMap.jsx.
const TIERS = {
  hot: { label: 'Hot', dot: 'bg-bun-orange', chip: 'bg-bun-orange text-midnight-plum', bar: 'bg-bun-orange' },
  warm: { label: 'Warm', dot: 'bg-soft-violet', chip: 'bg-soft-violet text-cream-dough', bar: 'bg-soft-violet' },
  cold: { label: 'Cold', dot: 'bg-[#A79BC0]', chip: 'bg-[#A79BC0] text-midnight-plum', bar: 'bg-[#A79BC0]' },
};
const INDUSTRIES = ['Dentist', 'Dental clinic', 'Veterinary clinic', 'Medical clinic', 'Dermatologist', 'Hair salon', 'Barbershop', 'Beauty salon', 'Nail salon', 'Spa', 'Gym', 'Physiotherapy', 'Chiropractor', 'Optometrist', 'Restaurant', 'Cafe', 'Bakery', 'Law firm', 'Accountant', 'Real estate agency', 'Car repair', 'Plumber', 'Electrician', 'Tutoring center', 'Daycare'];
const NETWORK_LABELS = { facebook: 'Facebook', instagram: 'Instagram', tiktok: 'TikTok', linkedin: 'LinkedIn', youtube: 'YouTube', x: 'X' };

const hostOf = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

function ExternalLink({ href, children, className = '' }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow" onClick={(e) => e.stopPropagation()} className={`font-semibold text-soft-violet underline-offset-2 hover:underline ${className}`}>
      {children}
    </a>
  );
}

function Chance({ p }) {
  const t = TIERS[p.tier];
  return (
    <div className="w-28">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${t.chip}`}>{t.label}</span>
        <span className="text-xs font-bold text-midnight-plum">{p.score}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-lavender-mist" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={p.score} aria-label="Chance to sign up">
        <div className={`h-full rounded-full ${t.bar}`} style={{ width: `${Math.max(4, p.score)}%` }} />
      </div>
    </div>
  );
}

function WebsiteCell({ p }) {
  if (p.website) {
    return (
      <div className="max-w-44">
        <ExternalLink href={p.website} className="block truncate">
          {hostOf(p.website)}
        </ExternalLink>
        <div className="mt-0.5 text-xs text-muted">
          {p.checkingWebsite ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="size-3 animate-spin rounded-full border-2 border-soft-violet border-t-transparent" aria-hidden="true" /> Checking…
            </span>
          ) : p.checkup ? (
            p.checkup.reachable ? [p.checkup.https ? 'Secure' : 'Not secure', p.checkup.mobileFriendly ? 'mobile-ready' : 'not mobile-ready', p.checkup.platform].filter(Boolean).join(' · ') : "Doesn't load"
          ) : null}
        </div>
      </div>
    );
  }
  return <span className="text-sm font-semibold text-danger">No website</span>;
}

/** mailto: link with a short, friendly first email (the admin edits it before sending). */
export function prospectMailto(p) {
  const who = p.category ? `${p.category.toLowerCase()}s` : 'local businesses';
  const subject = `A quick idea for ${p.name}`;
  const body = [
    `Hi ${p.name} team,`,
    '',
    `I'm reaching out from Byte Bun Tech. We help ${who} get more bookings with modern websites, online booking, and automatic follow-up, with free domain and hosting.`,
    '',
    'Would you be open to a free 30-minute consultation this week? We will look at how customers find and book you today, and share a few ideas you can use either way.',
    '',
    'Best regards,',
    'The Byte Bun Tech team',
    'https://bytebuntech.com',
  ].join('\n');
  return `mailto:${encodeURIComponent(p.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function EmailCell({ p }) {
  if (!p.email) {
    return p.checkingWebsite ? <span className="text-xs text-muted">Looking…</span> : <span className="text-muted">—</span>;
  }
  return (
    <div className="max-w-48">
      <a
        href={prospectMailto(p)}
        onClick={(e) => e.stopPropagation()}
        title={`Email ${p.email}`}
        className="inline-flex min-h-8 items-center gap-1.5 rounded-btn border-2 border-transparent bg-byte-purple px-3 py-1 text-xs font-semibold text-cream-dough hover:bg-byte-purple-hover"
      >
        <svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 6h16v12H4z" />
          <path d="M4 7l8 6 8-6" />
        </svg>
        Email
      </a>
      <div className="mt-1 truncate text-xs text-muted">{p.email}</div>
    </div>
  );
}

function SocialCell({ p }) {
  if (!p.socials.length) return <span className="text-muted">—</span>;
  return (
    <div className="flex max-w-40 flex-wrap gap-x-2 gap-y-1 text-sm">
      {p.socials.map((s) => (
        <ExternalLink key={s.network} href={s.url}>
          {NETWORK_LABELS[s.network] ?? s.network}
        </ExternalLink>
      ))}
    </div>
  );
}

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

export function ProspectsPage() {
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
      <PageTitle title="Prospecting">Find local businesses by industry and location, ranked by how likely they are to sign up.</PageTitle>

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
                          <td colSpan={meta?.hasReviews ? 9 : 8} className="p-0">
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
            The chance score (0–100) is an estimate from what's public: website, reviews and contact details. Hot is 70 and up, Warm 45–69. Results are not saved and expire after 30 minutes.
          </p>
        </>
      )}
    </>
  );
}
