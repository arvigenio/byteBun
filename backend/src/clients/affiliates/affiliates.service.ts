// Byte Bun's own affiliate program and self-serve plan payments.
//
//   Affiliates (admin site, Affiliates tab): an admin adds one (first/last name, email, phone,
//   the business discount % and the affiliate's commission %). They are emailed a proposal with a
//   unique sign-up link ({AFFILIATES_URL}/join#t=p{id}.{secret}, 14 days; resending makes a new
//   one). Accepting it (affiliate-portal.ts) makes them active and emails their promo code.
//   Disabled affiliates' codes stop working. Ranked by verified referrals.
//
//   Plan payments (Bookings Plan page): an owner picks a self-serve plan and cycle, may enter a
//   promo code (discount), pays through one of Byte Bun's payment channels and uploads a proof
//   (status review; admins emailed). The affiliate's commission is recorded as `pending`. An admin
//   approves (plan changes, commission `earned`, affiliate emailed) or rejects (commission `void`).
//   Earned commissions are marked `paid` from the Affiliates tab once Byte Bun sends them.
//
// An affiliate is a person (billing.affiliates) who may also promote businesses' paid events
// (event-affiliates.ts); Byte Bun's program is their PlanAffiliate row.
//
// Admin work uses CLIENTS_ADMIN_DB (docs/CLIENTS-DB-ADMIN-USER.sql); the business's own requests
// use the app's connection.
import { Inject, Injectable } from '@nestjs/common';
import { ADMINS } from '../../auth/admins';
import { MAILER } from '../../auth/auth.module';
import type { Mailer } from '../../auth/mailer';
import { ApiError } from '../../common/api-error';
import { APP_CONFIG, type AppConfig } from '../../config/config';
import { logger } from '../../logging/logger';
import { CLIENTS_ADMIN_DB, ClientsAdminService, type AdminActor } from '../admin/clients-admin.service';
import { PaymentFiles, type UploadedFileLike } from '../booking/payment-files';
import { planPaymentApprovedMail, planPaymentReceivedMail, planPaymentRejectedMail, type PlanPaymentView } from '../client-emails';
import { ClientsDb } from '../clients-db';
import { codeFromName, type Decimalish, longDate, newInvite, normCode, num, payoutAccount, payoutOf, percentLabel, personFor, usd } from './affiliate-common';
import { affiliateProposalMail, commissionEarnedMail, commissionPaidMail, planPaymentToVerifyMail, type AffiliateOffer } from './affiliate-emails';

export const MAX_PLAN_CHANNELS = 4;
const CURRENCY = 'USD';

const cycleLabel = (c: string) => (c === 'yearly' ? 'Yearly' : 'Monthly');
const notFound = (what = 'affiliate') => new ApiError(404, { error: 'not_found', message: `That ${what} does not exist.` });

/** The price for a plan and cycle, the discount, what's paid, and the commission on it (cents). */
export function quote(plan: { priceMonthlyCents: number | null; priceYearlyCents: number | null }, cycle: string, program: { discountPercent: Decimalish; commissionPercent: Decimalish } | null) {
  const listCents = (cycle === 'yearly' ? plan.priceYearlyCents : plan.priceMonthlyCents) ?? 0;
  const discountCents = program ? Math.round((listCents * num(program.discountPercent)) / 100) : 0;
  const amountCents = listCents - discountCents;
  const commissionCents = program ? Math.round((amountCents * num(program.commissionPercent)) / 100) : 0;
  return { listCents, discountCents, amountCents, commissionCents };
}

type Person = { id: number; firstName: string; lastName: string; email: string };
type Program = { promoCode: string; discountPercent: Decimalish; commissionPercent: Decimalish };

/** What the affiliate emails say about Byte Bun's program. */
export const planOffer = (p: Person, g: Program): AffiliateOffer => ({
  kind: 'plan',
  firstName: p.firstName,
  lastName: p.lastName,
  email: p.email,
  promoCode: g.promoCode,
  discount: percentLabel(g.discountPercent),
  commission: percentLabel(g.commissionPercent),
  owner: 'Byte Bun',
});

export const planChannelRow = (c: { id: number; type: string; label: string; bankName: string | null; accountName: string | null; accountNumber: string | null; qrFile: string | null }) => ({
  id: c.id,
  type: c.type as 'qr' | 'bank',
  label: c.label,
  bankName: c.bankName,
  accountName: c.accountName,
  accountNumber: c.accountNumber,
  qrUrl: c.qrFile ? `/api/public/plan-files/qr/${c.qrFile}` : null,
});

