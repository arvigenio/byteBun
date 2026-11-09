// Table cells shared by the Prospecting tabs (Search and Saved): the same business looks the same in both.
// Mirrors TIER_COLORS in ProspectMap.jsx.
export const TIERS = {
  hot: { label: 'Hot', dot: 'bg-bun-orange', chip: 'bg-bun-orange text-midnight-plum', bar: 'bg-bun-orange' },
  warm: { label: 'Warm', dot: 'bg-soft-violet', chip: 'bg-soft-violet text-cream-dough', bar: 'bg-soft-violet' },
  cold: { label: 'Cold', dot: 'bg-[#A79BC0]', chip: 'bg-[#A79BC0] text-midnight-plum', bar: 'bg-[#A79BC0]' },
};
export const NETWORK_LABELS = { facebook: 'Facebook', instagram: 'Instagram', tiktok: 'TikTok', linkedin: 'LinkedIn', youtube: 'YouTube', x: 'X' };

export const hostOf = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

export function ExternalLink({ href, children, className = '' }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer nofollow" onClick={(e) => e.stopPropagation()} className={`font-semibold text-soft-violet underline-offset-2 hover:underline ${className}`}>
      {children}
    </a>
  );
}

export function Chance({ p }) {
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

export function WebsiteCell({ p }) {
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

export function EmailCell({ p }) {
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

export function SocialCell({ p }) {
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
