// Who is signing in: IP, rough location, and browser, for rate limits, alert emails and the
// sign-in code email.
//
// The client IP comes from clientIp() (common/client-ip.ts), which trusts CF-Connecting-IP only
// when the request really came through Cloudflare. A raw X-Forwarded-For header can be set by
// anyone, so Better Auth never reads it. Instead this middleware writes the verified values into
// internal headers that Better Auth is configured to read (advanced.ipAddress.ipAddressHeaders),
// after deleting any copy the client sent.
import type { NextFunction, Request, Response } from 'express';
import { clientIp, isCloudflareIp } from '../common/client-ip';

export const CLIENT_IP_HEADER = 'x-bytebun-client-ip';
const CLIENT_GEO_HEADER = 'x-bytebun-client-geo';

// Cloudflare adds the country always, and city/region when "Add visitor location headers" is on.
const CF_GEO_HEADERS = ['cf-ipcity', 'cf-region', 'cf-ipcountry'];

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() ?? '';

export function requestMeta(req: Request, _res: Response, next: NextFunction) {
  delete req.headers[CLIENT_IP_HEADER];
  delete req.headers[CLIENT_GEO_HEADER];
  req.headers[CLIENT_IP_HEADER] = clientIp(req);

  const peer = req.ip || req.socket?.remoteAddress || '';
  if (isCloudflareIp(peer)) {
    const geo = CF_GEO_HEADERS.map((h) => one(req.headers[h]))
      .filter((v) => v && v !== 'XX' && v !== 'T1')
      .join(', ');
    // Header values must be ASCII; city names may not be.
    if (geo) req.headers[CLIENT_GEO_HEADER] = encodeURIComponent(geo.slice(0, 120));
  }
  next();
}

export interface RequestMeta {
  ip: string;
  location: string;
  userAgent: string;
}

/** Reads what requestMeta() stored, from Fetch API headers (inside Better Auth). */
export function readRequestMeta(headers: Headers | undefined | null): RequestMeta {
  const geo = headers?.get(CLIENT_GEO_HEADER) ?? '';
  let location = 'unknown';
  try {
    if (geo) location = decodeURIComponent(geo);
  } catch {
    /* keep "unknown" */
  }
  return {
    ip: headers?.get(CLIENT_IP_HEADER) || 'unknown',
    location,
    userAgent: (headers?.get('user-agent') ?? 'unknown').slice(0, 300),
  };
}