export interface AffiliateInput {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  discountPercent: number;
  commissionPercent: number;
  promoCode?: string | null;
  note?: string | null;
}

export interface ChannelInput {
  type?: 'qr' | 'bank';
  label?: string;
  bankName?: string | null;
  accountName?: string | null;
  accountNumber?: string | null;
}

export type AffiliateSort = 'referrals' | 'earnings' | 'newest';

@Injectable()
export class AffiliatesService {
  constructor(
    @Inject(CLIENTS_ADMIN_DB) private readonly adminDb: ClientsDb,
    private readonly db: ClientsDb,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    @Inject(MAILER) private readonly mailer: Mailer,
    private readonly files: PaymentFiles,
    private readonly clients: ClientsAdminService,
  ) {}

  private get planUrl() {
    return `${this.cfg.clients.bookingsUrl}/app/plan`;
  }

  private get portalUrl() {
    return `${this.cfg.clients.affiliatesUrl}/`;
  }

  // ------------------------------------------------------------------------------------------
  // Byte Bun's affiliates (admin)
  // ------------------------------------------------------------------------------------------

  private async newPromoCode(firstName: string) {
    for (;;) {
      const code = codeFromName(firstName);
      if (!(await this.adminDb.planAffiliate.findUnique({ where: { promoCode: code } }))) return code;
    }
  }

  private async codeFree(code: string, exceptId?: number) {
    const other = await this.adminDb.planAffiliate.findUnique({ where: { promoCode: code } });
    if (other && other.id !== exceptId) throw new ApiError(409, { error: 'code_taken', message: 'Another affiliate already has that promo code.', fields: { promoCode: 'Already taken.' } });
  }

  private async program(id: number) {
    const g = await this.adminDb.planAffiliate.findUnique({ where: { id }, include: { affiliate: true } });
    if (!g) throw notFound();
    return g;
  }

  /** A new sign-up link (the old one stops working), emailed with the proposal. */
  private async issueInvite(id: number) {
    const inv = newInvite();
    const g = await this.adminDb.planAffiliate.update({ where: { id }, data: { inviteHash: inv.hash, inviteExpiresAt: inv.expiresAt, invitedAt: new Date() }, include: { affiliate: true } });
    const url = `${this.cfg.clients.affiliatesUrl}/join#t=p${id}.${inv.secret}`;
    this.mailer.sendInBackground(affiliateProposalMail(this.cfg, planOffer(g.affiliate, g), { url, expires: longDate(inv.expiresAt) }));
    return url;
  }

  private row(g: Awaited<ReturnType<AffiliatesService['program']>>) {
    const a = g.affiliate;
    return {
      id: g.id,
      affiliateId: a.id,
      firstName: a.firstName,
      lastName: a.lastName,
      email: a.email,
      phone: a.phone,
      promoCode: g.promoCode,
      discountPercent: num(g.discountPercent),
      commissionPercent: num(g.commissionPercent),
      status: g.status,
      invitedAt: g.invitedAt,
      inviteExpiresAt: g.inviteExpiresAt,
      joinedAt: g.joinedAt,
      payout: payoutOf(a),
      note: g.note,
      createdBy: g.createdBy,
      createdAt: g.createdAt,
    };
  }

  /**
   * Every affiliate with their totals. Ranked by verified referrals (payments approved with their
   * code) by default; `earnings` = earned + paid; `newest` = newest first.
   */
  async list(sort: AffiliateSort = 'referrals') {
    const [rows, sums] = await Promise.all([
      this.adminDb.planAffiliate.findMany({ orderBy: { createdAt: 'desc' }, take: 1000, include: { affiliate: true } }),
      this.adminDb.affiliateCommission.groupBy({ by: ['affiliateId', 'status'], _sum: { amountCents: true }, _count: { _all: true } }),
    ]);
    const list = rows.map((g) => {
      const of = (status: string) => sums.find((s) => s.affiliateId === g.affiliateId && s.status === status);
      const cents = (status: string) => of(status)?._sum.amountCents ?? 0;
      const count = (status: string) => of(status)?._count._all ?? 0;
      return {
        ...this.row(g),
        totals: { referrals: count('earned') + count('paid'), pendingReferrals: count('pending'), pendingCents: cents('pending'), earnedCents: cents('earned'), paidCents: cents('paid') },
      };
    });
    if (sort === 'referrals') list.sort((x, y) => y.totals.referrals - x.totals.referrals || y.totals.pendingReferrals - x.totals.pendingReferrals || +y.createdAt - +x.createdAt);
    if (sort === 'earnings') list.sort((x, y) => y.totals.earnedCents + y.totals.paidCents - (x.totals.earnedCents + x.totals.paidCents) || y.totals.referrals - x.totals.referrals);
    return list.map((r, i) => ({ ...r, rank: i + 1 }));
  }

