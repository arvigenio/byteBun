// Paid events' affiliates (the event's Affiliates tab): up to 5 people per event who promote it.
//
//   The business adds one (first/last name, email, phone, the attendee discount % and their
//   commission %). Their promo code is an ordinary event promo code (percentage off, unlimited
//   uses) linked to them, so the registration page, bulk bookings and quotes work as usual; it
//   is hidden from the Promo codes tab and works only while the affiliate is active.
//   They're emailed a proposal with a sign-up link ({AFFILIATES_URL}/join#t=e{id}.{secret});
//   accepting it (affiliates/affiliate-portal.ts) activates the code and emails a welcome.
//
//   A spot counts as a verified referral once its payment is verified (status confirmed); spots
//   reserved / for verification / waitlisted / rejected are pending. Earned = commission % of what
//   each verified spot paid (amountPaid, else price minus discount). Rejected, expired and
//   cancelled registrations drop out by themselves. The business pays the affiliate itself and
//   records each payout here (the affiliate is emailed); balance = earned - paid out.
//
//   GET    /api/client/bookings/events/:id/affiliates               ranked by verified referrals
//   POST   /api/client/bookings/events/:id/affiliates               { firstName, lastName, email, phone, discountPercent, commissionPercent, promoCode? }
//   PATCH  /api/client/bookings/events/:id/affiliates/:aid          { firstName?, lastName?, phone?, discountPercent?, commissionPercent?, status? }
//   POST   /api/client/bookings/events/:id/affiliates/:aid/resend   a new sign-up link
//   DELETE /api/client/bookings/events/:id/affiliates/:aid          only while nobody used the code
//   POST   /api/client/bookings/events/:id/affiliates/:aid/payouts  { amount, reference? }
import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseIntPipe, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import * as yup from 'yup';
import { MAILER } from '../../auth/auth.module';
import type { Mailer } from '../../auth/mailer';
import { ApiError } from '../../common/api-error';
import { YupValidationPipe } from '../../common/yup-validation.pipe';
import { APP_CONFIG, type AppConfig } from '../../config/config';
import { logger } from '../../logging/logger';
import { codeFromName, longDate, MAX_EVENT_AFFILIATES, newInvite, normCode, num, payoutAccount, payoutOf, percentLabel, personFor } from '../affiliates/affiliate-common';
import { affiliateProposalMail, commissionPaidMail, type AffiliateOffer } from '../affiliates/affiliate-emails';
import { ClientsDb, type ClientsTx } from '../clients-db';
import { ClientRoute, type ClientContext } from '../client-context';
import { zoneOf } from './events';
import { formatMoney } from './money';
import { EVENT_ROUTES } from '../roles';

const ctx = (req: Request) => req.client as ClientContext;

/** Statuses of a spot whose payment isn't verified yet. */
export const PENDING_STATUSES = ['reserved', 'review', 'waitlist', 'rejected'];
const round2 = (n: number) => Math.round(n * 100) / 100;

const name = () => yup.string().trim().min(1, 'Required.').max(60, 'At most 60 characters.');
const phone = () => yup.string().trim().matches(/^[0-9+()\-.\s]{5,40}$/, 'Please enter a phone number.');
const percent = (max: number) => yup.number().typeError('Please enter a number.').min(0, 'At least 0.').max(max, `At most ${max}.`);
export const affiliateSchema = yup.object({
  firstName: name().required('Required.'),
  lastName: name().required('Required.'),
  email: yup.string().trim().lowercase().email('Please enter a valid email.').max(254).required('Required.'),
  phone: phone().required('Required.'),
  discountPercent: percent(99).required('Required.'),
  commissionPercent: percent(100).required('Required.'),
  promoCode: yup
    .string()
    .trim()
    .transform((v) => (typeof v === 'string' ? normCode(v) : v))
    .nullable()
    .transform((v) => (v === '' ? null : v))
    .matches(/^[A-Z0-9]{4,20}$/, { message: 'Use 4-20 letters and numbers.', excludeEmptyString: true }),
});
const patchSchema = yup.object({
  firstName: name(),
  lastName: name(),
  phone: phone(),
  discountPercent: percent(99),
  commissionPercent: percent(100),
  status: yup.string().oneOf(['active', 'disabled']),
});
const payoutSchema = yup.object({
  amount: yup.number().typeError('Please enter the amount.').moreThan(0, 'More than 0.').max(10_000_000).required('Please enter the amount.'),
  reference: yup.string().trim().max(120).nullable().transform((v) => (v === '' ? null : v)),
});

type Ticket = { status: string; amountPaid: unknown; discount: unknown };
type EventPrice = { price: unknown };

