// A quick checkup of a prospect's homepage: does it load, is it secure, mobile-friendly, can
// people book online or chat, how old does it look, and which social pages it links to. These
// feed the fit score (scoring.ts).
//
// The server opens URLs that come from outside (Google / OpenStreetMap listings), so the fetch
// is locked down against SSRF: http(s) on the standard ports only, every DNS answer is checked
// and private, loopback, link-local and other internal addresses are refused (also after each
// redirect, and at connect time, so DNS rebinding doesn't get around it). Small body cap and
// short timeouts.
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import zlib from 'node:zlib';

export type SocialNetwork = 'facebook' | 'instagram' | 'tiktok' | 'linkedin' | 'youtube' | 'x';
export interface SocialLink {
  network: SocialNetwork;
  url: string;
}

export interface WebsiteCheckup {
  reachable: boolean;
  /** Where the homepage ended up after redirects. */
  finalUrl: string | null;
  https: boolean;
  mobileFriendly: boolean;
  onlineBooking: boolean;
  chat: boolean;
  responseMs: number | null;
  /** Latest year in the footer's copyright line, if any. */
  copyrightYear: number | null;
  /** Site builder / CMS, when recognizable (WordPress, Wix, ...). */
  platform: string | null;
  title: string | null;
  /** Social pages the homepage links to. */
  socials: SocialLink[];
  /** A contact email shown on the homepage (mailto: link or plain text), if any. */
  email?: string | null;
  error: string | null;
  /** The address was refused (private network, odd port, ...): not scored as "site is down". */
  blocked?: boolean;
  checkedAt: string;
}

export type WebsiteKind = 'none' | 'social' | 'site';

// Image names like logo@2x.png look like emails; so do tracking/placeholder addresses.
const NOT_CONTACT = /\.(png|jpe?g|gif|webp|svg|css|js)$|^(example|test|user|name|email|your|yourname|john|johndoe)@|@(example|sentry|wixpress|domain|email)\.|noreply|no-reply/i;

/** A usable contact email, or null. */
export function cleanEmail(raw: string | null | undefined): string | null {
  const v = (raw ?? '').trim().replace(/^mailto:/i, '').split(/[?;,\s]/)[0]!.toLowerCase();
  if (v.length > 254 || !/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(v) || NOT_CONTACT.test(v)) return null;
  return v;
}