  async detail(id: number) {
    const g = await this.program(id);
    const commissions = await this.adminDb.affiliateCommission.findMany({
      where: { affiliateId: g.affiliateId },
      orderBy: { createdAt: 'desc' },
      take: 500,
      include: { payment: { select: { cycle: true, amountCents: true, status: true, createdAt: true, plan: { select: { name: true } } } } },
    });
    const names = new Map((await this.adminDb.organization.findMany({ where: { id: { in: [...new Set(commissions.map((c) => c.organizationId))] } }, select: { id: true, name: true } })).map((o) => [o.id, o.name]));
    const sum = (status: string) => commissions.filter((c) => c.status === status).reduce((n, c) => n + c.amountCents, 0);
    return {
      ...this.row(g),
      totals: { referrals: commissions.filter((c) => c.status === 'earned' || c.status === 'paid').length, pendingReferrals: commissions.filter((c) => c.status === 'pending').length, pendingCents: sum('pending'), earnedCents: sum('earned'), paidCents: sum('paid') },
      commissions: commissions.map((c) => ({
        id: c.id,
        status: c.status,
        amountCents: c.amountCents,
        commissionPercent: num(c.commissionPercent),
        createdAt: c.createdAt,
        earnedAt: c.earnedAt,
        paidAt: c.paidAt,
        paidBy: c.paidBy,
        payoutReference: c.payoutReference,
        businessName: names.get(c.organizationId) ?? 'Removed business',
        payment: { plan: c.payment.plan.name, cycle: c.payment.cycle, amountCents: c.payment.amountCents, status: c.payment.status, createdAt: c.payment.createdAt },
      })),
    };
  }

  async create(body: AffiliateInput, actor: AdminActor) {
    const email = body.email.trim().toLowerCase();
    const existing = await this.adminDb.affiliate.findUnique({ where: { email }, include: { plan: true } });
    if (existing?.plan) throw new ApiError(409, { error: 'email_taken', message: 'There is already an affiliate with that email.', fields: { email: 'Already an affiliate.' } });
    const promoCode = body.promoCode ? normCode(body.promoCode) : await this.newPromoCode(body.firstName);
    await this.codeFree(promoCode);
    const person = await personFor(this.adminDb, { ...body, email });
    const g = await this.adminDb.planAffiliate.create({
      data: { affiliateId: person.id, promoCode, discountPercent: body.discountPercent, commissionPercent: body.commissionPercent, note: body.note ?? null, createdBy: actor.email },
    });
    await this.issueInvite(g.id);
    logger.info({ planAffiliateId: g.id, by: actor.email }, 'Affiliate invited');
    return this.detail(g.id);
  }

  /**
   * Edit. Names and phone are the person's. The email can change only before they've signed up to
   * anything (a new link is then sent to it).
   */
  async update(id: number, body: Partial<AffiliateInput> & { status?: 'active' | 'disabled' }, actor: AdminActor) {
    const g = await this.program(id);
    const program: Record<string, unknown> = {};
    for (const k of ['discountPercent', 'commissionPercent', 'note'] as const) if (body[k] !== undefined) program[k] = body[k];
    if (body.promoCode !== undefined && body.promoCode !== null) {
      const code = normCode(body.promoCode);
      await this.codeFree(code, id);
      program.promoCode = code;
    }
    if (body.status) {
      if (body.status === 'active' && !g.joinedAt) throw new ApiError(409, { error: 'not_joined', message: 'This affiliate hasn’t signed up yet. Resend the invitation instead.' });
      program.status = body.status;
    }
    const person: Record<string, unknown> = {};
    for (const k of ['firstName', 'lastName', 'phone'] as const) if (body[k] !== undefined) person[k] = body[k];
    let emailChanged = false;
    const email = body.email?.trim().toLowerCase();
    if (email && email !== g.affiliate.email) {
      const events = await this.adminDb.eventAffiliate.count({ where: { affiliateId: g.affiliateId } });
      if (g.affiliate.joinedAt || events) throw new ApiError(409, { error: 'email_locked', message: 'The email can’t be changed after the affiliate has signed up.', fields: { email: 'Can’t be changed after sign-up.' } });
      if (await this.adminDb.affiliate.findUnique({ where: { email } })) throw new ApiError(409, { error: 'email_taken', message: 'There is already an affiliate with that email.', fields: { email: 'Already an affiliate.' } });
      person.email = email;
      emailChanged = true;
    }
    if (Object.keys(person).length) await this.adminDb.affiliate.update({ where: { id: g.affiliateId }, data: person });
    if (Object.keys(program).length) await this.adminDb.planAffiliate.update({ where: { id }, data: program });
    if (emailChanged) await this.issueInvite(id);
    logger.info({ planAffiliateId: id, by: actor.email, fields: [...Object.keys(person), ...Object.keys(program)] }, 'Affiliate updated');
    return this.detail(id);
  }