/** A spot's verified payment (what the commission is a percentage of). */
const paidFor = (t: Ticket, e: EventPrice) => (t.amountPaid !== null && t.amountPaid !== undefined ? Number(t.amountPaid) : Math.max(0, Number(e.price ?? 0) - Number(t.discount ?? 0)));

/** Verified / pending spots, earned, paid out and the balance for one event affiliate. */
export function affiliateStats(tickets: Ticket[], e: EventPrice, commissionPercent: unknown, payouts: { amount: unknown }[]) {
  const verified = tickets.filter((t) => t.status === 'confirmed');
  const earned = round2(verified.reduce((n, t) => n + (paidFor(t, e) * num(commissionPercent as never)) / 100, 0));
  const paidOut = round2(payouts.reduce((n, p) => n + Number(p.amount), 0));
  return {
    verifiedSpots: verified.length,
    pendingSpots: tickets.filter((t) => PENDING_STATUSES.includes(t.status)).length,
    collected: round2(verified.reduce((n, t) => n + paidFor(t, e), 0)),
    earned,
    paidOut,
    balance: round2(earned - paidOut),
  };
}

/** Everything one event affiliate needs, with stats. Used by the business and the portal. */
export async function eventAffiliateRows(db: ClientsDb | ClientsTx, where: { eventId?: number; affiliateId?: number; id?: number }) {
  const rows = await db.eventAffiliate.findMany({
    where,
    orderBy: { createdAt: 'asc' },
    include: { promo: true, payouts: { orderBy: { createdAt: 'desc' } }, affiliate: true, event: true },
  });
  const tickets = rows.length
    ? await db.eventTicket.findMany({ where: { promoCodeId: { in: rows.map((r) => r.promoCodeId) } }, select: { id: true, promoCodeId: true, status: true, amountPaid: true, discount: true, name: true, createdAt: true, groupId: true } })
    : [];
  return rows.map((r) => {
    const mine = tickets.filter((t) => t.promoCodeId === r.promoCodeId);
    return { row: r, tickets: mine, stats: affiliateStats(mine, r.event, r.commissionPercent, r.payouts) };
  });
}

@Controller('client/bookings/events/:id/affiliates')
export class EventAffiliatesController {
  constructor(
    private readonly db: ClientsDb,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    @Inject(MAILER) private readonly mailer: Mailer,
  ) {}

  private async event(orgId: string, id: number) {
    const e = await this.db.event.findFirst({ where: { id, organizationId: orgId } });
    if (!e) throw new ApiError(404, { error: 'not_found', message: 'That event does not exist.' });
    return e;
  }

  private async one(eventId: number, aid: number) {
    const a = await this.db.eventAffiliate.findFirst({ where: { id: aid, eventId }, include: { promo: true, affiliate: true, event: true } });
    if (!a) throw new ApiError(404, { error: 'not_found', message: 'That affiliate does not exist.' });
    return a;
  }

  /** What the emails say about this event's program. */
  private async offer(a: { firstName: string; lastName: string; email: string; promo: { code: string; discountValue: unknown }; commissionPercent: unknown; event: { title: string; startsAt: Date; timeZone: string | null; slug: string; organizationId: string } }): Promise<AffiliateOffer> {
    const [org, settings] = await Promise.all([
      this.db.organization.findUnique({ where: { id: a.event.organizationId }, select: { name: true } }),
      this.db.bookingSettings.findUnique({ where: { organizationId: a.event.organizationId }, select: { slug: true, timeZone: true } }),
    ]);
    const tz = zoneOf(a.event, settings?.timeZone ?? 'UTC');
    const when = new Intl.DateTimeFormat('en', { dateStyle: 'full', timeStyle: 'short', timeZone: tz }).format(a.event.startsAt);
    return {
      kind: 'event',
      firstName: a.firstName,
      lastName: a.lastName,
      email: a.email,
      promoCode: a.promo.code,
      discount: percentLabel(a.promo.discountValue as never),
      commission: percentLabel(a.commissionPercent as never),
      owner: org?.name ?? 'The organizer',
      event: { title: a.event.title, when, url: `${this.cfg.clients.bookingsUrl}/${settings?.slug ?? ''}/e/${a.event.slug}` },
    };
  }

  private async invite(aid: number) {
    const inv = newInvite();
    const a = await this.db.eventAffiliate.update({ where: { id: aid }, data: { inviteHash: inv.hash, inviteExpiresAt: inv.expiresAt, invitedAt: new Date() }, include: { promo: true, event: true } });
    const url = `${this.cfg.clients.affiliatesUrl}/join#t=e${aid}.${inv.secret}`;
    this.mailer.sendInBackground(affiliateProposalMail(this.cfg, await this.offer(a), { url, expires: longDate(inv.expiresAt) }));
  }

