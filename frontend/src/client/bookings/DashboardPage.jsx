import { useMemo, useState } from 'react';
import { useDashboardQuery } from '../api.js';
import { fmtLongDate, fmtTime } from '../lib/format.js';
import { bookingsBase } from '../lib/surface.js';
import { Badge, Empty, Icon, ICONS, LinkButton, Loading, PageHeader } from '../ui.jsx';

// The Bookings dashboard (API: GET /client/bookings/dashboard?days=…): bookings from N days ago
// to N days ahead, by appointment date. Each booking is attended (checked in), unattended (over,
// not checked in; no-shows are part of these), upcoming, or cancelled.
//
// Colors: the validated reference categorical slots (aqua, orange, blue) in a fixed order, with
// cancelled as a neutral gray (it's the least important to read). Aqua is under 3:1 on the light
// surface, so every value is also in a tooltip, a label, or the table view.

const KINDS = [
  { key: 'attended', label: 'Attended', color: 'var(--dash-attended)' },
  { key: 'unattended', label: 'Unattended', color: 'var(--dash-unattended)' },
  { key: 'upcoming', label: 'Upcoming', color: 'var(--dash-upcoming)' },
  { key: 'cancelled', label: 'Cancelled', color: 'var(--dash-cancelled)' },
];
const PERIODS = [
  [7, '7 days'],
  [30, '30 days'],
  [90, '90 days'],
  [365, '1 year'],
];
const STYLE = `
.bb-dash {
  --dash-attended: #1baf7a;
  --dash-unattended: #eb6834;
  --dash-upcoming: #2a78d6;
  --dash-cancelled: #b4b3ad;
  --dash-grid: #e7e8ec;
  --dash-today: #111827;
}
`;

const shortDate = (date) => new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(new Date(`${date}T12:00:00Z`));
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);

export function DashboardPage() {
  const [days, setDays] = useState(30);
  const q = useDashboardQuery(days);
  const d = q.data;

  return (
    <div className="bb-dash">
      <style>{STYLE}</style>
      <PageHeader
        title="Dashboard"
        description={d ? `Bookings from ${fmtLongDate(d.from)} to ${fmtLongDate(d.to)}, by appointment date.` : ' '}
        actions={
          <div className="flex gap-1 rounded-btn bg-sunken p-1" role="tablist" aria-label="Period">
            {PERIODS.map(([v, l]) => (
              <button key={v} type="button" role="tab" aria-selected={days === v} onClick={() => setDays(v)} className={`cursor-pointer rounded-md px-3 py-1.5 text-sm font-medium ${days === v ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'}`}>
                {l}
              </button>
            ))}
          </div>
        }
      />
      {q.isLoading || !d ? <Loading /> : <Dashboard d={d} fetching={q.isFetching} />}
    </div>
  );
}

function Dashboard({ d, fetching }) {
  const t = d.todayCounts;
  const pastTotal = d.past.attended + d.past.unattended;
  const nothing = d.past.booked + t.booked + d.future.booked === 0;
  return (
    <div className={`flex flex-col gap-5 transition-opacity ${fetching ? 'opacity-60' : ''}`}>
      {/* Past · today · ahead */}
      <div className="grid gap-3 desktop:grid-cols-3">
        <Group title={`Past ${d.days} days`} icon={ICONS.undo}>
          <Stat label="Booked" value={d.past.booked} />
          <Stat label="Attended" value={d.past.attended} sub={pastTotal ? `${pct(d.past.attended, pastTotal)}% of those due` : null} swatch="attended" />
          <Stat label="Unattended" value={d.past.unattended} sub={d.past.noShows ? `${d.past.noShows} marked no-show` : null} swatch="unattended" />
          <Stat label="Cancelled" value={d.past.cancelled} swatch="cancelled" />
        </Group>
        <Group title="Today" icon={ICONS.clock} highlight>
          <Stat label="Booked" value={t.booked} />
          <Stat label="Attended" value={t.attended} swatch="attended" />
          <Stat label="Still to come" value={t.upcoming} swatch="upcoming" />
          <Stat label="Unattended" value={t.unattended} swatch="unattended" />
        </Group>
        <Group title={`Next ${d.days} days`} icon={ICONS.calendar}>
          <Stat label="Upcoming" value={d.future.upcoming} swatch="upcoming" />
          <Stat label="Cancelled" value={d.future.cancelled} swatch="cancelled" />
          <Stat label="Attendance rate" value={d.attendanceRate === null ? '—' : `${d.attendanceRate}%`} sub="Of bookings that are over" />
          <Stat label="Added by your team" value={d.sources.business} sub={`${d.sources.public} from the booking page`} />
        </Group>
      </div>

      {nothing ? (
        <Empty title="No bookings in this period" action={<LinkButton href={bookingsBase}>Go to bookings</LinkButton>}>
          Try a longer period, or share your booking page to get your first bookings.
        </Empty>
      ) : (
        <>
          <DayChart d={d} />
          <div className="grid gap-5 desktop:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] desktop:items-start">
            <ServicesTable services={d.services} />
            <TodayAgenda d={d} />
          </div>
        </>
      )}
    </div>
  );
}