  async resendInvite(id: number, actor: AdminActor) {
    const g = await this.program(id);
    if (g.status !== 'invited') throw new ApiError(409, { error: 'already_joined', message: 'This affiliate has already signed up.' });
    await this.issueInvite(id);
    logger.info({ planAffiliateId: id, by: actor.email }, 'Affiliate invitation resent');
    return this.detail(id);
  }

  /** Only affiliates with no commissions can be deleted; others are disabled (records kept). */
  async remove(id: number, actor: AdminActor) {
    const g = await this.program(id);
    if (await this.adminDb.affiliateCommission.count({ where: { affiliateId: g.affiliateId, status: { not: 'void' } } })) {
      throw new ApiError(409, { error: 'has_commissions', message: 'This affiliate has commissions on record. Disable them instead, so the records are kept.' });
    }
    await this.adminDb.planAffiliate.delete({ where: { id } });
    // The person goes too when nothing else needs them (no events, no payments on record).
    const [events, payments] = await Promise.all([this.adminDb.eventAffiliate.count({ where: { affiliateId: g.affiliateId } }), this.adminDb.planPayment.count({ where: { affiliateId: g.affiliateId } })]);
    if (!events && !payments) await this.adminDb.affiliate.delete({ where: { id: g.affiliateId } });
    logger.warn({ planAffiliateId: id, by: actor.email }, 'Affiliate deleted');
    return { ok: true };
  }

  /** Byte Bun sent the money: earned commissions (all, or the ones given) become paid. */
  async markPaid(id: number, body: { commissionIds?: number[] | null; reference: string | null }, actor: AdminActor) {
    const g = await this.program(id);
    const where = { affiliateId: g.affiliateId, status: 'earned', ...(body.commissionIds?.length ? { id: { in: body.commissionIds } } : {}) };
    const due = await this.adminDb.affiliateCommission.findMany({ where });
    if (!due.length) throw new ApiError(409, { error: 'nothing_due', message: 'There are no earned commissions to mark as paid.' });
    await this.adminDb.affiliateCommission.updateMany({ where: { id: { in: due.map((c) => c.id) }, status: 'earned' }, data: { status: 'paid', paidAt: new Date(), paidBy: actor.email, payoutReference: body.reference } });
    const total = due.reduce((n, c) => n + c.amountCents, 0);
    this.mailer.sendInBackground(commissionPaidMail(this.cfg, planOffer(g.affiliate, g), { amount: usd(total), reference: body.reference, account: payoutAccount(g.affiliate), portalUrl: this.portalUrl }));
    logger.info({ planAffiliateId: id, count: due.length, cents: total, by: actor.email }, 'Affiliate commissions paid');
    return this.detail(id);
  }

  // ------------------------------------------------------------------------------------------
  // Byte Bun's payment channels (admin)
  // ------------------------------------------------------------------------------------------

  async channels() {
    return (await this.db.planPaymentChannel.findMany({ orderBy: [{ position: 'asc' }, { id: 'asc' }] })).map(planChannelRow);
  }

  private channelData(body: ChannelInput, type: string) {
    const data: Record<string, unknown> = {};
    for (const k of ['label', 'bankName', 'accountName', 'accountNumber'] as const) if (body[k] !== undefined) data[k] = body[k] ?? null;
    if (body.type) data.type = body.type;
    if (type === 'qr') data.bankName = null;
    return data;
  }

