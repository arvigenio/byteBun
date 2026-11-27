// The affiliate portal (AFFILIATES_URL, e.g. affiliates.bytebuntech.com), for both programs.
//
//   Joining: the sign-up link from a proposal ({AFFILIATES_URL}/join#t=p12.secret = Byte Bun's
//   program, e12.secret = an event's) shows the offer; accepting it (first time: confirm name and
//   phone, give a payout account) activates the code, emails a welcome and signs them in.
//   Signing in: email -> a 6-digit code by email (10 minutes, 5 tries) -> a cookie session
//   (30 days; only its hash is stored). Only people who have accepted at least one program.
//   Dashboard: earnings (per currency: earned, paid out, balance), Byte Bun's program, every
//   event they promote, and the bookings waiting for verification.
//
//   GET  /api/affiliate/invite?t=          the offer behind a sign-up link
//   POST /api/affiliate/join               { token, firstName, lastName, phone, payout... }
//   POST /api/affiliate/auth/code          { email }   always 200 (doesn't tell who is an affiliate)
//   POST /api/affiliate/auth/verify        { email, code }
//   POST /api/affiliate/auth/sign-out
//   GET  /api/affiliate/me                 the dashboard
//   PATCH /api/affiliate/me                { phone, payoutMethod, payoutProvider, payoutAccountName, payoutAccountNumber }
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { Body, Controller, Get, HttpCode, Inject, Injectable, Patch, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import * as yup from 'yup';
import { MAILER } from '../../auth/auth.module';
import type { Mailer } from '../../auth/mailer';
import { ApiError } from '../../common/api-error';
import { StrictRateLimit } from '../../common/rate-limit';
import { YupValidationPipe } from '../../common/yup-validation.pipe';
import { APP_CONFIG, type AppConfig } from '../../config/config';
import { logger } from '../../logging/logger';
import { eventAffiliateRows, PENDING_STATUSES } from '../booking/event-affiliates';
import { zoneOf } from '../booking/events';
import { formatMoney } from '../booking/money';
import { ClientsDb } from '../clients-db';
import { num, parseInviteToken, payoutOf, percentLabel, sameHash, sha256, usd } from './affiliate-common';
import { affiliateCodeMail, affiliateWelcomeMail, type AffiliateOffer } from './affiliate-emails';
import { planOffer } from './affiliates.service';

export const AFFILIATE_COOKIE = 'bb_affiliate';
const SESSION_DAYS = 30;
const CODE_MINUTES = 10;
const CODE_TRIES = 5;

const text = (max: number) => yup.string().trim().max(max, `At most ${max} characters.`);
const payoutFields = {
  payoutMethod: yup.string().oneOf(['bank', 'ewallet'], 'Choose bank or e-wallet.'),
  payoutProvider: text(80).min(2, 'Please enter the bank or e-wallet.'),
  payoutAccountName: text(120).min(2, 'Please enter the account name.'),
  payoutAccountNumber: text(60).min(4, 'Please enter the account number.'),
};
export const joinSchema = yup.object({
  token: yup.string().trim().max(120).required('This sign-up link isn’t complete.'),
  firstName: text(60).min(1, 'Required.').required('Required.'),
  lastName: text(60).min(1, 'Required.').required('Required.'),
  phone: yup.string().trim().matches(/^[0-9+()\-.\s]{5,40}$/, 'Please enter a phone number.').required('Required.'),
  ...payoutFields,
});
const profileSchema = yup.object({ phone: yup.string().trim().matches(/^[0-9+()\-.\s]{5,40}$/, 'Please enter a phone number.'), ...payoutFields });
const emailSchema = yup.object({ email: yup.string().trim().lowercase().email('Please enter a valid email.').max(254).required('Please enter your email.') });
const verifySchema = emailSchema.shape({ code: yup.string().trim().matches(/^\d{6}$/, 'Enter the 6-digit code from the email.').required('Enter the 6-digit code from the email.') });

const cookieValue = (req: Request, name: string) => {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
};

@Injectable()
export class AffiliatePortal {
  constructor(
    private readonly db: ClientsDb,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    @Inject(MAILER) private readonly mailer: Mailer,
  ) {}

  get portalUrl() {
    return `${this.cfg.clients.affiliatesUrl}/`;
  }

  // ---- Sign-up links ----

  private async eventOffer(a: { firstName: string; lastName: string; email: string; commissionPercent: unknown; promo: { code: string; discountValue: unknown }; event: { title: string; startsAt: Date; timeZone: string | null; slug: string; organizationId: string } }): Promise<AffiliateOffer> {
    const [org, s] = await Promise.all([
      this.db.organization.findUnique({ where: { id: a.event.organizationId }, select: { name: true } }),
      this.db.bookingSettings.findUnique({ where: { organizationId: a.event.organizationId }, select: { slug: true, timeZone: true } }),
    ]);
    return {
      kind: 'event',
      firstName: a.firstName,
      lastName: a.lastName,
      email: a.email,
      promoCode: a.promo.code,
      discount: percentLabel(a.promo.discountValue as never),
      commission: percentLabel(a.commissionPercent as never),
      owner: org?.name ?? 'The organizer',
      event: {
        title: a.event.title,
        when: new Intl.DateTimeFormat('en', { dateStyle: 'full', timeStyle: 'short', timeZone: zoneOf(a.event, s?.timeZone ?? 'UTC') }).format(a.event.startsAt),
        url: `${this.cfg.clients.bookingsUrl}/${s?.slug ?? ''}/e/${a.event.slug}`,
      },
    };
  }

  /** The program behind a token, checked: { kind, row, person, offer }. */
  private async byToken(token: string) {
    const t = parseInviteToken(token);
    const bad = () => new ApiError(404, { error: 'invalid_link', message: 'This sign-up link isn’t valid. Ask for a new one.' });
    if (!t) throw bad();
    const joined = () => new ApiError(409, { error: 'already_joined', message: 'You have already accepted this. Sign in to see your dashboard.' });
    const expired = () => new ApiError(410, { error: 'link_expired', message: 'This sign-up link has expired. Ask for a new one.' });
    if (t.kind === 'plan') {
      const g = await this.db.planAffiliate.findUnique({ where: { id: t.id }, include: { affiliate: true } });
      if (!g) throw bad();
      if (g.status !== 'invited') throw joined();
      if (!sameHash(t.hash, g.inviteHash)) throw bad();
      if (!g.inviteExpiresAt || g.inviteExpiresAt <= new Date()) throw expired();
      return { kind: 'plan' as const, id: g.id, inviteHash: g.inviteHash!, person: g.affiliate, offer: planOffer(g.affiliate, g), discount: num(g.discountPercent), commission: num(g.commissionPercent) };
    }
    const a = await this.db.eventAffiliate.findUnique({ where: { id: t.id }, include: { affiliate: true, promo: true, event: true } });
    if (!a) throw bad();
    if (a.status !== 'invited') throw joined();
    if (!sameHash(t.hash, a.inviteHash)) throw bad();
    if (!a.inviteExpiresAt || a.inviteExpiresAt <= new Date()) throw expired();
    if (a.event.endsAt <= new Date()) throw new ApiError(410, { error: 'event_over', message: 'This event is already over.' });
    return { kind: 'event' as const, id: a.id, inviteHash: a.inviteHash!, person: a.affiliate, offer: await this.eventOffer(a), discount: num(a.promo.discountValue as never), commission: num(a.commissionPercent) };
  }

  async invite(token: string) {
    const x = await this.byToken(token);
    return {
      kind: x.kind,
      owner: x.offer.owner,
      event: x.offer.event ?? null,
      firstName: x.person.joinedAt ? x.person.firstName : x.offer.firstName,
      lastName: x.person.joinedAt ? x.person.lastName : x.offer.lastName,
      email: x.person.email,
      phone: x.person.phone,
      discountPercent: x.discount,
      commissionPercent: x.commission,
      // Already an affiliate elsewhere: just accept (their payout account is on file).
      hasAccount: !!x.person.joinedAt,
    };
  }

  async join(body: yup.InferType<typeof joinSchema>) {
    const x = await this.byToken(body.token);
    const now = new Date();
    if (!x.person.joinedAt) {
      const missing = (['payoutMethod', 'payoutProvider', 'payoutAccountName', 'payoutAccountNumber'] as const).filter((k) => !body[k]);
      if (missing.length) throw new ApiError(400, { error: 'validation_failed', message: 'Please tell us where to send your commissions.', fields: Object.fromEntries(missing.map((k) => [k, 'Required.'])) });
    }
    await this.db.$transaction(async (tx) => {
      // One use: the conditional update fails if the link was used a moment ago.
      const done =
        x.kind === 'plan'
          ? await tx.planAffiliate.updateMany({ where: { id: x.id, status: 'invited', inviteHash: x.inviteHash }, data: { status: 'active', joinedAt: now, inviteHash: null, inviteExpiresAt: null } })
          : await tx.eventAffiliate.updateMany({ where: { id: x.id, status: 'invited', inviteHash: x.inviteHash }, data: { status: 'active', joinedAt: now, inviteHash: null, inviteExpiresAt: null } });
      if (!done.count) throw new ApiError(409, { error: 'already_joined', message: 'You have already accepted this. Sign in to see your dashboard.' });
      if (x.kind === 'event') {
        const a = await tx.eventAffiliate.findUniqueOrThrow({ where: { id: x.id } });
        await tx.eventPromoCode.update({ where: { id: a.promoCodeId }, data: { active: true } });
      }
      const person: Record<string, unknown> = { firstName: body.firstName, lastName: body.lastName, phone: body.phone };
      if (!x.person.joinedAt) person.joinedAt = now;
      for (const k of ['payoutMethod', 'payoutProvider', 'payoutAccountName', 'payoutAccountNumber'] as const) if (body[k]) person[k] = body[k];
      await tx.affiliate.update({ where: { id: x.person.id }, data: person });
    });
    const offer = { ...x.offer, firstName: body.firstName, lastName: body.lastName };
    this.mailer.sendInBackground(affiliateWelcomeMail(this.cfg, offer, this.portalUrl));
    logger.info({ affiliateId: x.person.id, kind: x.kind, programId: x.id }, 'Affiliate accepted a proposal');
    return { personId: x.person.id, promoCode: offer.promoCode, kind: x.kind, owner: offer.owner, event: offer.event ?? null };
  }

  // ---- Sign-in ----

  async sendCode(email: string) {
    const a = await this.db.affiliate.findUnique({ where: { email } });
    // Unknown, or never accepted anything: the same answer, no email.
    if (!a?.joinedAt) {
      logger.info({ known: !!a }, 'Affiliate code asked for an email that can’t sign in');
      return;
    }
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.db.affiliate.update({ where: { id: a.id }, data: { loginCodeHash: sha256(`${a.id}:${code}`), loginCodeExpiresAt: new Date(Date.now() + CODE_MINUTES * 60_000), loginAttempts: 0 } });
    this.mailer.sendInBackground(affiliateCodeMail(this.cfg, a.email, code, CODE_MINUTES));
  }

  async verify(email: string, code: string) {
    const a = await this.db.affiliate.findUnique({ where: { email } });
    const expired = () => new ApiError(410, { error: 'code_expired', message: 'This code has expired. Ask for a new one.', fields: { code: 'Expired: ask for a new code.' } });
    if (!a?.joinedAt || !a.loginCodeHash || !a.loginCodeExpiresAt || a.loginCodeExpiresAt <= new Date() || a.loginAttempts >= CODE_TRIES) throw expired();
    if (!sameHash(sha256(`${a.id}:${code}`), a.loginCodeHash)) {
      const tries = a.loginAttempts + 1;
      await this.db.affiliate.update({ where: { id: a.id }, data: { loginAttempts: tries, ...(tries >= CODE_TRIES ? { loginCodeHash: null } : {}) } });
      const left = CODE_TRIES - tries;
      throw new ApiError(400, { error: 'bad_code', message: left > 0 ? `That code isn’t right. ${left} ${left === 1 ? 'try' : 'tries'} left.` : 'Too many wrong codes. Ask for a new one.', fields: { code: 'Wrong code.' } });
    }
    await this.db.affiliate.update({ where: { id: a.id }, data: { loginCodeHash: null, loginCodeExpiresAt: null, loginAttempts: 0 } });
    return this.newSession(a.id);
  }

  async newSession(affiliateId: number) {
    const token = randomBytes(32).toString('base64url');
    await this.db.affiliateSession.create({ data: { affiliateId, tokenHash: sha256(token), expiresAt: new Date(Date.now() + SESSION_DAYS * 86_400_000) } });
    return token;
  }

  setCookie(res: Response, token: string) {
    res.cookie(AFFILIATE_COOKIE, token, { httpOnly: true, secure: this.cfg.isProd, sameSite: 'lax', path: '/', maxAge: SESSION_DAYS * 86_400_000 });
  }

  async session(req: Request) {
    const token = cookieValue(req, AFFILIATE_COOKIE);
    if (!token) return null;
    const s = await this.db.affiliateSession.findUnique({ where: { tokenHash: createHash('sha256').update(token).digest('hex') } });
    if (!s || s.expiresAt <= new Date()) return null;
    if (Date.now() - s.lastSeenAt.getTime() > 3_600_000) await this.db.affiliateSession.update({ where: { id: s.id }, data: { lastSeenAt: new Date() } });
    return s;
  }

  async signOut(req: Request) {
    const token = cookieValue(req, AFFILIATE_COOKIE);
    if (token) await this.db.affiliateSession.deleteMany({ where: { tokenHash: sha256(token) } });
  }

  // ---- The dashboard ----

  async dashboard(affiliateId: number) {
    const a = await this.db.affiliate.findUniqueOrThrow({ where: { id: affiliateId }, include: { plan: true } });
    const totals = new Map<string, { currency: string; earned: number; paidOut: number; pending: number }>();
    const add = (currency: string, k: 'earned' | 'paidOut' | 'pending', v: number) => {
      const t = totals.get(currency) ?? { currency, earned: 0, paidOut: 0, pending: 0 };
      t[k] = Math.round((t[k] + v) * 100) / 100;
      totals.set(currency, t);
    };
    const pending: { kind: 'plan' | 'event'; title: string; who: string; spots: number; status: string; amount: string; createdAt: Date }[] = [];
    const initials = (name: string) => {
      const [first, ...rest] = name.trim().split(/\s+/);
      return `${first}${rest.length ? ` ${rest[rest.length - 1][0]}.` : ''}`;
    };

    // Byte Bun's program.
    let plan = null;
    if (a.plan && a.plan.status !== 'invited') {
      const commissions = await this.db.affiliateCommission.findMany({ where: { affiliateId }, orderBy: { createdAt: 'desc' }, include: { payment: { include: { plan: { select: { name: true } } } } } });
      for (const c of commissions) {
        if (c.status === 'earned' || c.status === 'paid') add('USD', 'earned', c.amountCents / 100);
        if (c.status === 'paid') add('USD', 'paidOut', c.amountCents / 100);
        if (c.status === 'pending') {
          add('USD', 'pending', c.amountCents / 100);
          pending.push({ kind: 'plan', title: `Byte Bun Bookings · ${c.payment.plan.name} (${c.payment.cycle})`, who: 'A business', spots: 1, status: 'For verification', amount: usd(c.amountCents), createdAt: c.createdAt });
        }
      }
      plan = {
        promoCode: a.plan.promoCode,
        status: a.plan.status,
        discountPercent: num(a.plan.discountPercent),
        commissionPercent: num(a.plan.commissionPercent),
        referrals: commissions.filter((c) => c.status === 'earned' || c.status === 'paid').length,
        pendingReferrals: commissions.filter((c) => c.status === 'pending').length,
        earned: usd(commissions.filter((c) => c.status === 'earned' || c.status === 'paid').reduce((n, c) => n + c.amountCents, 0)),
        paidOut: usd(commissions.filter((c) => c.status === 'paid').reduce((n, c) => n + c.amountCents, 0)),
        recent: commissions.slice(0, 20).map((c) => ({ status: c.status, amount: usd(c.amountCents), plan: c.payment.plan.name, createdAt: c.createdAt, paidAt: c.paidAt })),
      };
    }

    // Events.
    const rows = (await eventAffiliateRows(this.db, { affiliateId })).filter((x) => x.row.status !== 'invited');
    const orgIds = [...new Set(rows.map((x) => x.row.organizationId))];
    const [orgs, settings] = await Promise.all([
      this.db.organization.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true } }),
      this.db.bookingSettings.findMany({ where: { organizationId: { in: orgIds } }, select: { organizationId: true, slug: true, timeZone: true } }),
    ]);
    const events = rows
      .map((x) => {
        const e = x.row.event;
        const currency = e.currency ?? 'PHP';
        const s = settings.find((v) => v.organizationId === e.organizationId);
        add(currency, 'earned', x.stats.earned);
        add(currency, 'paidOut', x.stats.paidOut);
        const rate = num(x.row.commissionPercent);
        const unit = Number(e.price ?? 0);
        // Bulk bookings: one line per booking (same groupId).
        const groups = new Map<string, typeof x.tickets>();
        for (const t of x.tickets.filter((t) => PENDING_STATUSES.includes(t.status))) groups.set(t.groupId ?? `t${t.id}`, [...(groups.get(t.groupId ?? `t${t.id}`) ?? []), t]);
        for (const g of groups.values()) {
          const expected = g.reduce((n, t) => n + Math.max(0, unit - Number(t.discount ?? 0)), 0) * (rate / 100);
          add(currency, 'pending', expected);
          pending.push({ kind: 'event', title: e.title, who: initials(g[0].name), spots: g.length, status: { reserved: 'Reserved, waiting for payment', review: 'For verification', waitlist: 'Waitlist', rejected: 'Waiting for a new proof' }[g[0].status] ?? g[0].status, amount: formatMoney(Math.round(expected * 100) / 100, currency), createdAt: g[0].createdAt });
        }
        return {
          id: x.row.id,
          title: e.title,
          business: orgs.find((o) => o.id === e.organizationId)?.name ?? '',
          startsAt: e.startsAt,
          endsAt: e.endsAt,
          timeZone: zoneOf(e, s?.timeZone ?? 'UTC'),
          url: s ? `${this.cfg.clients.bookingsUrl}/${s.slug}/e/${e.slug}?promo=${encodeURIComponent(x.row.promo.code)}` : null,
          price: e.priceLabel,
          published: e.published,
          status: x.row.status,
          promoCode: x.row.promo.code,
          discountPercent: num(x.row.promo.discountValue as never),
          commissionPercent: rate,
          stats: x.stats,
          labels: { earned: formatMoney(x.stats.earned, currency), paidOut: formatMoney(x.stats.paidOut, currency), balance: formatMoney(x.stats.balance, currency) },
          payouts: x.row.payouts.map((p) => ({ amount: formatMoney(Number(p.amount), p.currency), reference: p.reference, createdAt: p.createdAt })),
        };
      })
      .sort((x, y) => +y.startsAt - +x.startsAt);

    return {
      firstName: a.firstName,
      lastName: a.lastName,
      email: a.email,
      phone: a.phone,
      payout: payoutOf(a),
      earnings: [...totals.values()].map((t) => ({
        currency: t.currency,
        earned: formatMoney(t.earned, t.currency),
        paidOut: formatMoney(t.paidOut, t.currency),
        balance: formatMoney(Math.round((t.earned - t.paidOut) * 100) / 100, t.currency),
        pending: formatMoney(Math.round(t.pending * 100) / 100, t.currency),
      })),
      plan,
      events,
      pending: pending.sort((x, y) => +y.createdAt - +x.createdAt),
    };
  }

  async updateProfile(affiliateId: number, body: yup.InferType<typeof profileSchema>) {
    const data: Record<string, unknown> = {};
    for (const k of ['phone', 'payoutMethod', 'payoutProvider', 'payoutAccountName', 'payoutAccountNumber'] as const) if (body[k]) data[k] = body[k];
    await this.db.affiliate.update({ where: { id: affiliateId }, data });
    return this.dashboard(affiliateId);
  }
}