  private present(x: Awaited<ReturnType<typeof eventAffiliateRows>>[number], currency: string) {
    const r = x.row;
    return {
      id: r.id,
      firstName: r.firstName,
      lastName: r.lastName,
      email: r.email,
      phone: r.phone,
      promoCode: r.promo.code,
      discountPercent: num(r.promo.discountValue as never),
      commissionPercent: num(r.commissionPercent as never),
      status: r.status,
      invitedAt: r.invitedAt,
      inviteExpiresAt: r.inviteExpiresAt,
      joinedAt: r.joinedAt,
      // Where to send their money (once they've signed up).
      payout: r.joinedAt ? payoutOf(r.affiliate) : null,
      stats: x.stats,
      currency,
      labels: { collected: formatMoney(x.stats.collected, currency), earned: formatMoney(x.stats.earned, currency), paidOut: formatMoney(x.stats.paidOut, currency), balance: formatMoney(x.stats.balance, currency) },
      payouts: r.payouts.map((p) => ({ id: p.id, amount: Number(p.amount), amountLabel: formatMoney(Number(p.amount), p.currency), reference: p.reference, createdBy: p.createdBy, createdAt: p.createdAt })),
    };
  }

  /** Ranked by verified referrals (then pending, then earliest added). */
  @Get()
  @ClientRoute(EVENT_ROUTES.promotions)
  async list(@Req() req: Request, @Param('id', ParseIntPipe) id: number) {
    const e = await this.event(ctx(req).org.id, id);
    const currency = e.currency ?? 'PHP';
    const rows = (await eventAffiliateRows(this.db, { eventId: id })).map((x) => this.present(x, currency));
    rows.sort((a, b) => b.stats.verifiedSpots - a.stats.verifiedSpots || b.stats.pendingSpots - a.stats.pendingSpots);
    return { max: MAX_EVENT_AFFILIATES, paid: e.kind === 'paid', affiliates: rows.map((r, i) => ({ ...r, rank: i + 1 })) };
  }

  @Post()
  @ClientRoute(EVENT_ROUTES.promotions)
  async add(@Req() req: Request, @Param('id', ParseIntPipe) id: number, @Body(new YupValidationPipe(affiliateSchema)) body: yup.InferType<typeof affiliateSchema>) {
    const c = ctx(req);
    const e = await this.event(c.org.id, id);
    if (e.kind !== 'paid') throw new ApiError(409, { error: 'not_paid', message: 'Affiliates are for paid events (attendees pay to attend).' });
    const created = await this.db.$transaction(async (tx) => {
      // Lock the event so two adds at once can't both take the 5th place.
      await tx.$queryRaw`SELECT "id" FROM "booking"."events" WHERE "id" = ${id} FOR UPDATE`;
      if (await tx.eventAffiliate.findFirst({ where: { eventId: id, affiliate: { email: body.email } } })) {
        throw new ApiError(409, { error: 'already_affiliate', message: 'This person is already an affiliate for this event.', fields: { email: 'Already an affiliate here.' } });
      }
      if ((await tx.eventAffiliate.count({ where: { eventId: id } })) >= MAX_EVENT_AFFILIATES) {
        throw new ApiError(403, { error: 'affiliate_limit', message: `An event can have up to ${MAX_EVENT_AFFILIATES} affiliates. Remove one to add another.` });
      }
      const person = await personFor(tx, body);
      let code = body.promoCode ?? codeFromName(body.firstName);
      while (!body.promoCode && (await tx.eventPromoCode.findFirst({ where: { eventId: id, code } }))) code = codeFromName(body.firstName);
      if (await tx.eventPromoCode.findFirst({ where: { eventId: id, code } })) throw new ApiError(409, { error: 'code_taken', message: 'This event already has that code.', fields: { promoCode: 'Already used.' } });
      // Off until they accept the proposal.
      const promo = await tx.eventPromoCode.create({ data: { eventId: id, organizationId: c.org.id, code, discountType: 'percent', discountValue: body.discountPercent, usageLimit: null, active: false } });
      return tx.eventAffiliate.create({
        data: { eventId: id, organizationId: c.org.id, affiliateId: person.id, firstName: body.firstName, lastName: body.lastName, email: body.email, phone: body.phone, promoCodeId: promo.id, commissionPercent: body.commissionPercent, createdBy: c.user.email },
      });
    });
    await this.invite(created.id);
    logger.info({ org: c.org.id, eventId: id, eventAffiliateId: created.id }, 'Event affiliate invited');
    return this.present((await eventAffiliateRows(this.db, { id: created.id }))[0], e.currency ?? 'PHP');
  }