  async addChannel(body: ChannelInput & { type: 'qr' | 'bank'; label: string }, file: UploadedFileLike | undefined) {
    const count = await this.adminDb.planPaymentChannel.count();
    if (count >= MAX_PLAN_CHANNELS) throw new ApiError(403, { error: 'channel_limit', message: `Up to ${MAX_PLAN_CHANNELS} payment channels. Delete one to add another.` });
    if (body.type === 'bank' && (!body.bankName || !body.accountName || !body.accountNumber)) {
      throw new ApiError(400, { error: 'validation_failed', message: 'Please fill in the bank name, account name and account number.', fields: Object.fromEntries((['bankName', 'accountName', 'accountNumber'] as const).filter((k) => !body[k]).map((k) => [k, 'Required.'])) });
    }
    const qr = body.type === 'qr' ? await this.files.save('plan-payment-qr', file, { allowPdf: false, field: 'file' }) : null;
    const ch = await this.adminDb.planPaymentChannel.create({ data: { ...this.channelData(body, body.type), type: body.type, label: body.label, position: count, qrFile: qr?.file ?? null, qrType: qr?.type ?? null } as never });
    return planChannelRow(ch);
  }

  async updateChannel(id: number, body: ChannelInput, file: UploadedFileLike | undefined) {
    const before = await this.adminDb.planPaymentChannel.findUnique({ where: { id } });
    if (!before) throw notFound('payment channel');
    const type = body.type ?? before.type;
    if (type === 'bank') {
      const merged = { bankName: body.bankName !== undefined ? body.bankName : before.bankName, accountName: body.accountName !== undefined ? body.accountName : before.accountName, accountNumber: body.accountNumber !== undefined ? body.accountNumber : before.accountNumber };
      const missing = Object.entries(merged).filter(([, v]) => !v).map(([k]) => k);
      if (missing.length) throw new ApiError(400, { error: 'validation_failed', message: 'Please fill in the bank name, account name and account number.', fields: Object.fromEntries(missing.map((k) => [k, 'Required.'])) });
    }
    const data = this.channelData(body, type);
    let oldQr: string | null = null;
    if (type === 'qr' && (file || !before.qrFile)) {
      const qr = await this.files.save('plan-payment-qr', file, { allowPdf: false, field: 'file' });
      Object.assign(data, { qrFile: qr.file, qrType: qr.type });
      oldQr = before.qrFile;
    } else if (type === 'bank' && before.qrFile) {
      Object.assign(data, { qrFile: null, qrType: null });
      oldQr = before.qrFile;
    }
    const ch = await this.adminDb.planPaymentChannel.update({ where: { id }, data });
    await this.files.remove('plan-payment-qr', oldQr);
    return planChannelRow(ch);
  }

  async deleteChannel(id: number) {
    const ch = await this.adminDb.planPaymentChannel.findUnique({ where: { id } });
    if (!ch) throw notFound('payment channel');
    await this.adminDb.planPaymentChannel.delete({ where: { id } });
    await this.files.remove('plan-payment-qr', ch.qrFile);
    return { ok: true };
  }

  async qrFile(name: string) {
    const ch = await this.db.planPaymentChannel.findFirst({ where: { qrFile: name }, select: { qrType: true } });
    const body = ch ? await this.files.read('plan-payment-qr', name) : null;
    if (!body || !ch?.qrType) throw new ApiError(404, { error: 'not_found', message: 'That image does not exist.' });
    return { body, type: ch.qrType };
  }

  // ------------------------------------------------------------------------------------------
  // The business: buying a plan
  // ------------------------------------------------------------------------------------------

  private async sellable(planCode: string) {
    const plan = await this.db.plan.findUnique({ where: { code: planCode } });
    if (!plan || !plan.active || !plan.selfServe || plan.priceMonthlyCents === null || plan.priceYearlyCents === null) {
      throw new ApiError(400, { error: 'validation_failed', message: 'That plan can’t be bought online. Book a free consultation instead.', fields: { planCode: 'Not sold online.' } });
    }
    return plan;
  }

  /** An active affiliate's code, or a friendly 400 on the promo code field. */
  private async promo(raw: string, submitter: string) {
    const code = normCode(raw);
    const g = code ? await this.db.planAffiliate.findUnique({ where: { promoCode: code }, include: { affiliate: true } }) : null;
    if (!g || g.status !== 'active') throw new ApiError(400, { error: 'invalid_promo', message: 'That promo code isn’t valid.', fields: { promoCode: 'Not a valid code.' } });
    if (g.affiliate.email === submitter.trim().toLowerCase()) throw new ApiError(400, { error: 'own_promo', message: 'You can’t use your own affiliate code.', fields: { promoCode: 'This is your own code.' } });
    // The program's terms, with the person's id and name (commissions belong to the person).
    return { id: g.affiliateId, firstName: g.affiliate.firstName, lastName: g.affiliate.lastName, promoCode: g.promoCode, discountPercent: g.discountPercent, commissionPercent: g.commissionPercent };
  }

