// Shared by the affiliate programs: Byte Bun's own (plan payments) and paid events'.
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { formatMoney } from '../booking/money';
import type { ClientsDb, ClientsTx } from '../clients-db';

export const INVITE_DAYS = 14;
/** Paid events: at most this many affiliates each. */
export const MAX_EVENT_AFFILIATES = 5;

export type Decimalish = { toString(): string } | number | string;
export const num = (d: Decimalish | null | undefined) => (d === null || d === undefined ? 0 : Number(d.toString()));
/** 10 -> "10%", 12.5 -> "12.5%" */
export const percentLabel = (d: Decimalish) => `${Number(num(d).toFixed(2))}%`;
export const usd = (cents: number) => formatMoney(cents / 100, 'USD');
export const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');
/** Promo codes: letters and digits, upper case ("maria-10" -> "MARIA10"). */
export const normCode = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, '');

export const sameHash = (a: string, b: string | null) => {
  if (!b || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
};

/** A sign-up link's secret and when it expires. */
export function newInvite() {
  const secret = randomBytes(24).toString('base64url');
  return { secret, hash: sha256(secret), expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000) };
}

export const longDate = (d: Date) => new Intl.DateTimeFormat('en', { dateStyle: 'long', timeZone: 'UTC' }).format(d);

/** Sign-up links: p{id} = Byte Bun's program, e{id} = an event's. */
export function parseInviteToken(token: string) {
  const m = /^([pe])(\d{1,10})\.([A-Za-z0-9_-]{20,64})$/.exec(token.trim());
  return m ? { kind: m[1] === 'p' ? ('plan' as const) : ('event' as const), id: Number(m[2]), hash: sha256(m[3]) } : null;
}

/** A code from the first name plus 4 random characters, e.g. MARIA7K2Q (the caller checks it's free). */
export function codeFromName(firstName: string) {
  const stem = normCode(firstName).replace(/[0-9]/g, '').slice(0, 6) || 'BUN';
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return stem + Array.from({ length: 4 }, () => alphabet[randomInt(alphabet.length)]).join('');
}

/** The person behind an email: found (left as they are) or created. */
export async function personFor(db: ClientsDb | ClientsTx, p: { firstName: string; lastName: string; email: string; phone: string }) {
  const email = p.email.trim().toLowerCase();
  const found = await db.affiliate.findUnique({ where: { email } });
  if (found) return found;
  return db.affiliate.create({ data: { firstName: p.firstName, lastName: p.lastName, email, phone: p.phone } });
}

/** "GCash · Maria Santos · 0917..." */
export const payoutAccount = (a: { payoutProvider: string | null; payoutAccountName: string | null; payoutAccountNumber: string | null }) =>
  a.payoutProvider ? [a.payoutProvider, a.payoutAccountName, a.payoutAccountNumber].filter(Boolean).join(' · ') : null;

export const payoutOf = (a: { payoutMethod: string | null; payoutProvider: string | null; payoutAccountName: string | null; payoutAccountNumber: string | null }) =>
  a.payoutMethod ? { method: a.payoutMethod, provider: a.payoutProvider, accountName: a.payoutAccountName, accountNumber: a.payoutAccountNumber } : null;