@Controller('affiliate')
export class AffiliatePortalController {
  constructor(private readonly portal: AffiliatePortal) {}

  private async me(req: Request) {
    const s = await this.portal.session(req);
    if (!s) throw new ApiError(401, { error: 'unauthorized', message: 'Please sign in.' });
    return s.affiliateId;
  }

  @Get('invite')
  @StrictRateLimit()
  invite(@Query('t') t?: string) {
    return this.portal.invite(t ?? '');
  }

  @Post('join')
  @HttpCode(200)
  @StrictRateLimit()
  async join(@Body(new YupValidationPipe(joinSchema)) body: yup.InferType<typeof joinSchema>, @Res({ passthrough: true }) res: Response) {
    const r = await this.portal.join(body);
    this.portal.setCookie(res, await this.portal.newSession(r.personId));
    return { promoCode: r.promoCode, kind: r.kind, owner: r.owner, event: r.event };
  }

  @Post('auth/code')
  @HttpCode(200)
  @StrictRateLimit()
  async code(@Body(new YupValidationPipe(emailSchema)) body: yup.InferType<typeof emailSchema>) {
    await this.portal.sendCode(body.email);
    return { sent: true };
  }

  @Post('auth/verify')
  @HttpCode(200)
  @StrictRateLimit()
  async verify(@Body(new YupValidationPipe(verifySchema)) body: yup.InferType<typeof verifySchema>, @Res({ passthrough: true }) res: Response) {
    this.portal.setCookie(res, await this.portal.verify(body.email, body.code));
    return { ok: true };
  }

  @Post('auth/sign-out')
  @HttpCode(200)
  async signOut(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.portal.signOut(req);
    res.clearCookie(AFFILIATE_COOKIE, { path: '/' });
    return { ok: true };
  }

  @Get('me')
  async dashboard(@Req() req: Request) {
    return this.portal.dashboard(await this.me(req));
  }

  @Patch('me')
  async update(@Req() req: Request, @Body(new YupValidationPipe(profileSchema)) body: yup.InferType<typeof profileSchema>) {
    return this.portal.updateProfile(await this.me(req), body);
  }
}