  private paymentRow(p: { id: number; planCode: string; cycle: string; currency: string; listCents: number; discountCents: number; amountCents: number; promoCode: string | null; discountPercent: Decimalish | null; status: string; proofName: string | null; reference: string | null; createdAt: Date; reviewedAt: Date | null; reviewNote: string | null; plan?: { name: string } }) {
    return {
      id: p.id,
      planCode: p.planCode,
      planName: p.plan?.name ?? p.planCode,
      cycle: p.cycle,
      currency: p.currency,
      listCents: p.listCents,
      discountCents: p.discountCents,
      amountCents: p.amountCents,
      promoCode: p.promoCode,
      discountPercent: p.discountPercent === null ? null : num(p.discountPercent),
      status: p.status,
      proofName: p.proofName,
      reference: p.reference,
      createdAt: p.createdAt,
      reviewedAt: p.reviewedAt,
      reviewNote: p.reviewNote,
    };
  }

  /** The Plan page: what can be bought, how to pay, and this business's payments. */
  async checkout(orgId: string) {
    const [plans, sub, channels, payments] = await Promise.all([
      this.db.plan.findMany({ where: { active: true, selfServe: true }, orderBy: { sort: 'asc' } }),
      this.db.subscription.findUnique({ where: { organizationId: orgId } }),
      this.channels(),
      this.db.planPayment.findMany({ where: { organizationId: orgId }, orderBy: { createdAt: 'desc' }, take: 10, include: { plan: { select: { name: true } } } }),
    ]);
    return {
      currency: CURRENCY,
      currentPlan: sub?.planCode ?? 'free',
      plans: plans.filter((p) => p.priceMonthlyCents !== null && p.priceYearlyCents !== null).map((p) => ({ code: p.code, name: p.name, monthlyCents: p.priceMonthlyCents!, yearlyCents: p.priceYearlyCents! })),
      channels,
      open: payments.find((p) => p.status === 'review') ? this.paymentRow(payments.find((p) => p.status === 'review')!) : null,
      payments: payments.map((p) => this.paymentRow(p)),
    };
  }

  /** "Apply" on the Plan page: the price with this code. */
  async quotePromo(body: { planCode: string; cycle: string; promoCode: string }, submitter: string) {
    const plan = await this.sellable(body.planCode);
    const a = await this.promo(body.promoCode, submitter);
    const q = quote(plan, body.cycle, a);
    return { promoCode: a.promoCode, discountPercent: num(a.discountPercent), listCents: q.listCents, discountCents: q.discountCents, amountCents: q.amountCents };
  }

  async submit(c: { orgId: string; orgName: string; email: string }, body: { planCode: string; cycle: 'monthly' | 'yearly'; promoCode?: string | null; reference?: string | null }, file: UploadedFileLike | undefined) {
    const plan = await this.sellable(body.planCode);
    if (await this.db.planPayment.findFirst({ where: { organizationId: c.orgId, status: 'review' } })) {
      throw new ApiError(409, { error: 'payment_pending', message: 'Byte Bun is still verifying your last payment. You can cancel it to send a new one.' });
    }
    const a = body.promoCode ? await this.promo(body.promoCode, c.email) : null;
    const q = quote(plan, body.cycle, a);
    const proof = await this.files.save('plan-proofs', file, { allowPdf: true, field: 'file' });
    const payment = await this.db.$transaction(async (tx) => {
      const p = await tx.planPayment.create({
        data: {
          organizationId: c.orgId,
          planCode: plan.code,
          cycle: body.cycle,
          currency: CURRENCY,
          listCents: q.listCents,
          discountCents: q.discountCents,
          amountCents: q.amountCents,
          affiliateId: a?.id ?? null,
          promoCode: a?.promoCode ?? null,
          discountPercent: a ? a.discountPercent : null,
          proofFile: proof.file,
          proofType: proof.type,
          proofName: proof.originalName,
          reference: body.reference ?? null,
          submittedBy: c.email,
        },
        include: { plan: { select: { name: true } } },
      });
      if (a) await tx.affiliateCommission.create({ data: { affiliateId: a.id, paymentId: p.id, organizationId: c.orgId, commissionPercent: a.commissionPercent, amountCents: q.commissionCents, currency: CURRENCY } });
      await tx.billingEvent.create({ data: { organizationId: c.orgId, type: 'plan_payment', actor: c.email, data: { paymentId: p.id, planCode: plan.code, cycle: body.cycle, amountCents: q.amountCents, promoCode: a?.promoCode ?? null } } });
      return p;
    });
    const v = this.mailView(c.orgName, payment);
    this.mailer.sendInBackground(planPaymentReceivedMail(this.cfg, c.email, v));
    this.mailer.sendInBackground(
      planPaymentToVerifyMail(this.cfg, ADMINS.map((x) => x.email), { businessName: c.orgName, plan: `${plan.name} (${body.cycle})`, amount: v.amount, promoCode: a?.promoCode ?? null, affiliate: a ? `${a.firstName} ${a.lastName}` : null, by: c.email, url: `${this.cfg.booking.siteUrl}/admin/plan-payments` }),
    );
    logger.info({ org: c.orgId, paymentId: payment.id, plan: plan.code, cents: q.amountCents, affiliateId: a?.id ?? null }, 'Plan payment submitted');
    return this.paymentRow(payment);
  }