/** Cloudflare's "email protection": hex, first byte is the XOR key for the rest. */
export function decodeCfEmail(hex: string): string | null {
  if (!/^(?:[0-9a-f]{2}){2,}$/i.test(hex)) return null;
  const key = parseInt(hex.slice(0, 2), 16);
  let out = '';
  for (let i = 2; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
  return out;
}

const safeDecodeUri = (s: string) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

// &#64; / &#x40; / &commat; for "@", &#46; for "." (a common way to hide addresses from bots).
const decodeEmailEntities = (s: string) =>
  s.replace(/&#0*64;|&#x0*40;|&commat;/gi, '@').replace(/&#0*46;|&#x0*2e;|&period;/gi, '.');

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// "info [at] clinic [dot] ph", "info(at)clinic(dot)ph": bracketed forms only, plain " at " is too loose.
const OBFUSCATED_RE = /([A-Za-z0-9._%+-]+)\s*[[({]\s*at\s*[\])}]\s*([A-Za-z0-9-]+(?:\s*(?:[[({]\s*dot\s*[\])}]|\.)\s*[A-Za-z0-9-]+)+)/gi;

/**
 * The best contact email in a page. Looks at mailto: links, Cloudflare-protected addresses,
 * structured data ("email": ...), plain text (also entity-encoded) and "name [at] site [dot] com".
 * An address on the business's own domain wins.
 */
export function findEmail(html: string, siteUrl?: string): string | null {
  const text = decodeEmailEntities(html.replace(/<script(?![^>]*ld\+json)[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' '));
  const found = [
    ...[...decodeEmailEntities(html).matchAll(/href\s*=\s*["']\s*mailto:([^"'?]+)/gi)].map((m) => cleanEmail(safeDecodeUri(m[1]!))),
    ...[...html.matchAll(/data-cfemail\s*=\s*["']([0-9a-f]+)["']|\/cdn-cgi\/l\/email-protection#([0-9a-f]+)/gi)].map((m) => cleanEmail(decodeCfEmail(m[1] ?? m[2]!))),
    ...[...html.matchAll(/["']email["']\s*:\s*["']([^"']{3,254})["']/gi)].map((m) => cleanEmail(m[1])),
    ...[...text.matchAll(EMAIL_RE)].map((m) => cleanEmail(m[0])),
    ...[...text.matchAll(OBFUSCATED_RE)].map((m) => cleanEmail(`${m[1]}@${m[2]!.replace(/\s*(?:[[({]\s*dot\s*[\])}]|\.)\s*/gi, '.')}`)),
  ].filter((e): e is string => !!e);
  if (!found.length) return null;
  // Prefer an address on the business's own domain.
  let host = '';
  try {
    host = siteUrl ? new URL(siteUrl).hostname.replace(/^www\./, '') : '';
  } catch {
    // ignore
  }
  return found.find((e) => host && e.endsWith(`@${host}`)) ?? found[0]!;
}

const CONTACT_LINK = /contact|kontak|contacto|reach[-_ ]?us|get[-_ ]in[-_ ]touch|inquir|enquir/i;
const ABOUT_LINK = /about|who[-_ ]we[-_ ]are|our[-_ ]team|location|clinic|find[-_ ]us/i;
const NOT_A_PAGE = /\.(pdf|jpe?g|png|gif|webp|svg|zip|docx?|xlsx?|mp4|mp3)(\?|$)/i;

/**
 * Up to `max` pages on the same site that likely show an email: links to Contact pages first,
 * then About pages; when the homepage links to neither, the usual /contact addresses.
 */
export function contactPageUrls(html: string, baseUrl: string, max = 2): string[] {
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    return [];
  }
  const host = base.hostname.replace(/^www\./, '');
  const contact: string[] = [];
  const about: string[] = [];
  for (const m of html.matchAll(/<a\b[^>]*?href\s*=\s*["']([^"'#][^"']{0,300})["'][^>]*>([\s\S]{0,300}?)<\/a>/gi)) {
    let url: URL;
    try {
      url = new URL(decode(m[1]!), base);
    } catch {
      continue;
    }
    if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.hostname.replace(/^www\./, '') !== host || NOT_A_PAGE.test(url.pathname)) continue;
    url.hash = '';
    if (url.pathname === base.pathname && url.search === base.search) continue;
    const label = `${url.pathname} ${decode(m[2]!.replace(/<[^>]+>/g, ' '))}`;
    if (CONTACT_LINK.test(label)) contact.push(url.toString());
    else if (ABOUT_LINK.test(label)) about.push(url.toString());
  }
  const picked = [...new Set([...contact, ...about])];
  if (!picked.length) picked.push(new URL('/contact', base).toString(), new URL('/contact-us', base).toString());
  return picked.slice(0, max);
}

export const normalizeUrl =(url: string) => (/^https?:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`);

const NETWORK_HOSTS: [RegExp, SocialNetwork][] = [
  [/(^|\.)(facebook\.com|fb\.com|fb\.me)$/i, 'facebook'],
  [/(^|\.)instagram\.com$/i, 'instagram'],
  [/(^|\.)tiktok\.com$/i, 'tiktok'],
  [/(^|\.)linkedin\.com$/i, 'linkedin'],
  [/(^|\.)(youtube\.com|youtu\.be)$/i, 'youtube'],
  [/(^|\.)(x\.com|twitter\.com)$/i, 'x'],
];
// Link-in-bio and messaging pages: a web presence, but not a website.
const OTHER_SOCIAL_HOSTS = /(^|\.)(linktr\.ee|wa\.me|business\.site|m\.me)$/i;

/** The social network a URL belongs to, or null. */
export function socialNetworkOf(url: string): SocialNetwork | null {
  try {
    const host = new URL(normalizeUrl(url)).hostname;
    return NETWORK_HOSTS.find(([re]) => re.test(host))?.[1] ?? null;
  } catch {
    return null;
  }
}

/** No website, only a social page (Facebook, Instagram, ...), or a real website. */
export function websiteKind(url: string | null | undefined, socials: SocialLink[] = []): WebsiteKind {
  if (url) {
    try {
      const host = new URL(normalizeUrl(url)).hostname;
      return socialNetworkOf(url) || OTHER_SOCIAL_HOSTS.test(host) ? 'social' : 'site';
    } catch {
      // fall through
    }
  }
  return socials.length ? 'social' : 'none';
}

/** Adds links (dropping repeats and share/intent links), one per network. */
export function mergeSocials(...lists: (SocialLink | string | null | undefined)[][]): SocialLink[] {
  const out = new Map<SocialNetwork, SocialLink>();
  for (const item of lists.flat()) {
    if (!item) continue;
    const raw = typeof item === 'string' ? item : item.url;
    const network = typeof item === 'string' ? socialNetworkOf(raw) : item.network;
    if (!network || out.has(network)) continue;
    let url: URL;
    try {
      url = new URL(normalizeUrl(raw.startsWith('@') ? `${network === 'x' ? 'x.com' : `${network}.com`}/${raw.slice(1)}` : raw));
    } catch {
      continue;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') continue;
    if (/\/(sharer|share|intent|plugins|dialog|tr)\b|\/sharer\.php/i.test(url.pathname) || url.pathname === '/' || url.pathname === '') continue;
    url.protocol = 'https:';
    out.set(network, { network, url: url.toString().slice(0, 300) });
  }
  return [...out.values()];
}

// ---- address checks ----

const blocked = new net.BlockList();
for (const [addr, prefix] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
] as const) blocked.addSubnet(addr, prefix, 'ipv4');
for (const [addr, prefix] of [
  // No ::ffff:0:0/96 rule here: BlockList would then match every IPv4 address. IPv4-mapped
  // addresses are unwrapped and checked as IPv4 in isPublicAddress instead.
  ['::', 128], ['::1', 128], ['64:ff9b::', 96], ['100::', 64], ['2001::', 23], ['2001:db8::', 32], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
] as const) blocked.addSubnet(addr, prefix, 'ipv6');

/** True for addresses on the public internet; false for private, loopback, internal, reserved. */
export function isPublicAddress(address: string): boolean {
  const family = net.isIP(address);
  if (!family) return false;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return isPublicAddress(mapped[1]!);
  return !blocked.check(address, family === 4 ? 'ipv4' : 'ipv6');
}

export class BlockedUrlError extends Error {}

// Used as the socket's DNS lookup: refuses the connection if any answer is not public.
const safeLookup: net.LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, '', 4);
    const list = addresses as dns.LookupAddress[];
    if (!list.length || list.some((a) => !isPublicAddress(a.address))) {
      return callback(new BlockedUrlError('That website points to a private address.'), '', 4);
    }
    if ((options as dns.LookupOptions).all) return (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, list);
    const pick = list.find((a) => a.family === 4) ?? list[0]!; // IPv4 first: IPv6 often has no route in containers
    callback(null, pick.address, pick.family);
  });
};

/** Throws unless the URL is http(s), on a standard port, and not a private IP literal. */
export function assertFetchableUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BlockedUrlError('Not a valid web address.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new BlockedUrlError('Only http and https websites are checked.');
  if (url.port && url.port !== '80' && url.port !== '443') throw new BlockedUrlError('Only websites on the standard ports are checked.');
  if (url.username || url.password) throw new BlockedUrlError('Web addresses with a login are not checked.');
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host) && !isPublicAddress(host)) throw new BlockedUrlError('That website points to a private address.');
  if (/^(localhost|.*\.local|.*\.internal|.*\.localhost)$/i.test(host)) throw new BlockedUrlError('That website points to a private address.');
  return url;
}

export interface Page {
  status: number;
  finalUrl: string;
  body: string;
  ms: number;
}

const MAX_BYTES = 768 * 1024;
const MAX_REDIRECTS = 4;

function getOnce(url: URL, timeoutMs: number): Promise<{ status: number; location: string | null; body: string }> {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request(
      url,
      {
        method: 'GET',
        lookup: safeLookup,
        // One address at a time (Node's dual-stack racing gives up after 250 ms per address).
        // (Passed through to net.connect; not in the http typings.)
        ...({ autoSelectFamily: false } as object),
        timeout: timeoutMs,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; ByteBunSiteCheck/1.0; +https://bytebuntech.com)',
          Accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.5',
          'Accept-Encoding': 'gzip, deflate, br',
          'Accept-Language': 'en',
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          return resolve({ status, location: res.headers.location, body: '' });
        }
        const enc = String(res.headers['content-encoding'] ?? '').toLowerCase();
        const stream =
          enc === 'gzip' ? res.pipe(zlib.createGunzip()) : enc === 'deflate' ? res.pipe(zlib.createInflate()) : enc === 'br' ? res.pipe(zlib.createBrotliDecompress()) : res;
        const chunks: Buffer[] = [];
        let size = 0;
        let finished = false;
        const done = () => {
          if (finished) return;
          finished = true;
          resolve({ status, location: null, body: Buffer.concat(chunks).toString('utf8') });
        };
        stream.on('data', (c: Buffer) => {
          if (finished) return;
          size += c.length;
          if (size > MAX_BYTES) {
            chunks.push(c.subarray(0, Math.max(0, c.length - (size - MAX_BYTES))));
            done();
            req.destroy();
            return;
          }
          chunks.push(c);
        });
        stream.on('end', done);
        stream.on('error', (e) => (finished ? undefined : reject(e)));
      },
    );
    req.on('timeout', () => req.destroy(new Error('The website took too long to answer.')));
    req.on('error', reject);
    req.end();
  });
}

/** GET a public web page, following up to 4 redirects (each one re-checked). */
export async function fetchPublicPage(raw: string, timeoutMs = 8000): Promise<Page> {
  const started = Date.now();
  let url = assertFetchableUrl(raw);
  for (let i = 0; ; i++) {
    const r = await getOnce(url, timeoutMs);
    if (r.location) {
      if (i >= MAX_REDIRECTS) throw new Error('Too many redirects.');
      url = assertFetchableUrl(new URL(r.location, url).toString());
      continue;
    }
    return { status: r.status, finalUrl: url.toString(), body: r.body, ms: Date.now() - started };
  }
}

// ---- what the page says ----

const BOOKING =
  /calendly\.com|acuityscheduling|squareup\.com\/appointments|square\.site\/book|setmore|simplybook|booksy|fresha|vagaro|zocdoc|mindbody|janeapp|cliniko|opentable|resy\.com|appointlet|youcanbook\.me|tidycal|bookeo|picktime|10to8|leadconnectorhq\.com\/widget\/booking|\bbook (now|online|an? (appointment|visit|consultation|table))\b|\bschedule (an? )?(appointment|consultation|visit|call)\b|\bonline booking\b|\breserve (a )?table\b|\brequest an appointment\b/i;
const CHAT =
  /tawk\.to|widget\.intercom|intercomcdn|crisp\.chat|js\.driftt|drift\.com|livechatinc|tidio|zdassets|zopim|hs-scripts|hubspot\.com\/conversations|fb-customerchat|xfbml\.customerchat|manychat|olark|chatwoot|freshchat|wchat\.freshchat|leadconnectorhq|msgsndr|chat-widget|botpress|landbot|chatbase/i;
const PLATFORMS: [RegExp, string][] = [
  [/wixstatic\.com|wix\.com|_wixCIDX/i, 'Wix'],
  [/squarespace/i, 'Squarespace'],
  [/cdn\.shopify\.com|shopify/i, 'Shopify'],
  [/webflow/i, 'Webflow'],
  [/wp-content|wp-includes|wordpress/i, 'WordPress'],
  [/img1\.wsimg\.com|godaddy/i, 'GoDaddy builder'],
  [/weebly/i, 'Weebly'],
  [/leadconnectorhq|msgsndr/i, 'HighLevel'],
  [/framerusercontent|framer\.com/i, 'Framer'],
  [/duda(mobile)?\.com|multiscreensite/i, 'Duda'],
];

const decode = (s: string) =>
  s.replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

/** Reads the signals out of a homepage's HTML (no network). */
export function analyzeHtml(html: string, now = new Date()) {
  const year = now.getUTCFullYear();
  let copyrightYear: number | null = null;
  for (const m of html.matchAll(/(?:©|&copy;|&#169;|&#xa9;|copyright)[^<]{0,40}/gi)) {
    for (const y of m[0].matchAll(/\b(199\d|20\d\d)\b/g)) {
      const n = Number(y[1]);
      if (n <= year + 1 && (copyrightYear === null || n > copyrightYear)) copyrightYear = n;
    }
  }
  const title = /<title[^>]*>([\s\S]{0,300}?)<\/title>/i.exec(html)?.[1];
  const links = [...html.matchAll(/href\s*=\s*["']([^"'\s>]{8,300})["']/gi)].map((m) => decode(m[1]!)).filter((u) => /^https?:\/\//i.test(u) && socialNetworkOf(u));
  return {
    mobileFriendly: /<meta[^>]+name\s*=\s*["']?viewport/i.test(html),
    onlineBooking: BOOKING.test(html),
    chat: CHAT.test(html),
    copyrightYear,
    platform: PLATFORMS.find(([re]) => re.test(html))?.[1] ?? null,
    title: title ? decode(title).slice(0, 200) || null : null,
    socials: mergeSocials(links),
  };
}

/** The homepage's email, else one from its Contact/About pages (at most 2 more requests). */
async function findSiteEmail(home: Page, fetchPage: (url: string, timeoutMs?: number) => Promise<Page>): Promise<string | null> {
  const onHome = findEmail(home.body, home.finalUrl);
  if (onHome) return onHome;
  for (const url of contactPageUrls(home.body, home.finalUrl)) {
    try {
      const page = await fetchPage(url, 5000);
      if (page.status < 200 || page.status >= 400) continue;
      const email = findEmail(page.body, home.finalUrl);
      if (email) return email;
    } catch {
      // a missing or blocked contact page just means no email from it
    }
  }
  return null;
}

/** Checks a homepage. Never throws: a site that can't be checked comes back as not reachable. */
export async function checkWebsite(raw: string, fetchPage: (url: string, timeoutMs?: number) => Promise<Page> = fetchPublicPage): Promise<WebsiteCheckup> {
  const checkedAt = new Date().toISOString();
  const empty = { mobileFriendly: false, onlineBooking: false, chat: false, copyrightYear: null, platform: null, title: null, socials: [] };
  try {
    let page: Page;
    try {
      page = await fetchPage(normalizeUrl(raw));
    } catch (err) {
      // "example.com" without a scheme: try plain http before calling it down.
      if (/^https?:\/\//i.test(raw.trim()) || err instanceof BlockedUrlError) throw err;
      page = await fetchPage(`http://${raw.trim()}`);
    }
    const ok = page.status >= 200 && page.status < 400;
    return {
      reachable: ok,
      finalUrl: page.finalUrl,
      https: page.finalUrl.startsWith('https://'),
      responseMs: page.ms,
      ...(ok ? analyzeHtml(page.body) : empty),
      email: ok ? await findSiteEmail(page, fetchPage) : null,
      error: ok ? null : `The website answered with an error (HTTP ${page.status}).`,
      checkedAt,
    };
  } catch (err) {
    const blockedUrl = err instanceof BlockedUrlError;
    return {
      reachable: false,
      finalUrl: null,
      https: false,
      responseMs: null,
      ...empty,
      error: blockedUrl ? err.message : 'The website did not load.',
      checkedAt,
      ...(blockedUrl && { blocked: true }),
    };
  }
}
