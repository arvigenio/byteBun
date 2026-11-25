// One app, one UI, several hosts. The host decides the look:
//   accounts.bytebuntech.com      sign-in, invitations, new business setup
//   bookings.bytebuntech.com      the standalone Bookings app + public booking pages /{slug}
//   clientportal.bytebuntech.com  the client portal shell (Bookings is one app inside it)
//   scanner.bytebuntech.com       event check-in scanners: /{business}/{event}/{scanner id} (access code, no sign-in)
//   anything else                 the Byte Bun site and admin (bytebuntech.com)
import type { AppConfig } from '../config/config';

export type Surface = 'accounts' | 'bookings' | 'portal' | 'scanner' | 'main';

const hostnameOf = (url: string) => new URL(url).hostname.toLowerCase();

export function surfaceOf(cfg: AppConfig, hostHeader: string | undefined): Surface {
  const host = (hostHeader ?? '').toLowerCase().replace(/:\d+$/, '');
  if (!host) return 'main';
  if (host === hostnameOf(cfg.clients.accountsUrl)) return 'accounts';
  if (host === hostnameOf(cfg.clients.bookingsUrl)) return 'bookings';
  if (host === hostnameOf(cfg.clients.portalUrl)) return 'portal';
  if (host === hostnameOf(cfg.clients.scannerUrl)) return 'scanner';
  return 'main';
}

export const isClientSurface = (s: Surface) => s !== 'main';

/** Public booking page slugs may not be one of the app's own paths on the bookings host. */
export const RESERVED_SLUGS = new Set([
  'api', 'app', 'assets', 'admin', 'sign-in', 'sign-out', 'signin', 'login', 'logout', 'welcome', 'invite', 'manage', 'settings',
  'bookings', 'booking', 'portal', 'help', 'support', 'about', 'pricing', 'terms', 'privacy', 'static', 'icons', 'favicon.ico',
  'manifest', 'sw.js', 'robots.txt', 'sitemap.xml', 'bytebun', 'byte-bun', 'www', 'account', 'accounts', 'dashboard',
]);