  /** The business takes back a payment that isn't verified yet (e.g. wrong proof). */
  async cancel(orgId: string, id: number, by: string) {
    const { count } = await this.db.planPayment.updateMany({ where: { id, organizationId: orgId, status: 'review' }, data: { status: 'cancelled', reviewedAt: new Date(), reviewedBy: by } });
    if (!count) throw new ApiError(409, { error: 'not_pending', message: 'This payment isn’t waiting for verification any more.' });
    await this.db.affiliateCommission.updateMany({ where: { paymentId: id, status: 'pending' }, data: { status: 'void' } });
    const p = await this.db.planPayment.findUniqueOrThrow({ where: { id } });
    await this.files.remove('plan-proofs', p.proofFile);
    await this.db.planPayment.update({ where: { id }, data: { proofFile: null } });
    await this.db.billingEvent.create({ data: { organizationId: orgId, type: 'plan_payment_cancelled', actor: by, data: { paymentId: id } } });
    return { ok: true };
  }

  private mailView(businessName: string, p: { planCode: string; cycle: string; listCents: number; discountCents: number; amountCents: number; promoCode: string | null; plan?: { name: string } }): PlanPaymentView {
    return {
      businessName,
      planName: p.plan?.name ?? p.planCode,
      cycle: cycleLabel(p.cycle),
      amount: usd(p.amountCents),
      list: usd(p.listCents),
      discount: p.discountCents ? usd(p.discountCents) : null,
      promoCode: p.promoCode,
      planUrl: this.planUrl,
    };
  }

  // ------------------------------------------------------------------------------------------
  // Verifying plan payments (admin)
  // ------------------------------------------------------------------------------------------

