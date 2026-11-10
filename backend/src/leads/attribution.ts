// Where a booking came from, in two parts:
//  - channel: how they booked. The chat calendar ("chatbot"), the lead page form ("web_form"), or
//    an admin booked it for them from the admin site ("admin").
//  - origin: how they reached the site. Social media, search, ads, email, another website, or
//    direct, plus the platform or site (originDetail: "Facebook", "Google", "example.com").
//
// The site remembers the visitor's last outside visit (frontend/src/lib/attribution.js) and sends
// the raw clues with the booking: UTM tags, which ad/social click IDs were in the link, the
// referring site and the landing page. The server classifies them here, so the browser never
// decides the label, and anything odd is dropped rather than rejecting the booking.

export const CHANNELS = ['web_form', 'chatbot', 'admin'] as const;
export type Channel = (typeof CHANNELS)[number];
/** Booked by an admin from the Bookings page (LeadsService.bookByAdmin). Never set by the public form. */
export const ADMIN_CHANNEL = 'admin' satisfies Channel;
export const ORIGINS = ['social', 'search', 'ads', 'email', 'referral', 'direct'] as const;
export type Origin = (typeof ORIGINS)[number];

export const CHANNEL_LABELS: Record<Channel, string> = { web_form: 'Web form', chatbot: 'Chatbot', admin: 'Admin site' };
export const ORIGIN_LABELS: Record<Origin, string> = {
  social: 'Social media',
  search: 'Search',
  ads: 'Ads',
  email: 'Email',
  referral: 'Other website',
  direct: 'Direct',
};

/** The chat calendar books with source "chatbot"; every other booking is the lead page form. */
export const channelOf = (source: string | null | undefined): Channel => (source === 'chatbot' ? 'chatbot' : 'web_form');

export interface Attribution {
  origin: Origin;
  originDetail: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  referrerHost: string | null;
  landingPath: string | null;
}

/** "Chatbot · Social media (Facebook)", for emails and the CSV. */
export function describeOrigin(lead: { channel: string; origin: string | null; originDetail: string | null }): string {
  const channel = CHANNEL_LABELS[lead.channel as Channel] ?? lead.channel;
  if (!lead.origin) return channel;
  const origin = ORIGIN_LABELS[lead.origin as Origin] ?? lead.origin;
  return `${channel} · ${origin}${lead.originDetail ? ` (${lead.originDetail})` : ''}`;
}

// ---------------------------------------------------------------- the rules

type Kind = 'social' | 'search' | 'email';
/** Known sites by domain (a subdomain matches too). Checked in order: webmail before search. */
const SITES: [RegExp, Kind, string][] = [
  [/(^|\.)mail\.google\.com$/, 'email', 'Gmail'],
  [/(^|\.)(outlook\.live|outlook\.office|outlook\.office365)\.com$/, 'email', 'Outlook'],
  [/(^|\.)mail\.yahoo\.com$/, 'email', 'Yahoo Mail'],
  [/(^|\.)(facebook\.com|fb\.com|fb\.me)$/, 'social', 'Facebook'],
  [/(^|\.)messenger\.com$/, 'social', 'Messenger'],
  [/(^|\.)instagram\.com$/, 'social', 'Instagram'],
  [/(^|\.)threads\.(net|com)$/, 'social', 'Threads'],
  [/(^|\.)tiktok\.com$/, 'social', 'TikTok'],
  [/(^|\.)(linkedin\.com|lnkd\.in)$/, 'social', 'LinkedIn'],
  [/(^|\.)(twitter\.com|x\.com|t\.co)$/, 'social', 'X (Twitter)'],
  [/(^|\.)(youtube\.com|youtu\.be)$/, 'social', 'YouTube'],
  [/(^|\.)pinterest\.[a-z.]+$/, 'social', 'Pinterest'],
  [/(^|\.)reddit\.com$/, 'social', 'Reddit'],
  [/(^|\.)(whatsapp\.com|wa\.me)$/, 'social', 'WhatsApp'],
  [/(^|\.)viber\.com$/, 'social', 'Viber'],
  [/(^|\.)google\.[a-z.]+$/, 'search', 'Google'],
  [/(^|\.)bing\.com$/, 'search', 'Bing'],
  [/(^|\.)duckduckgo\.com$/, 'search', 'DuckDuckGo'],
  [/(^|\.)search\.yahoo\.com$|(^|\.)yahoo\.com$/, 'search', 'Yahoo'],
  [/(^|\.)ecosia\.org$/, 'search', 'Ecosia'],
  [/(^|\.)search\.brave\.com$/, 'search', 'Brave Search'],
  [/(^|\.)yandex\.[a-z.]+$/, 'search', 'Yandex'],
  [/(^|\.)baidu\.com$/, 'search', 'Baidu'],
];
const siteOf = (host: string) => SITES.find(([re]) => re.test(host));

/** utm_source spellings people use, by platform. */
const SOURCE_ALIASES: Record<string, [Kind, string]> = {};
const alias = (kind: Kind, name: string, ...keys: string[]) => keys.forEach((k) => (SOURCE_ALIASES[k] = [kind, name]));
alias('social', 'Facebook', 'facebook', 'fb', 'meta', 'facebook.com', 'm.facebook.com', 'l.facebook.com');
alias('social', 'Messenger', 'messenger');
alias('social', 'Instagram', 'instagram', 'ig', 'insta', 'instagram.com', 'l.instagram.com');
alias('social', 'Threads', 'threads');
alias('social', 'TikTok', 'tiktok', 'tt', 'tiktok.com');
alias('social', 'LinkedIn', 'linkedin', 'li', 'linkedin.com');
alias('social', 'X (Twitter)', 'twitter', 'x', 'x.com', 'twitter.com');
alias('social', 'YouTube', 'youtube', 'yt', 'youtube.com');
alias('social', 'Pinterest', 'pinterest');
alias('social', 'Reddit', 'reddit');
alias('social', 'WhatsApp', 'whatsapp', 'wa');
alias('social', 'Viber', 'viber');
alias('search', 'Google', 'google', 'google.com');
alias('search', 'Bing', 'bing', 'microsoft');
alias('email', 'Email', 'email', 'newsletter', 'mailchimp', 'brevo', 'sendgrid');