function Group({ title, icon, highlight = false, children }) {
  return (
    <section className={`rounded-card border bg-surface p-4 ${highlight ? 'border-brand/40 ring-1 ring-brand/20' : 'border-line'}`}>
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-muted">
        <Icon d={icon} className="size-4" /> {title}
      </h2>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">{children}</dl>
    </section>
  );
}

function Stat({ label, value, sub, swatch }) {
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1.5 text-xs font-medium text-muted">
        {swatch && <span className="size-2.5 shrink-0 rounded-sm" style={{ background: KINDS.find((k) => k.key === swatch).color }} aria-hidden="true" />}
        {label}
      </dt>
      <dd className="text-2xl font-semibold text-ink tabular-nums">{value}</dd>
      {sub && <dd className="truncate text-[11px] text-faint">{sub}</dd>}
    </div>
  );
}

// ---- Bookings per day (stacked bars; weekly once the window is long) ----

function DayChart({ d }) {
  const [table, setTable] = useState(false);
  const [hover, setHover] = useState(null);
  // A long window is grouped by week so bars stay readable.
  const buckets = useMemo(() => {
    const size = d.days >= 90 ? 7 : 1;
    const out = [];
    for (let i = 0; i < d.perDay.length; i += size) {
      const chunk = d.perDay.slice(i, i + size);
      const b = { from: chunk[0].date, to: chunk[chunk.length - 1].date, attended: 0, unattended: 0, upcoming: 0, cancelled: 0 };
      for (const day of chunk) for (const k of KINDS) b[k.key] += day[k.key];
      b.total = KINDS.reduce((s, k) => s + b[k.key], 0);
      b.today = d.today >= b.from && d.today <= b.to;
      out.push(b);
    }
    return out;
  }, [d]);
  const weekly = d.days >= 90;
  const max = Math.max(1, ...buckets.map((b) => b.total));
  const nice = (() => {
    const step = Math.pow(10, Math.floor(Math.log10(max)));
    const m = Math.ceil(max / step) * step;
    return m < 4 ? 4 : m;
  })();
  const W = 1000;
  const H = 260;
  const pad = { l: 34, r: 8, t: 10, b: 26 };
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;
  const slot = plotW / buckets.length;
  const barW = Math.max(2, Math.min(28, slot - Math.max(2, slot * 0.25)));
  const y = (v) => pad.t + plotH - (v / nice) * plotH;
  const ticks = [0, nice / 4, nice / 2, (nice * 3) / 4, nice].map((v) => Math.round(v));
  const labelEvery = Math.ceil(buckets.length / 8);
  const range = (b) => (b.from === b.to ? fmtLongDate(b.from) : `${shortDate(b.from)} – ${shortDate(b.to)}`);

  return (
    <section className="rounded-card border border-line bg-surface p-4">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold text-ink">Bookings {weekly ? 'per week' : 'per day'}</h2>
          <p className="text-xs text-muted">Past, today and ahead. Hover a bar for the numbers.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <ul className="flex flex-wrap gap-3 text-xs text-muted" aria-label="Legend">
            {KINDS.map((k) => (
              <li key={k.key} className="flex items-center gap-1.5">
                <span className="size-2.5 rounded-sm" style={{ background: k.color }} aria-hidden="true" />
                {k.label}
              </li>
            ))}
          </ul>
          <button type="button" onClick={() => setTable((v) => !v)} className="cursor-pointer text-xs font-medium text-brand underline">
            {table ? 'Show chart' : 'Show as table'}
          </button>
        </div>
      </header>

      {table ? (
        <div className="max-h-80 overflow-auto rounded-btn border border-line">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-sunken text-left text-xs text-muted">
              <tr>
                <th className="px-3 py-2 font-semibold">{weekly ? 'Week' : 'Day'}</th>
                {KINDS.map((k) => (
                  <th key={k.key} className="px-3 py-2 text-right font-semibold">
                    {k.label}
                  </th>
                ))}
                <th className="px-3 py-2 text-right font-semibold">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {buckets
                .filter((b) => b.total)
                .map((b) => (
                  <tr key={b.from} className={b.today ? 'bg-brand-soft/50' : ''}>
                    <td className="px-3 py-1.5">{range(b)}</td>
                    {KINDS.map((k) => (
                      <td key={k.key} className="px-3 py-1.5 text-right tabular-nums">
                        {b[k.key] || ''}
                      </td>
                    ))}
                    <td className="px-3 py-1.5 text-right font-semibold tabular-nums">{b.total}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative">
          <svg viewBox={`0 0 ${W} ${H}`} className="h-64 w-full" role="img" aria-label={`Bookings ${weekly ? 'per week' : 'per day'}, stacked by attended, unattended, upcoming and cancelled`} onMouseLeave={() => setHover(null)}>
            {ticks.map((v) => (
              <g key={v}>
                <line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke="var(--dash-grid)" strokeWidth="1" />
                <text x={pad.l - 6} y={y(v) + 4} textAnchor="end" fontSize="11" fill="currentColor" className="text-faint">
                  {v}
                </text>
              </g>
            ))}
            {buckets.map((b, i) => {
              const cx = pad.l + slot * i + slot / 2;
              let top = y(0);
              const segs = KINDS.filter((k) => b[k.key]).map((k) => {
                const h = (b[k.key] / nice) * plotH;
                const seg = { k, y: top - h, h };
                top -= h;
                return seg;
              });
              return (
                <g key={b.from}>
                  {b.today && <line x1={cx} x2={cx} y1={pad.t} y2={pad.t + plotH} stroke="var(--dash-today)" strokeWidth="1.5" strokeDasharray="3 3" opacity="0.5" />}
                  {segs.map((s, j) => {
                    const last = j === segs.length - 1;
                    // A 2px surface gap between stacked segments; the top segment's data-end is rounded.
                    const gap = j > 0 ? 2 : 0;
                    const h = Math.max(0, s.h - gap);
                    return last ? (
                      <path key={s.k.key} d={roundedTop(cx - barW / 2, s.y, barW, h, Math.min(4, barW / 2, h))} fill={s.k.color} />
                    ) : (
                      <rect key={s.k.key} x={cx - barW / 2} y={s.y + (j > 0 ? 0 : 0)} width={barW} height={h} fill={s.k.color} />
                    );
                  })}
                  {/* The hit target: the whole column, wider than the bar. */}
                  <rect x={pad.l + slot * i} y={pad.t} width={slot} height={plotH} fill="transparent" onMouseEnter={() => setHover({ b, x: cx })} onFocus={() => setHover({ b, x: cx })} tabIndex={b.total ? 0 : -1} aria-label={`${range(b)}: ${b.total} bookings`} />
                  {i % labelEvery === 0 && (
                    <text x={cx} y={H - 8} textAnchor="middle" fontSize="11" fill="currentColor" className={b.today ? 'font-semibold text-ink' : 'text-faint'}>
                      {b.today && !weekly ? 'Today' : shortDate(b.from)}
                    </text>
                  )}
                </g>
              );
            })}
            <line x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} stroke="currentColor" className="text-line-strong" strokeWidth="1" />
          </svg>
          {hover && hover.b.total > 0 && (
            <div className="pointer-events-none absolute top-2 z-10 w-48 -translate-x-1/2 rounded-xl border border-line bg-surface p-3 text-xs shadow-lg" style={{ left: `${Math.min(88, Math.max(12, (hover.x / W) * 100))}%` }}>
              <p className="mb-1.5 font-semibold text-ink">
                {range(hover.b)}
                {hover.b.today && <span className="ml-1 text-brand">· today</span>}
              </p>
              {KINDS.filter((k) => hover.b[k.key]).map((k) => (
                <p key={k.key} className="flex items-center justify-between gap-3 text-muted">
                  <span className="flex items-center gap-1.5">
                    <span className="size-2 rounded-sm" style={{ background: k.color }} />
                    {k.label}
                  </span>
                  <span className="font-semibold text-ink tabular-nums">{hover.b[k.key]}</span>
                </p>
              ))}
              <p className="mt-1.5 flex justify-between border-t border-line pt-1.5 font-semibold text-ink">
                <span>Total</span>
                <span className="tabular-nums">{hover.b.total}</span>
              </p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/** A rect whose top corners are rounded (the bar's data-end); the base stays square. */
function roundedTop(x, y, w, h, r) {
  if (h <= 0) return '';
  r = Math.max(0, Math.min(r, h));
  return `M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + w - r} Q${x + w},${y} ${x + w},${y + r} V${y + h} Z`;
}

// ---- Services availed ----

function ServicesTable({ services }) {
  const max = Math.max(1, ...services.map((s) => s.booked));
  return (
    <section className="overflow-hidden rounded-card border border-line bg-surface">
      <header className="border-b border-line px-4 py-3">
        <h2 className="font-semibold text-ink">Services availed</h2>
        <p className="text-xs text-muted">Most booked first, in this period.</p>
      </header>
      {!services.length ? (
        <p className="px-4 py-8 text-center text-sm text-faint">No bookings in this period.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-sunken text-left text-xs text-muted">
              <tr>
                <th className="px-4 py-2 font-semibold">Service</th>
                <th className="px-2 py-2 text-right font-semibold">Booked</th>
                <th className="px-2 py-2 text-right font-semibold">Attended</th>
                <th className="px-2 py-2 text-right font-semibold">Unattended</th>
                <th className="px-2 py-2 text-right font-semibold">Upcoming</th>
                <th className="px-2 py-2 text-right font-semibold">Cancelled</th>
                <th className="px-4 py-2 text-right font-semibold">Rate</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {services.map((s) => {
                const due = s.attended + s.unattended;
                return (
                  <tr key={s.id}>
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-ink">{s.name}</p>
                      {/* Share of the most booked service, split by outcome. */}
                      <div className="mt-1.5 flex h-1.5 gap-0.5" style={{ width: `${Math.max(8, (s.booked / max) * 100)}%` }} aria-hidden="true">
                        {KINDS.filter((k) => s[k.key]).map((k, i, arr) => (
                          <span key={k.key} className={`h-full ${i === arr.length - 1 ? 'rounded-r-full' : ''} ${i === 0 ? 'rounded-l-full' : ''}`} style={{ background: k.color, flex: s[k.key] }} />
                        ))}
                      </div>
                    </td>
                    <td className="px-2 py-2.5 text-right font-semibold tabular-nums">{s.booked}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums">{s.attended}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums">{s.unattended}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums">{s.upcoming}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums text-muted">{s.cancelled}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{due ? `${pct(s.attended, due)}%` : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

// ---- Today ----

const AGENDA = { attended: ['ok', 'Attended'], unattended: ['warn', 'Unattended'], upcoming: ['brand', 'Upcoming'], cancelled: ['neutral', 'Cancelled'] };

function TodayAgenda({ d }) {
  return (
    <section className="overflow-hidden rounded-card border border-line bg-surface">
      <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div>
          <h2 className="font-semibold text-ink">Today</h2>
          <p className="text-xs text-muted">{fmtLongDate(d.today)}</p>
        </div>
        <LinkButton href={`${bookingsBase}#check-in`} size="sm">
          <Icon d={ICONS.qr} className="size-4" /> Check-in
        </LinkButton>
      </header>
      {!d.todayList.length ? (
        <p className="px-4 py-8 text-center text-sm text-faint">No bookings today.</p>
      ) : (
        <ul className="divide-y divide-line">
          {d.todayList.map((b) => (
            <li key={b.id} className="flex items-center gap-3 px-4 py-2.5">
              <span className="w-16 shrink-0 text-sm font-semibold tabular-nums">{b.dateOnly ? 'Day' : fmtTime(b.startsAt, d.timeZone)}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{b.customer}</span>
                <span className="block truncate text-xs text-faint">{b.service}</span>
              </span>
              <Badge tone={AGENDA[b.kind][0]}>{AGENDA[b.kind][1]}</Badge>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
