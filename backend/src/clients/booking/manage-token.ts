// The customer's private cancel/reschedule link, no login needed:
//   https://bookings.bytebuntech.com/manage#t=<bookingId>.<signature>
// signature = HMAC-SHA256(server-only key, "<bookingId>:<nonce>"), the nonce is random per booking.
// The token sits in the URL fragment, so it never reaches server logs or Referer headers; the
// page sends it in the X-Booking-Token header. Links stop working once the booking is cancelled
// or has started (checked by the API, not by the token).
import crypto from 'node:crypto';
import type { AppConfig } from '../../config/config';

export const newNonce = () => crypto.randomBytes(16).toString('hex');

export class ManageTokens {
  private readonly key: Buffer;

  constructor(private readonly cfg: AppConfig) {
    this.key = crypto.createHmac('sha256', cfg.auth.secret).update('bytebun:client-booking-manage:v1').digest();
  }

  private sign(id: number, nonce: string) {
    return crypto.createHmac('sha256', this.key).update(`${id}:${nonce}`).digest('base64url');
  }

  token(id: number, nonce: string) {
    return `${id}.${this.sign(id, nonce)}`;
  }

  url(id: number, nonce: string) {
    return `${this.cfg.clients.bookingsUrl}/manage#t=${this.token(id, nonce)}`;
  }

  parse(token: unknown): { id: number; signature: string } | null {
    if (typeof token !== 'string' || token.length > 200) return null;
    const m = /^(\d{1,10})\.([A-Za-z0-9_-]{43})$/.exec(token.trim());
    return m ? { id: Number(m[1]), signature: m[2] } : null;
  }

  verify(id: number, signature: string, nonce: string) {
    const a = Buffer.from(this.sign(id, nonce));
    const b = Buffer.from(signature);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
}