const SOCIAL_MEDIUMS = new Set(['social', 'social-media', 'social_media', 'socialmedia', 'sm', 'organic_social', 'organic-social', 'bio', 'link_in_bio', 'post', 'story', 'reel']);
const PAID_SOCIAL_MEDIUMS = new Set(['paid_social', 'paid-social', 'paidsocial', 'social_paid', 'social-paid', 'social_ads']);
const AD_MEDIUMS = new Set(['cpc', 'ppc', 'paid', 'paid_search', 'paid-search', 'paidsearch', 'display', 'cpm', 'ads', 'ad', 'banner']);
const EMAIL_MEDIUMS = new Set(['email', 'e-mail', 'newsletter', 'mail']);

/** Ad click IDs: the link came from a paid ad. */
const AD_CLICK_IDS: Record<string, [Origin, string]> = {
  gclid: ['ads', 'Google'],
  gbraid: ['ads', 'Google'],
  wbraid: ['ads', 'Google'],
  msclkid: ['ads', 'Bing'],
  ttclid: ['social', 'TikTok (paid)'],
};
/** Social click IDs: added to links shared on the platform (posts, bios, messages, and ads). */
const SOCIAL_CLICK_IDS: Record<string, string> = { fbclid: 'Facebook', igshid: 'Instagram', li_fat_id: 'LinkedIn', twclid: 'X (Twitter)' };
export const CLICK_IDS = [...Object.keys(AD_CLICK_IDS), ...Object.keys(SOCIAL_CLICK_IDS)];

// ---------------------------------------------------------------- cleaning the input

const text = (v: unknown, max: number) => {
  if (typeof v !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const s = v.replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, max);
  return s || null;
};
const hostOf = (v: unknown): string | null => {
  const s = text(v, 2000);
  if (!s) return null;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:/i.test(s) ? s : `https://${s}`);
    if (!/^https?:$/.test(u.protocol)) return null;
    return u.hostname.toLowerCase().replace(/^www\./, '').slice(0, 253) || null;
  } catch {
    return null;
  }
};
const pathOf = (v: unknown): string | null => {
  const s = text(v, 300);
  return s && s.startsWith('/') && !s.startsWith('//') ? s.split(/[?#]/)[0] : null;
};
const titleCase = (s: string) => s.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 60);

/**
 * The raw clues from the browser, classified. `ownHosts`: this site's own hostnames (a referrer
 * from them is just a page change, not a source). Null when the browser sent nothing (an old page).
 */
export function classifyAttribution(raw: unknown, ownHosts: string[]): Attribution | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const utmSource = text(r.utmSource, 100);
  const utmMedium = text(r.utmMedium, 100);
  const utmCampaign = text(r.utmCampaign, 100);
  const own = new Set(ownHosts.map((h) => h.toLowerCase().replace(/^www\./, '')));
  const host = hostOf(r.referrer);
  const referrerHost = host && !own.has(host) ? host : null;
  const clickIds = Array.isArray(r.clickIds) ? r.clickIds.filter((c): c is string => typeof c === 'string' && CLICK_IDS.includes(c)) : [];
  const base = { utmSource, utmMedium, utmCampaign, referrerHost, landingPath: pathOf(r.landingPath) };
  const result = (origin: Origin, originDetail: string | null): Attribution => ({ origin, originDetail, ...base });

  // 1. UTM tags: someone tagged the link on purpose, so they win.
  if (utmSource || utmMedium) {
    const src = (utmSource ?? '').toLowerCase();
    const medium = (utmMedium ?? '').toLowerCase();
    const known = SOURCE_ALIASES[src];
    const name = known?.[1] ?? (utmSource ? titleCase(utmSource) : null);
    if (EMAIL_MEDIUMS.has(medium) || known?.[0] === 'email') return result('email', known?.[0] === 'email' ? null : name);
    if (PAID_SOCIAL_MEDIUMS.has(medium)) return result('social', name ? `${name} (paid)` : 'Paid social');
    if (known?.[0] === 'social') return result('social', AD_MEDIUMS.has(medium) ? `${name} (paid)` : name);
    if (SOCIAL_MEDIUMS.has(medium)) return result('social', name);
    if (AD_MEDIUMS.has(medium)) return result('ads', name);
    if (known?.[0] === 'search') return result('search', name);
    return result('referral', name);
  }

  // 2. An ad click ID (gclid ...): paid, even though the referrer looks like a search.
  const ad = clickIds.find((c) => c in AD_CLICK_IDS);
  if (ad) return result(...AD_CLICK_IDS[ad]);

  // 3. The referring site, when it's one we know.
  const site = referrerHost ? siteOf(referrerHost) : undefined;
  if (site) return result(site[1], site[2]);

  // 4. A social click ID with no useful referrer (in-app browsers often send none).
  const social = clickIds.find((c) => c in SOCIAL_CLICK_IDS);
  if (social) return result('social', SOCIAL_CLICK_IDS[social]);

  // 5. Any other website, or nothing at all.
  if (referrerHost) return result('referral', referrerHost);
  return result('direct', null);
}
