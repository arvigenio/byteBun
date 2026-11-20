// Which product this page is (from the host), and the URLs between the client hosts.
//   accounts.*      sign-in, invitations, new business
//   bookings.*      the standalone Bookings app (/app) and public booking pages (/{slug})
//   clientportal.*  the client portal (Bookings at /bookings)
export function detectSurface(hostname = window.location.hostname) {
  const label = hostname.split('.')[0];
  if (label === 'clientportal') return 'portal';
  if (label === 'accounts') return 'accounts';
  return 'bookings';
}

export const surface = detectSurface();

export const PRODUCT = {
  bookings: { name: 'Byte Bun Bookings', short: 'Bookings' },
  portal: { name: 'Byte Bun Client Portal', short: 'Client Portal' },
  accounts: { name: 'Byte Bun', short: 'Accounts' },
}[surface];

/** Where the Bookings app lives on this host. */
export const bookingsBase = surface === 'portal' ? '/bookings' : '/app';

/** Only follow ?next= to our own client hosts. */
export function safeNext(next, cfg) {
  if (!next) return null;
  try {
    const u = new URL(next, window.location.origin);
    const allowed = [window.location.origin, cfg?.accountsUrl, cfg?.bookingsUrl, cfg?.portalUrl].filter(Boolean).map((o) => new URL(o).origin);
    return allowed.includes(u.origin) ? u.toString() : null;
  } catch {
    return null;
  }
}

/** The sign-in page: on accounts when the session is shared across hosts, else this host. */
export function signInUrl(cfg, next = window.location.href) {
  const base = cfg?.sharedSignIn ? cfg.accountsUrl : window.location.origin;
  return `${base}/sign-in?next=${encodeURIComponent(next)}`;
}

export function welcomeUrl(cfg) {
  const base = cfg?.sharedSignIn ? cfg.accountsUrl : window.location.origin;
  return `${base}/welcome`;
}

/** Where a business lands: its only app, or the portal. */
export function landingUrl(cfg, business) {
  if (!cfg) return '/app';
  if (business?.landing === 'portal') return `${cfg.portalUrl}/`;
  return `${cfg.bookingsUrl}/app`;
}

export const go = (url) => window.location.assign(url);
