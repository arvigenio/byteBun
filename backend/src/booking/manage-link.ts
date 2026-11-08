// The lead's private link to reschedule or cancel their call:
//   https://bytebuntech.com/manage-booking#t=<leadId>.<signature>
//
//  - signature = HMAC-SHA256(key, "<leadId>:<nonce>"), where the key is derived from
//    BETTER_AUTH_SECRET (server only) and the nonce is a random value stored on the lead.
//    A database leak alone can't produce working links, and guessing one is hopeless (256 bits).
//  - The token is in the URL fragment (#), which browsers never send to servers, so it doesn't
//    end up in access logs, proxies or Referer headers. The page reads it and sends it in a header.
//  - A new nonce revokes every earlier link for that lead.
import crypto from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/config';

export const MANAGE_PATH = '/manage-booking';

@Injectable()
export class ManageLinks {
  private readonly key: Buffer;

  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig) {
    this.key = crypto.createHmac('sha256', cfg.auth.secret).update('bytebun:booking-manage-links:v1').digest();
  }

  newNonce(): string {
    return crypto.randomBytes(16).toString('hex');
  }

  private sign(leadId: number, nonce: string): string {
    return crypto.createHmac('sha256', this.key).update(`${leadId}:${nonce}`).digest('base64url');
  }

  token(leadId: number, nonce: string): string {
    return `${leadId}.${this.sign(leadId, nonce)}`;
  }

  url(leadId: number, nonce: string): string {
    return `${this.cfg.booking.siteUrl}${MANAGE_PATH}#t=${this.token(leadId, nonce)}`;
  }

  /** The lead id a token claims to be for (still to be verified against that lead's nonce). */
  parse(token: unknown): { leadId: number; signature: string } | null {
    if (typeof token !== 'string' || token.length > 200) return null;
    const m = /^(\d{1,10})\.([A-Za-z0-9_-]{43})$/.exec(token.trim());
    return m ? { leadId: Number(m[1]), signature: m[2] } : null;
  }

  verify(leadId: number, signature: string, nonce: string | null): boolean {
    if (!nonce) return false;
    const expected = Buffer.from(this.sign(leadId, nonce));
    const given = Buffer.from(signature);
    return expected.length === given.length && crypto.timingSafeEqual(expected, given);
  }
}
