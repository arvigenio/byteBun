// Paid events' promo codes (set on the event's Details tab).
//
//   A code (upper case, unique per event) takes an amount or a percentage off the price, per place.
//   usageLimit: how many places can use it (1 = one-time, null = unlimited); `used` counts them.
//   Optional expiry (the end of a date, in the event's time zone). Inactive codes don't apply.
//   Bulk (several places at once): it applies place by place until its uses run out, so with 5
//   uses left and 7 places, 5 are discounted and 2 pay the full price.
//   Uses are taken when a registration is made (the promo row is locked meanwhile), and never
//   given back: a registration that's later rejected or refunded still used it.
//
//   GET    /api/client/bookings/events/:id/promo-codes
//   POST   /api/client/bookings/events/:id/promo-codes          { code, discountType, discountValue, usageLimit, expiresOn, active }
//   PATCH  /api/client/bookings/events/:id/promo-codes/:pid     same, partial
//   DELETE /api/client/bookings/events/:id/promo-codes/:pid     places that used it keep their discount
//   GET    /api/client/bookings/events/:id/promo-codes/quote?code=&quantity=&amount=   Manual Register's quote
//   GET    /api/public/bookings/:slug/events/:event/promo?code=&quantity=   a quote (nothing is used up)
import { Body, Controller, Delete, Get, Header, Param, ParseIntPipe, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import * as yup from 'yup';
import { ApiError } from '../../common/api-error';
import { StrictRateLimit } from '../../common/rate-limit';
import { YupValidationPipe } from '../../common/yup-validation.pipe';
import { ClientsDb, type ClientsTx } from '../clients-db';
import { ClientRoute, type ClientContext } from '../client-context';
import { publicEvent, zoneOf } from './events';
import { formatMoney } from './money';
import { addDays, fromLocal, isDate, toLocal } from './time';
import { EVENT_ROUTES } from '../roles';

const ctx = (req: Request) => req.client as ClientContext;

type Promo = NonNullable<Awaited<ReturnType<ClientsDb['eventPromoCode']['findFirst']>>>;
type EventLike = { id: number; organizationId: string; price: unknown; currency: string | null; timeZone: string | null };

export const normalizeCode = (v: string) => v.trim().toUpperCase().replace(/\s+/g, '');

const promoSchema = yup.object({
  code: yup
    .string()
    .trim()
    .transform((v) => (typeof v === 'string' ? normalizeCode(v) : v))
    .matches(/^[A-Z0-9_-]{3,30}$/, 'Use 3-30 letters, numbers, dashes or underscores.')
    .required('Please enter the code.'),
  discountType: yup.string().oneOf(['amount', 'percent'], 'Choose an amount or a percentage.').required('Choose an amount or a percentage.'),
  discountValue: yup
    .number()
    .typeError('Please enter the discount as a number.')
    .min(0.01, 'Please enter the discount.')
    .max(10_000_000)
    .required('Please enter the discount.')
    .test('percent', 'A percentage is at most 100.', function (v) {
      return this.parent.discountType !== 'percent' || v === undefined || v <= 100;
    }),
  /** null = unlimited; 1 = one-time. */
  usageLimit: yup
    .number()
    .integer()
    .min(1, 'At least 1 use.')
    .max(100_000)
    .nullable()
    .transform((v, raw) => (raw === '' || raw === null ? null : v)),
  /** The last day it works (in the event's time zone), or null. */
  expiresOn: yup
    .string()
    .nullable()
    .test('date', 'Please choose a date.', (v) => !v || isDate(v)),
  active: yup.boolean().default(true),
});
const promoPatchSchema = promoSchema.partial();

/** The discount for one place at this price (never more than the price). */
export function discountFor(p: { discountType: string; discountValue: unknown }, unitPrice: number) {
  const v = Number(p.discountValue);
  const d = p.discountType === 'percent' ? (unitPrice * v) / 100 : v;
  return Math.round(Math.min(unitPrice, Math.max(0, d)) * 100) / 100;
}

/** Why a code can't be used now, or null. */
function unusable(p: Promo | null, now = new Date()) {
  if (!p || !p.active) return 'This promo code isn’t valid for this event.';
  if (p.expiresAt && p.expiresAt <= now) return 'This promo code has expired.';
  if (p.usageLimit !== null && p.used >= p.usageLimit) return 'This promo code has been used up.';
  return null;
}

export const promoLabel = (p: { discountType: string; discountValue: unknown }, currency: string | null) =>
  p.discountType === 'percent' ? `${Number(p.discountValue)}% off` : `${formatMoney(Number(p.discountValue), currency ?? 'PHP')} off`;

/**
 * What a code would do for `quantity` places at the event's price: how many qualify (uses left),
 * the price per place with and without it, and the total. Nothing is used up.
 */
export async function quotePromo(db: ClientsDb | ClientsTx, e: EventLike, rawCode: string | null | undefined, quantity: number, unitPrice?: number) {
  const price = unitPrice ?? (e.price === null || e.price === undefined ? 0 : Number(e.price));
  const currency = e.currency ?? 'PHP';
  const code = rawCode ? normalizeCode(rawCode) : '';
  const full = Math.round(price * quantity * 100) / 100;
  const base = { code: code || null, quantity, unitPrice: price, currency, totalWithout: full, totalWithoutLabel: formatMoney(full, currency) };
  if (!code) return { ...base, valid: false, reason: null as string | null, qualified: 0, discountPerPlace: 0, totalDiscount: 0, total: full, totalLabel: formatMoney(full, currency), label: null as string | null };
  const p = await db.eventPromoCode.findFirst({ where: { eventId: e.id, code } });
  const reason = unusable(p);
  if (reason || !p) return { ...base, valid: false, reason, qualified: 0, discountPerPlace: 0, totalDiscount: 0, total: full, totalLabel: formatMoney(full, currency), label: null };
  const left = p.usageLimit === null ? quantity : Math.max(0, p.usageLimit - p.used);
  const qualified = Math.min(quantity, left);
  const per = discountFor(p, price);
  const totalDiscount = Math.round(per * qualified * 100) / 100;
  const total = Math.round((full - totalDiscount) * 100) / 100;
  return { ...base, valid: true, reason: null, qualified, discountPerPlace: per, totalDiscount, total, totalLabel: formatMoney(total, currency), label: promoLabel(p, currency), discountLabel: formatMoney(totalDiscount, currency), perPlaceWithLabel: formatMoney(price - per, currency) };
}

/**
 * Takes up to `quantity` uses of a code inside a transaction (the row is locked, so two
 * registrations at once can't both take the last use). Returns the promo and how many places got it.
 */
export async function takePromo(tx: ClientsTx, eventId: number, rawCode: string | null | undefined, quantity: number) {
  if (!rawCode) return { promo: null, granted: 0 };
  const code = normalizeCode(rawCode);
  const rows = await tx.$queryRaw<{ id: number }[]>`SELECT "id" FROM "booking"."event_promo_codes" WHERE "event_id" = ${eventId} AND "code" = ${code} FOR UPDATE`;
  const p = rows.length ? await tx.eventPromoCode.findUnique({ where: { id: rows[0].id } }) : null;
  const reason = unusable(p);
  if (reason || !p) throw new ApiError(400, { error: 'bad_promo', message: reason ?? 'This promo code isn’t valid for this event.', fields: { promoCode: reason ?? 'Not valid.' } });
  const granted = Math.min(quantity, p.usageLimit === null ? quantity : p.usageLimit - p.used);
  await tx.eventPromoCode.update({ where: { id: p.id }, data: { used: { increment: granted } } });
  return { promo: p, granted };
}

const row = (p: Promo, e: { currency: string | null; timeZone: string | null }, businessTz: string) => ({
  id: p.id,
  code: p.code,
  discountType: p.discountType,
  discountValue: Number(p.discountValue),
  label: promoLabel(p, e.currency),
  usageLimit: p.usageLimit,
  used: p.used,
  expiresAt: p.expiresAt,
  // The last day it works, in the event's time zone.
  expiresOn: p.expiresAt ? toLocal(new Date(p.expiresAt.getTime() - 1), zoneOf(e, businessTz)).date : null,
  active: p.active,
  status: unusable(p) === null ? 'active' : !p.active ? 'off' : p.expiresAt && p.expiresAt <= new Date() ? 'expired' : 'used_up',
});

@Controller('client/bookings/events/:id/promo-codes')
export class EventPromosController {
  constructor(private readonly db: ClientsDb) {}

  private async event(orgId: string, id: number) {
    const e = await this.db.event.findFirst({ where: { id, organizationId: orgId } });
    if (!e) throw new ApiError(404, { error: 'not_found', message: 'That event does not exist.' });
    const s = await this.db.bookingSettings.findUnique({ where: { organizationId: orgId }, select: { timeZone: true } });
    return { e, tz: s?.timeZone ?? 'UTC' };
  }

  /** "2026-12-31" -> the end of that day in the event's zone. At the latest, the day before the event. */
  private expiry(date: string | null | undefined, e: { timeZone: string | null; startsAt: Date }, tz: string) {
    if (date === undefined) return undefined;
    if (date) {
      const eventDay = toLocal(e.startsAt, zoneOf(e, tz)).date;
      if (date >= eventDay) throw new ApiError(400, { error: 'validation_failed', message: 'A promo code can last until the day before the event at the latest.', fields: { expiresOn: `At the latest ${addDays(eventDay, -1)}.` } });
    }
    return date ? fromLocal(addDays(date, 1), 0, zoneOf(e, tz)) : null;
  }

  @Get()
  @ClientRoute(EVENT_ROUTES.promotions)
  async list(@Req() req: Request, @Param('id', ParseIntPipe) id: number) {
    const { e, tz } = await this.event(ctx(req).org.id, id);
    // Affiliates' codes are managed on the Affiliates tab (event-affiliates.ts).
    const promos = await this.db.eventPromoCode.findMany({ where: { eventId: id, affiliate: null }, orderBy: { createdAt: 'asc' } });
    return { promoCodes: promos.map((p) => row(p, e, tz)) };
  }

  /** Manual Register's quote: how many of `quantity` places a code covers, at `amount` per place. */
  @Get('quote')
  @ClientRoute(EVENT_ROUTES.attendees)
  async quote(@Req() req: Request, @Param('id', ParseIntPipe) id: number, @Query('code') code?: string, @Query('quantity') quantity?: string, @Query('amount') amount?: string) {
    const { e } = await this.event(ctx(req).org.id, id);
    if (e.kind !== 'paid') throw new ApiError(409, { error: 'free_event', message: 'Promo codes are for paid events.' });
    const n = Math.min(500, Math.max(1, Number.parseInt(quantity ?? '1', 10) || 1));
    const per = amount !== undefined && amount !== '' && Number.isFinite(Number(amount)) ? Number(amount) : undefined;
    const q = await quotePromo(this.db, e, (code ?? '').slice(0, 40), n);
    if (per === undefined || !q.valid) return q;
    // The places it covers pay (amount − discount), the rest pay the amount.
    const total = Math.round((Math.max(0, per - q.discountPerPlace) * q.qualified + per * (n - q.qualified)) * 100) / 100;
    const without = Math.round(per * n * 100) / 100;
    const cur = e.currency ?? 'PHP';
    return { ...q, total, totalLabel: formatMoney(total, cur), totalWithout: without, totalWithoutLabel: formatMoney(without, cur) };
  }

  @Post()
  @ClientRoute(EVENT_ROUTES.promotions)
  async create(@Req() req: Request, @Param('id', ParseIntPipe) id: number, @Body(new YupValidationPipe(promoSchema)) body: yup.InferType<typeof promoSchema>) {
    const c = ctx(req);
    const { e, tz } = await this.event(c.org.id, id);
    if (e.kind !== 'paid') throw new ApiError(409, { error: 'free_event', message: 'Promo codes are for paid events.' });
    try {
      const p = await this.db.eventPromoCode.create({
        data: { eventId: id, organizationId: c.org.id, code: body.code, discountType: body.discountType, discountValue: body.discountValue, usageLimit: body.usageLimit ?? null, expiresAt: this.expiry(body.expiresOn, e, tz) ?? null, active: body.active },
      });
      return row(p, e, tz);
    } catch (err) {
      if ((err as { code?: string })?.code === 'P2002') throw new ApiError(409, { error: 'code_taken', message: 'This event already has that code.', fields: { code: 'Already used.' } });
      throw err;
    }
  }

  @Patch(':pid')
  @ClientRoute(EVENT_ROUTES.promotions)
  async update(@Req() req: Request, @Param('id', ParseIntPipe) id: number, @Param('pid', ParseIntPipe) pid: number, @Body(new YupValidationPipe(promoPatchSchema)) body: yup.InferType<typeof promoPatchSchema>) {
    const { e, tz } = await this.event(ctx(req).org.id, id);
    if (e.kind !== 'paid') throw new ApiError(409, { error: 'free_event', message: 'Promo codes are for paid events.' });
    const before = await this.db.eventPromoCode.findFirst({ where: { id: pid, eventId: id, affiliate: null } });
    if (!before) throw new ApiError(404, { error: 'not_found', message: 'That promo code does not exist.' });
    if (body.discountType === 'percent' || (body.discountType === undefined && before.discountType === 'percent')) {
      const v = body.discountValue ?? Number(before.discountValue);
      if (v > 100) throw new ApiError(400, { error: 'validation_failed', message: 'A percentage is at most 100.', fields: { discountValue: 'At most 100.' } });
    }
    if (body.usageLimit !== undefined && body.usageLimit !== null && body.usageLimit < before.used) {
      throw new ApiError(400, { error: 'validation_failed', message: `It has already been used ${before.used} times.`, fields: { usageLimit: `At least ${before.used}.` } });
    }
    const data: Record<string, unknown> = {};
    for (const k of ['code', 'discountType', 'discountValue', 'usageLimit', 'active'] as const) if (body[k] !== undefined) data[k] = body[k];
    const exp = this.expiry(body.expiresOn, e, tz);
    if (exp !== undefined) data.expiresAt = exp;
    try {
      return row(await this.db.eventPromoCode.update({ where: { id: pid }, data }), e, tz);
    } catch (err) {
      if ((err as { code?: string })?.code === 'P2002') throw new ApiError(409, { error: 'code_taken', message: 'This event already has that code.', fields: { code: 'Already used.' } });
      throw err;
    }
  }

  @Delete(':pid')
  @ClientRoute(EVENT_ROUTES.promotions)
  async remove(@Req() req: Request, @Param('id', ParseIntPipe) id: number, @Param('pid', ParseIntPipe) pid: number) {
    await this.event(ctx(req).org.id, id);
    const { count } = await this.db.eventPromoCode.deleteMany({ where: { id: pid, eventId: id, affiliate: null } });
    if (!count) throw new ApiError(404, { error: 'not_found', message: 'That promo code does not exist.' });
    return { ok: true };
  }
}

/** The registration page's quote: the price with and without a code. */
@Controller('public/bookings/:slug/events')
export class PublicPromoController {
  constructor(private readonly db: ClientsDb) {}

  @Get(':event/promo')
  @Header('Cache-Control', 'no-store')
  @StrictRateLimit()
  async quote(@Param('slug') slug: string, @Param('event') eventSlug: string, @Query('code') code?: string, @Query('quantity') quantity?: string) {
    const { e } = await publicEvent(this.db, slug, eventSlug);
    if (e.kind !== 'paid') throw new ApiError(409, { error: 'free_event', message: 'This event is free.' });
    const n = Math.min(500, Math.max(1, Number.parseInt(quantity ?? '1', 10) || 1));
    return quotePromo(this.db, e, (code ?? '').slice(0, 40), n);
  }
}