  async payments(status?: string) {
    const rows = await this.adminDb.planPayment.findMany({
      where: status && status !== 'all' ? { status } : {},
      orderBy: { createdAt: status === 'review' ? 'asc' : 'desc' },
      take: 300,
      include: { plan: { select: { name: true } }, affiliate: { select: { id: true, firstName: true, lastName: true } }, commission: { select: { amountCents: true, status: true } } },
    });
    const names = new Map((await this.adminDb.organization.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.organizationId))] } }, select: { id: true, name: true } })).map((o) => [o.id, o.name]));
    const subs = new Map((await this.adminDb.subscription.findMany({ where: { organizationId: { in: [...new Set(rows.map((r) => r.organizationId))] } }, select: { organizationId: true, planCode: true } })).map((s) => [s.organizationId, s.planCode]));
    return rows.map((p) => ({
      ...this.paymentRow(p),
      organizationId: p.organizationId,
      businessName: names.get(p.organizationId) ?? 'Removed business',
      currentPlan: subs.get(p.organizationId) ?? null,
      submittedBy: p.submittedBy,
      reviewedBy: p.reviewedBy,
      proofType: p.proofType,
      hasProof: !!p.proofFile,
      affiliate: p.affiliate ? { id: p.affiliate.id, name: `${p.affiliate.firstName} ${p.affiliate.lastName}` } : null,
      commission: p.commission ? { amountCents: p.commission.amountCents, status: p.commission.status } : null,
    }));
  }

  async proof(id: number) {
    const p = await this.adminDb.planPayment.findUnique({ where: { id } });
    const body = p ? await this.files.read('plan-proofs', p.proofFile) : null;
    if (!p || !body || !p.proofType) throw new ApiError(404, { error: 'not_found', message: 'This proof of payment isn’t here any more.' });
    return { body, type: p.proofType, name: p.proofName ?? 'proof' };
  }

  private async reviewable(id: number) {
    const p = await this.adminDb.planPayment.findUnique({ where: { id }, include: { plan: { select: { name: true } } } });
    if (!p) throw notFound('payment');
    if (p.status !== 'review') throw new ApiError(409, { error: 'not_pending', message: `This payment is already ${p.status}.` });
    const org = await this.adminDb.organization.findUnique({ where: { id: p.organizationId }, select: { name: true } });
    return { p, orgName: org?.name ?? 'your business' };
  }

  /** Verified: the plan changes (add-ons kept), the affiliate's commission is earned. */
  async approve(id: number, body: { note: string | null }, actor: AdminActor) {
    const { p, orgName } = await this.reviewable(id);
    const { count } = await this.adminDb.planPayment.updateMany({ where: { id, status: 'review' }, data: { status: 'approved', reviewedAt: new Date(), reviewedBy: actor.email, reviewNote: body.note } });
    if (!count) throw new ApiError(409, { error: 'not_pending', message: 'This payment was just reviewed by someone else.' });
    try {
      const sub = await this.adminDb.subscription.findUnique({ where: { organizationId: p.organizationId }, include: { addons: true } });
      await this.clients.changePlan(p.organizationId, { planCode: p.planCode, addons: sub?.addons.map((x) => x.addonCode) ?? [], reason: `Payment #${p.id} verified (${usd(p.amountCents)}, ${p.cycle})` }, actor);
    } catch (err) {
      await this.adminDb.planPayment.update({ where: { id }, data: { status: 'review', reviewedAt: null, reviewedBy: null, reviewNote: null } });
      throw err;
    }
    const commission = await this.adminDb.affiliateCommission.findUnique({ where: { paymentId: id }, include: { affiliate: { include: { plan: true } } } });
    if (commission && commission.status === 'pending') {
      await this.adminDb.affiliateCommission.update({ where: { id: commission.id }, data: { status: 'earned', earnedAt: new Date() } });
      const terms = commission.affiliate.plan ?? { promoCode: p.promoCode ?? '', discountPercent: p.discountPercent ?? 0, commissionPercent: commission.commissionPercent };
      this.mailer.sendInBackground(commissionEarnedMail(this.cfg, planOffer(commission.affiliate, terms), { amount: usd(commission.amountCents), plan: `${p.plan.name} (${p.cycle})`, paid: usd(p.amountCents), portalUrl: this.portalUrl }));
    }
    await this.adminDb.billingEvent.create({ data: { organizationId: p.organizationId, type: 'plan_payment_approved', actor: actor.email, reason: body.note, data: { paymentId: id, planCode: p.planCode, amountCents: p.amountCents } } });
    this.mailer.sendInBackground(planPaymentApprovedMail(this.cfg, p.submittedBy, this.mailView(orgName, p), body.note));
    logger.info({ org: p.organizationId, paymentId: id, by: actor.email }, 'Plan payment approved');
    return { ok: true };
  }

  async reject(id: number, body: { reason: string }, actor: AdminActor) {
    const { p, orgName } = await this.reviewable(id);
    const { count } = await this.adminDb.planPayment.updateMany({ where: { id, status: 'review' }, data: { status: 'rejected', reviewedAt: new Date(), reviewedBy: actor.email, reviewNote: body.reason } });
    if (!count) throw new ApiError(409, { error: 'not_pending', message: 'This payment was just reviewed by someone else.' });
    await this.adminDb.affiliateCommission.updateMany({ where: { paymentId: id, status: 'pending' }, data: { status: 'void' } });
    await this.adminDb.billingEvent.create({ data: { organizationId: p.organizationId, type: 'plan_payment_rejected', actor: actor.email, reason: body.reason, data: { paymentId: id, planCode: p.planCode } } });
    this.mailer.sendInBackground(planPaymentRejectedMail(this.cfg, p.submittedBy, this.mailView(orgName, p), body.reason));
    logger.info({ org: p.organizationId, paymentId: id, by: actor.email }, 'Plan payment rejected');
    return { ok: true };
  }
}