  @Patch(':aid')
  @ClientRoute(EVENT_ROUTES.promotions)
  async update(@Req() req: Request, @Param('id', ParseIntPipe) id: number, @Param('aid', ParseIntPipe) aid: number, @Body(new YupValidationPipe(patchSchema)) body: yup.InferType<typeof patchSchema>) {
    const e = await this.event(ctx(req).org.id, id);
    const a = await this.one(id, aid);
    const data: Record<string, unknown> = {};
    for (const k of ['firstName', 'lastName', 'phone', 'commissionPercent'] as const) if (body[k] !== undefined) data[k] = body[k];
    if (body.status) {
      if (body.status === 'active' && !a.joinedAt) throw new ApiError(409, { error: 'not_joined', message: 'This affiliate hasn’t accepted yet. Resend the invitation instead.' });
      data.status = body.status;
    }
    await this.db.$transaction(async (tx) => {
      if (Object.keys(data).length) await tx.eventAffiliate.update({ where: { id: aid }, data });
      const promo: Record<string, unknown> = {};
      if (body.discountPercent !== undefined) promo.discountValue = body.discountPercent;
      if (body.status) promo.active = body.status === 'active';
      if (Object.keys(promo).length) await tx.eventPromoCode.update({ where: { id: a.promoCodeId }, data: promo });
    });
    return this.present((await eventAffiliateRows(this.db, { id: aid }))[0], e.currency ?? 'PHP');
  }

  @Post(':aid/resend')
  @HttpCode(200)
  @ClientRoute(EVENT_ROUTES.promotions)
  async resend(@Req() req: Request, @Param('id', ParseIntPipe) id: number, @Param('aid', ParseIntPipe) aid: number) {
    await this.event(ctx(req).org.id, id);
    const a = await this.one(id, aid);
    if (a.status !== 'invited') throw new ApiError(409, { error: 'already_joined', message: 'This affiliate has already accepted.' });
    await this.invite(aid);
    return { ok: true };
  }

  /** Only while nobody has used their code; afterwards disable them (the records are kept). */
  @Delete(':aid')
  @ClientRoute(EVENT_ROUTES.promotions)
  async remove(@Req() req: Request, @Param('id', ParseIntPipe) id: number, @Param('aid', ParseIntPipe) aid: number) {
    await this.event(ctx(req).org.id, id);
    const a = await this.one(id, aid);
    if (a.promo.used > 0 || (await this.db.eventTicket.count({ where: { promoCodeId: a.promoCodeId } }))) {
      throw new ApiError(409, { error: 'code_used', message: 'Someone has registered with this affiliate’s code. Disable them instead, so the records are kept.' });
    }
    // The promo code goes with them (the affiliate row cascades from it).
    await this.db.eventPromoCode.delete({ where: { id: a.promoCodeId } });
    const [plan, events, payments] = await Promise.all([this.db.planAffiliate.count({ where: { affiliateId: a.affiliateId } }), this.db.eventAffiliate.count({ where: { affiliateId: a.affiliateId } }), this.db.planPayment.count({ where: { affiliateId: a.affiliateId } })]);
    if (!plan && !events && !payments && !a.affiliate.joinedAt) await this.db.affiliate.delete({ where: { id: a.affiliateId } });
    return { ok: true };
  }

  @Post(':aid/payouts')
  @ClientRoute(EVENT_ROUTES.promotions)
  async payout(@Req() req: Request, @Param('id', ParseIntPipe) id: number, @Param('aid', ParseIntPipe) aid: number, @Body(new YupValidationPipe(payoutSchema)) body: yup.InferType<typeof payoutSchema>) {
    const c = ctx(req);
    const e = await this.event(c.org.id, id);
    const a = await this.one(id, aid);
    const currency = e.currency ?? 'PHP';
    await this.db.eventAffiliatePayout.create({ data: { eventAffiliateId: aid, amount: body.amount, currency, reference: body.reference ?? null, createdBy: c.user.email } });
    this.mailer.sendInBackground(commissionPaidMail(this.cfg, await this.offer(a), { amount: formatMoney(body.amount, currency), reference: body.reference ?? null, account: payoutAccount(a.affiliate), portalUrl: `${this.cfg.clients.affiliatesUrl}/` }));
    logger.info({ org: c.org.id, eventId: id, eventAffiliateId: aid, amount: body.amount }, 'Event affiliate payout recorded');
    return this.present((await eventAffiliateRows(this.db, { id: aid }))[0], currency);
  }
}
