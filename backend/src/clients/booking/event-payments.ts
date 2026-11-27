// Paid events: payment channels, proofs of payment and their verification.
//
// Payment channels (up to 4 per event, set on the event's Details tab): a QR code image (GCash,
// Maya, a bank's QR...) or bank details (bank name, account name, account number). The event
// page shows them on the registration form.
//
// Registration, in two steps:
//   1. reserve: first and last name, email, phone, the number of spots (and a promo code). The
//      spots are "reserved" for 2 hours: the page shows the payment and the proof upload right
//      away, and the same upload link is emailed in case the page is closed (it works once).
//      Full, but some places aren't verified yet: one person (not a bulk booking) joins the
//      "waitlist" instead, and is emailed. When a reservation expires (no proof in 2 hours), the
//      freed spots go to the waitlist in order: each gets a reservation and the payment link.
//   2. the proof of payment (JPG, PNG, WebP or PDF, up to 10 MB, stored on this server,
//      payment-files.ts) with the link: "review" (for verification). The attendee is told it's
//      being verified, and the business's owners and admins are emailed (and the open event page
//      gets a live toast). A proof sent with the registration (one step) goes straight to review.
// On the Attendees tab the business views the proof and:
//   approves -> confirmed, the attendee gets the confirmation and QR code; the proof is deleted
//   rejects  -> "rejected", the attendee is emailed a link to upload a new proof within 10 hours;
//               after that the registration is removed (place freed) and the proof deleted
//
//   POST   /api/client/bookings/events/:id/payment-channels            multipart { type, label, bankName, accountName, accountNumber, file (QR) }
//   PATCH  /api/client/bookings/events/:id/payment-channels/:cid       same; file optional (replaces the QR)
//   DELETE /api/client/bookings/events/:id/payment-channels/:cid
//   GET    /api/client/bookings/events/:id/tickets/:tid/proof          the proof file (inline)
//   POST   /api/client/bookings/events/:id/tickets/:tid/approve
//   POST   /api/client/bookings/events/:id/tickets/:tid/reject         { reason }
//   POST   /api/public/bookings/:slug/events/:event/register-paid      multipart { firstName, lastName, email, phone, file }
//   POST   /api/public/bookings/:slug/events/:event/payment            multipart { token, file }: a new proof after a rejection
//   GET    /api/public/event-files/qr/:file                           a payment QR code image
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Body, Controller, Delete, Get, Header, HttpCode, Inject, Injectable, Param, ParseIntPipe, Patch, Post, Req, Res, UploadedFile, UseInterceptors, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import * as yup from 'yup';
import type { MailAttachment } from '../../auth/mailer';
import { ApiError } from '../../common/api-error';
import { StrictRateLimit } from '../../common/rate-limit';
import { YupValidationPipe } from '../../common/yup-validation.pipe';
import { APP_CONFIG, type AppConfig } from '../../config/config';
import { logger } from '../../logging/logger';
import { ClientsDb } from '../clients-db';
import { ClientRoute, type ClientContext } from '../client-context';
import { ATTENDEE, bookingSpots, EventLive, EventMails, freeCode, logTicket, optionalText, paidData, publicEvent, registerSchema, sameSecret, scopeField, SYSTEM, taken, ticketRow, UNVERIFIED_STATUSES, waiting } from './events';
import { formatMoney, isCurrency } from './money';
import { discountFor, quotePromo, takePromo } from './event-promos';
import { channelRow, MAX_UPLOAD_BYTES, PaymentFiles, sniff, UPLOAD_OPTIONS, type UploadedFileLike } from './payment-files';
import { EVENT_ROUTES } from '../roles';

const ctx = (req: Request) => req.client as ClientContext;

export const MAX_PAYMENT_CHANNELS = 4;
/** After a rejection, the attendee has this long to upload a new proof. */
export const REUPLOAD_MS = 10 * 3_600_000;
/** A reservation (paid, no proof yet) holds its spots this long. */
export const RESERVE_MS = 2 * 3_600_000;

const bankRequired = (message: string) => (s: yup.StringSchema<string | null | undefined>) => s.required(message);
const channelSchema = yup.object({
  type: yup.string().oneOf(['qr', 'bank'], 'Choose QR code or bank details.').required('Choose QR code or bank details.'),
  label: yup.string().trim().min(1, 'Please name it, e.g. GCash or BDO.').max(60).required('Please name it, e.g. GCash or BDO.'),
  bankName: optionalText(100).when('type', { is: 'bank', then: bankRequired('Please enter the bank name.') }),
  accountName: optionalText(120).when('type', { is: 'bank', then: bankRequired('Please enter the account name.') }),
  accountNumber: optionalText(60).when('type', { is: 'bank', then: bankRequired('Please enter the account number.') }),
});
const channelPatchSchema = channelSchema.partial();
const rejectSchema = yup.object({ reason: optionalText(500) });
const proofRequestSchema = yup.object({
  kind: yup.string().oneOf(['replace', 'additional'], 'Choose what to ask for.').required('Choose what to ask for.'),
  note: optionalText(500),
  /** Additional proofs: the amount still due, in the event's currency. */
  amountDue: yup
    .number()
    .typeError('Please enter the amount as a number.')
    .min(0.01, 'Please enter the amount.')
    .max(10_000_000, 'That’s too high.')
    .nullable()
    .transform((v, raw) => (raw === '' || raw === null ? null : v)).when('kind', { is: 'additional', then: (s) => s.required('How much is still to pay?') }),
});
const refundSchema = yup.object({
  type: yup.string().oneOf(['full', 'partial'], 'Choose full or partial.').required('Choose full or partial.'),
  /** The amount refunded and its currency (default: the event's). */
  amount: yup
    .number()
    .typeError('Please enter the amount as a number.')
    .min(0.01, 'Please enter the amount.')
    .max(10_000_000, 'That’s too high.')
    .nullable()
    .transform((v, raw) => (raw === '' || raw === null ? null : v)).when('type', { is: 'partial', then: (s) => s.required('How much did you refund?') }),
  currency: yup
    .string()
    .trim()
    .uppercase()
    .nullable()
    .test('currency', 'Please choose a currency.', (v) => !v || isCurrency(v)),
  note: optionalText(500),
  cancel: yup.boolean().default(false),
  /** A bulk booking: the whole booking (default) or only this spot. */
  scope: scopeField(),
});
const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');
const who = (c: ClientContext) => c.user.name || c.user.email;
/** The paid registration form: the details, and an optional promo code. */
const registerPaidSchema = registerSchema.shape({ promoCode: optionalText(40) });
// (registerSchema has the quantity: places booked at once, one name and email.)
const tokenSchema = yup.object({ token: yup.string().trim().max(100).required('This link isn’t valid.') });

const isUniqueClash = (err: unknown) => (err as { code?: string })?.code === 'P2002';

// ---- Refunds (shared: a direct refund, or a completed refund request) ----

type EventRowT = NonNullable<Awaited<ReturnType<ClientsDb['event']['findFirst']>>>;
type TicketRowT = NonNullable<Awaited<ReturnType<ClientsDb['eventTicket']['findFirst']>>>;

/** What hasn't been refunded yet: what they paid, minus earlier refunds (in the paid currency). */
export async function refundableOf(db: ClientsDb, e: EventRowT, t: TicketRowT) {
  const currency = t.paidCurrency ?? e.currency ?? 'PHP';
  const paid = t.amountPaid !== null ? Number(t.amountPaid) : e.price !== null ? Number(e.price) : 0;
  const earlier = await db.eventRefund.findMany({ where: { ticketId: t.id }, select: { amountValue: true, currency: true } });
  const refunded = earlier.filter((r) => (r.currency ?? currency) === currency).reduce((a, r) => a + Number(r.amountValue ?? 0), 0);
  return { currency, paid, refunded, remaining: Math.max(0, Math.round((paid - refunded) * 100) / 100) };
}

@Injectable()
export class EventRefunds {
  constructor(
    private readonly db: ClientsDb,
    private readonly mails: EventMails,
    private readonly live: EventLive,
    private readonly files: PaymentFiles,
  ) {}

  /**
   * Records a refund made by hand and emails the attendee (the proof of refund attached when
   * given). full: what hasn't been refunded yet (never an amount typed in), optionally cancelling
   * the registration. partial: the given amount.
   */
  async record(orgId: string, e: EventRowT, spotsIn: TicketRowT | TicketRowT[], d: { type: 'full' | 'partial'; amount: number | null; currency: string | null; note: string | null; cancel: boolean; attachment: MailAttachment | null; proofName: string | null }, by: string) {
    // A bulk booking is refunded as one: every spot given (one email, one proof of refund).
    const spots = Array.isArray(spotsIn) ? spotsIn : [spotsIn];
    const lead = spots[0];
    const cancel = d.type === 'full' && d.cancel;
    const lefts = await Promise.all(spots.map((t) => refundableOf(this.db, e, t)));
    const round = (v: number) => Math.round(v * 100) / 100;
    let currency = d.currency ?? e.currency ?? 'PHP';
    let values: number[];
    if (d.type === 'full') {
      currency = lefts[0].currency;
      values = lefts.map((l) => l.remaining);
      if (!values.some(Boolean) && !cancel) throw new ApiError(409, { error: 'nothing_to_refund', message: 'Everything they paid has already been refunded.' });
    } else if (spots.length === 1) {
      values = [d.amount ?? 0];
    } else {
      // Spread over the spots (each up to what's left on it); anything over goes on the first.
      let rest = d.amount ?? 0;
      values = lefts.map((l) => {
        const v = round(Math.min(rest, l.remaining));
        rest = round(rest - v);
        return v;
      });
      if (rest > 0) values[0] = round(values[0] + rest);
    }
    const total = round(values.reduce((a, v) => a + v, 0));
    const amount = total ? formatMoney(total, currency) : null;
    const ids = spots.map((t) => t.id);
    if (cancel) {
      await this.db.eventTicket.updateMany({ where: { id: { in: ids } }, data: { status: 'revoked', revokedAt: new Date(), revokeReason: 'Refunded', reuploadBy: null, uploadTokenHash: null } });
      await this.db.eventPaymentProof.updateMany({ where: { ticketId: { in: ids }, outcome: null }, data: { outcome: 'refunded', outcomeAt: new Date() } });
    }
    // The proof of refund is kept too (with the event's files), not only emailed: one file for the booking.
    const proofFile = d.attachment ? await this.files.store('event-refund-proofs', d.attachment.content as Buffer, d.attachment.contentType) : null;
    const many = spots.length > 1;
    const refunds = [];
    for (const [i, t] of spots.entries()) {
      const value = values[i];
      if (!value && !cancel && i > 0) continue;
      const spotAmount = value ? formatMoney(value, currency) : null;
      refunds.push(
        await this.db.eventRefund.create({
          data: { ticketId: t.id, organizationId: orgId, type: d.type, amount: spotAmount, amountValue: value || null, currency: value ? currency : null, cancelled: cancel, note: d.note, proofName: d.proofName ? d.proofName.slice(0, 200) : null, proofFile, proofType: d.attachment?.contentType ?? null, createdBy: by },
        }),
      );
      await logTicket(this.db, t, d.type === 'partial' ? 'partial_refund' : 'full_refund', by, [spotAmount, many ? `Bulk booking: ${amount ?? 'refund'} over ${spots.length} spots` : null, cancel ? 'Registration cancelled' : null, d.attachment ? 'Proof of refund emailed' : null, d.note].filter(Boolean).join(' · ') || null);
    }
    const updated = await this.db.eventTicket.findUniqueOrThrow({ where: { id: lead.id } });
    await this.mails.refunded(e, updated, { type: d.type, amount, note: d.note, cancelled: cancel, attachment: d.attachment, spots: spots.length });
    this.live.emit({ eventId: e.id, type: 'refunded', name: updated.name, by });
    logger.info({ org: orgId, eventId: e.id, ticketId: lead.id, places: spots.length, type: d.type, cancelled: cancel }, 'Event refund recorded');
    return { refund: refunds[0], refunds, ticket: updated, places: spots.length };
  }
}

// ---- The business's side ----

@Controller('client/bookings/events/:id')
export class EventPaymentsController {
  constructor(
    private readonly db: ClientsDb,
    private readonly files: PaymentFiles,
    private readonly mails: EventMails,
    private readonly live: EventLive,
    private readonly refunds: EventRefunds,
  ) {}

  private async event(orgId: string, id: number) {
    const e = await this.db.event.findFirst({ where: { id, organizationId: orgId } });
    if (!e) throw new ApiError(404, { error: 'not_found', message: 'That event does not exist.' });
    return e;
  }

  private async channel(eventId: number, cid: number) {
    const ch = await this.db.eventPaymentChannel.findFirst({ where: { id: cid, eventId } });
    if (!ch) throw new ApiError(404, { error: 'not_found', message: 'That payment channel does not exist.' });
    return ch;
  }

  private async ticket(orgId: string, eventId: number, tid: number) {
    const t = await this.db.eventTicket.findFirst({ where: { id: tid, eventId, organizationId: orgId } });
    if (!t) throw new ApiError(404, { error: 'not_found', message: 'That registration does not exist.' });
    return t;
  }

  /** Bank channels keep only bank fields; QR channels may show an account name and number too. */
  private fields(body: Partial<yup.InferType<typeof channelSchema>>, type: string) {
    const data: Record<string, unknown> = {};
    for (const k of ['label', 'bankName', 'accountName', 'accountNumber'] as const) if (body[k] !== undefined) data[k] = body[k] ?? null;
    if (body.type) data.type = body.type;
    if (type === 'qr') data.bankName = null;
    return data;
  }

  @Post('payment-channels')
  @ClientRoute(EVENT_ROUTES.manage)
  @UseInterceptors(FileInterceptor('file', UPLOAD_OPTIONS))
  async addChannel(@Req() req: Request, @Param('id', ParseIntPipe) id: number, @Body(new YupValidationPipe(channelSchema)) body: yup.InferType<typeof channelSchema>, @UploadedFile() file?: UploadedFileLike) {
    const c = ctx(req);
    await this.event(c.org.id, id);
    const count = await this.db.eventPaymentChannel.count({ where: { eventId: id } });
    if (count >= MAX_PAYMENT_CHANNELS) throw new ApiError(403, { error: 'channel_limit', message: `An event can have up to ${MAX_PAYMENT_CHANNELS} payment channels. Delete one to add another.` });
    const qr = body.type === 'qr' ? await this.files.save('event-payment-qr', file, { allowPdf: false, field: 'file' }) : null;
    const ch = await this.db.eventPaymentChannel.create({
      data: { eventId: id, organizationId: c.org.id, position: count, ...this.fields(body, body.type), type: body.type, label: body.label, qrFile: qr?.file ?? null, qrType: qr?.type ?? null } as never,
    });
    logger.info({ org: c.org.id, eventId: id, channelId: ch.id, type: ch.type }, 'Event payment channel added');
    return channelRow(ch);
  }

  @Patch('payment-channels/:cid')
  @ClientRoute(EVENT_ROUTES.manage)
  @UseInterceptors(FileInterceptor('file', UPLOAD_OPTIONS))
  async updateChannel(@Req() req: Request, @Param('id', ParseIntPipe) id: number, @Param('cid', ParseIntPipe) cid: number, @Body(new YupValidationPipe(channelPatchSchema)) body: yup.InferType<typeof channelPatchSchema>, @UploadedFile() file?: UploadedFileLike) {
    await this.event(ctx(req).org.id, id);
    const before = await this.channel(id, cid);
    const type = body.type ?? before.type;
    if (type === 'bank') {
      const merged = { bankName: body.bankName !== undefined ? body.bankName : before.bankName, accountName: body.accountName !== undefined ? body.accountName : before.accountName, accountNumber: body.accountNumber !== undefined ? body.accountNumber : before.accountNumber };
      const missing = Object.entries(merged).filter(([, v]) => !v).map(([k]) => k);
      if (missing.length) throw new ApiError(400, { error: 'validation_failed', message: 'Please fill in the bank name, account name and account number.', fields: Object.fromEntries(missing.map((k) => [k, 'Required.'])) });
    }
    const data = this.fields(body, type);
    let oldQr: string | null = null;
    if (type === 'qr' && (file || !before.qrFile)) {
      const qr = await this.files.save('event-payment-qr', file, { allowPdf: false, field: 'file' });
      Object.assign(data, { qrFile: qr.file, qrType: qr.type });
      oldQr = before.qrFile;
    } else if (type === 'bank' && before.qrFile) {
      Object.assign(data, { qrFile: null, qrType: null });
      oldQr = before.qrFile;
    }
    const ch = await this.db.eventPaymentChannel.update({ where: { id: cid }, data });
    await this.files.remove('event-payment-qr', oldQr);
    return channelRow(ch);
  }

  @Delete('payment-channels/:cid')
  @ClientRoute(EVENT_ROUTES.manage)
  async deleteChannel(@Req() req: Request, @Param('id', ParseIntPipe) id: number, @Param('cid', ParseIntPipe) cid: number) {
    const e = await this.event(ctx(req).org.id, id);
    const ch = await this.channel(id, cid);
    // A published paid event keeps at least one way to pay.
    if (e.kind === 'paid' && e.published && (await this.db.eventPaymentChannel.count({ where: { eventId: id } })) <= 1) {
      throw new ApiError(409, { error: 'last_payment_channel', message: 'This is the event’s only payment channel. Add another one first, or unpublish the event.' });
    }
    await this.db.eventPaymentChannel.delete({ where: { id: cid } });
    await this.files.remove('event-payment-qr', ch.qrFile);
    return { ok: true };
  }

  /** One proof of payment, shown in the app's file viewer (images and PDFs open inline). */
  @Get('tickets/:tid/proofs/:pid')
  @ClientRoute(EVENT_ROUTES.payments)
  async proof(@Req() req: Request, @Param('id', ParseIntPipe) id: number, @Param('tid', ParseIntPipe) tid: number, @Param('pid', ParseIntPipe) pid: number, @Res() res: Response) {
    await this.ticket(ctx(req).org.id, id, tid);
    const p = await this.db.eventPaymentProof.findFirst({ where: { id: pid, ticketId: tid } });
    const body = p ? await this.files.read('event-proofs', p.file) : null;
    if (!p || !body) throw new ApiError(404, { error: 'not_found', message: 'This proof of payment isn’t here any more.' });
    res
      .status(200)
      .set({
        'Content-Type': p.type,
        'Content-Disposition': `inline; filename="proof-of-payment-${tid}-${p.id}.${p.file.split('.').pop()}"`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      })
      .send(body);
  }

  /** Settles a registration's current proofs with this outcome. The files stay until the event is deleted. */
  private async settleProofs(ticketId: number, outcome: 'approved' | 'rejected' | 'refunded') {
    await this.db.eventPaymentProof.updateMany({ where: { ticketId, outcome: null }, data: { outcome, outcomeAt: new Date() } });
  }

  /** A proof of refund (kept with the refund). */
  @Get('refunds/:rid/proof')
  @ClientRoute(EVENT_ROUTES.payments)
  async refundProof(@Req() req: Request, @Param('id', ParseIntPipe) id: number, @Param('rid', ParseIntPipe) rid: number, @Res() res: Response) {
    await this.event(ctx(req).org.id, id);
    const r = await this.db.eventRefund.findFirst({ where: { id: rid, ticket: { eventId: id } } });
    const body = r ? await this.files.read('event-refund-proofs', r.proofFile) : null;
    if (!r || !body || !r.proofType) throw new ApiError(404, { error: 'not_found', message: 'There’s no proof of refund for this refund.' });
    res
      .status(200)
      .set({ 'Content-Type': r.proofType, 'Content-Disposition': `inline; filename="proof-of-refund-${r.id}.${r.proofFile!.split('.').pop()}"`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' })
      .send(body);
  }

  /** The places verified together: a bulk booking's whole group (in these statuses), or just this one. */
  private async group(t: { id: number; groupId: string | null }, statuses: string[]) {
    if (!t.groupId) return [t.id];
    const rows = await this.db.eventTicket.findMany({ where: { groupId: t.groupId, status: { in: statuses } }, select: { id: true }, orderBy: { id: 'asc' } });
    return rows.map((r) => r.id);
  }

  @Post('tickets/:tid/approve')
  @HttpCode(200)
  @ClientRoute(EVENT_ROUTES.payments)
  async approve(@Req() req: Request, @Param('id', ParseIntPipe) id: number, @Param('tid', ParseIntPipe) tid: number) {
    const c = ctx(req);
    const e = await this.event(c.org.id, id);
    const t = await this.ticket(c.org.id, id, tid);
    if (t.status !== 'review') throw new ApiError(409, { error: 'not_in_review', message: t.status === 'confirmed' ? 'This payment is already approved.' : 'There’s no payment to verify for this registration.' });
    // A bulk booking's places are approved together (one proof of payment).
    const ids = await this.group(t, ['review']);
    const now = new Date();
    const approved = [];
    for (const pid of ids) {
      const p = await this.db.eventTicket.findUniqueOrThrow({ where: { id: pid } });
      const { count } = await this.db.eventTicket.updateMany({
        where: { id: pid, status: 'review' },
        // The check-in code is given now that the payment is confirmed.
        data: { code: p.code ?? (await freeCode(this.db, c.org.id)), status: 'confirmed', confirmedAt: now, paymentReviewedAt: now, paymentReviewedBy: who(c), paymentNote: null, reuploadBy: null, proofRequest: null, amountDue: null, uploadTokenHash: null, ...paidData(e, 'proof', e.price === null ? null : Math.max(0, Number(e.price) - (p.discount === null ? 0 : Number(p.discount)))) },
      });
      if (!count) continue;
      await this.settleProofs(pid, 'approved');
      const u = await this.db.eventTicket.findUniqueOrThrow({ where: { id: pid } });
      approved.push(u);
      await logTicket(this.db, u, 'payment_approved', who(c), [u.amountPaid !== null && e.currency ? formatMoney(Number(u.amountPaid), e.currency) : null, ids.length > 1 ? `Bulk booking: ${ids.length} spots` : null, 'Confirmation and QR code emailed'].filter(Boolean).join(' · '));
    }
    if (!approved.length) throw new ApiError(409, { error: 'not_in_review', message: 'There’s no payment to verify for this registration.' });
    // One email: every place's QR code (and, for several, the PDF with all of them).
    await this.mails.bulkConfirmation(e, approved);
    this.live.emit({ eventId: id, type: 'payment_approved', name: approved.length > 1 ? `${approved[0].name} (${approved.length} spots)` : approved[0].name, by: who(c) });
    logger.info({ org: c.org.id, eventId: id, ticketId: tid, places: approved.length }, 'Event payment approved');
    return { ...ticketRow(approved.find((u) => u.id === tid) ?? approved[0]), places: approved.length };
  }

  /** Not approved: the attendee is emailed (no new upload), the registration (all its places) is cancelled. */
  @Post('tickets/:tid/reject')
  @HttpCode(200)
  @ClientRoute(EVENT_ROUTES.payments)
  async reject(@Req() req: Request, @Param('id', ParseIntPipe) id: number, @Param('tid', ParseIntPipe) tid: number, @Body(new YupValidationPipe(rejectSchema)) body: yup.InferType<typeof rejectSchema>) {
    const c = ctx(req);
    const e = await this.event(c.org.id, id);
    const t = await this.ticket(c.org.id, id, tid);
    if (t.status !== 'review' && t.status !== 'rejected') throw new ApiError(409, { error: 'not_in_review', message: 'There’s no payment to verify for this registration.' });
    const ids = await this.group(t, ['review', 'rejected']);
    const now = new Date();
    const { count } = await this.db.eventTicket.updateMany({
      where: { id: { in: ids }, status: { in: ['review', 'rejected'] } },
      data: { status: 'revoked', revokedAt: now, revokeReason: body.reason ? `Payment not approved: ${body.reason}`.slice(0, 500) : 'Payment not approved', reuploadBy: null, uploadTokenHash: null, paymentReviewedAt: now, paymentReviewedBy: who(c) },
    });
    if (!count) throw new ApiError(409, { error: 'not_in_review', message: 'There’s no payment to verify for this registration.' });
    for (const pid of ids) {
      await this.settleProofs(pid, 'rejected');
      await logTicket(this.db, { id: pid, organizationId: t.organizationId }, 'payment_rejected', who(c), body.reason ?? null);
    }
    const updated = await this.db.eventTicket.findUniqueOrThrow({ where: { id: tid } });
    await this.mails.paymentNotApproved(e, updated, body.reason ?? null);
    this.live.emit({ eventId: id, type: 'payment_rejected', name: updated.name });
    logger.info({ org: c.org.id, eventId: id, ticketId: tid, places: ids.length }, 'Event payment not approved');
    return ticketRow(updated);
  }

  /**
   * Ask for a proof: another one instead (replace) or one more (additional: e.g. the rest of an
   * insufficient amount, amountDue). The attendee gets a new, unique upload link (any earlier one
   * stops working) and 10 hours; then the registration is removed and the place freed. A bulk
   * booking's places share the request (and the link).
   */
  @Post('tickets/:tid/request-proof')
  @HttpCode(200)
  @ClientRoute(EVENT_ROUTES.payments)
  async requestProof(@Req() req: Request, @Param('id', ParseIntPipe) id: number, @Param('tid', ParseIntPipe) tid: number, @Body(new YupValidationPipe(proofRequestSchema)) body: yup.InferType<typeof proofRequestSchema>) {
    const c = ctx(req);
    const e = await this.event(c.org.id, id);
    const t = await this.ticket(c.org.id, id, tid);
    if (t.status !== 'review' && t.status !== 'rejected') throw new ApiError(409, { error: 'not_in_review', message: 'There’s no payment to verify for this registration.' });
    const ids = await this.group(t, ['review', 'rejected']);
    const token = randomBytes(24).toString('hex');
    const now = new Date();
    const { count } = await this.db.eventTicket.updateMany({
      where: { id: { in: ids }, status: { in: ['review', 'rejected'] } },
      data: {
        status: 'rejected',
        proofRequest: body.kind,
        amountDue: body.kind === 'additional' && body.amountDue ? formatMoney(body.amountDue, e.currency ?? 'PHP') : null,
        paymentNote: body.note ?? null,
        reuploadBy: new Date(now.getTime() + REUPLOAD_MS),
        uploadTokenHash: sha256(token),
        paymentReviewedAt: now,
        paymentReviewedBy: who(c),
      },
    });
    if (!count) throw new ApiError(409, { error: 'not_in_review', message: 'There’s no payment to verify for this registration.' });
    const updated = await this.db.eventTicket.findUniqueOrThrow({ where: { id: tid } });
    await this.mails.proofRequested(e, updated, token);
    this.live.emit({ eventId: id, type: 'payment_rejected', name: updated.name });
    for (const pid of ids) {
      await logTicket(this.db, { id: pid, organizationId: t.organizationId }, body.kind === 'additional' ? 'additional_proof_requested' : 'another_proof_requested', who(c), [updated.amountDue ? `Still to pay ${updated.amountDue}` : null, body.note ?? null, 'Upload link emailed (10 hours)'].filter(Boolean).join(' · '));
    }
    logger.info({ org: c.org.id, eventId: id, ticketId: tid, kind: body.kind, places: ids.length }, 'Event proof of payment requested');
    return ticketRow(updated);
  }

  /**
   * A refund the business made by hand, told to the attendee by email (the proof of refund
   * attached, not kept). full: optionally cancels the registration (place freed, QR code stops
   * working, proofs deleted). partial: an excess amount paid back; the proof of refund is required.
   */
  @Post('tickets/:tid/refund')
  @HttpCode(200)
  @ClientRoute(EVENT_ROUTES.payments)
  @UseInterceptors(FileInterceptor('file', UPLOAD_OPTIONS))
  async refund(@Req() req: Request, @Param('id', ParseIntPipe) id: number, @Param('tid', ParseIntPipe) tid: number, @Body(new YupValidationPipe(refundSchema)) body: yup.InferType<typeof refundSchema>, @UploadedFile() file?: UploadedFileLike) {
    const c = ctx(req);
    const e = await this.event(c.org.id, id);
    if (e.kind !== 'paid') throw new ApiError(409, { error: 'free_event', message: 'Refunds are for paid events.' });
    const t = await this.ticket(c.org.id, id, tid);
    const allowed = body.type === 'partial' ? ['confirmed', 'review'] : ['confirmed', 'review', 'rejected'];
    if (!allowed.includes(t.status)) throw new ApiError(409, { error: 'not_refundable', message: body.type === 'partial' ? 'A partial refund is for a paid, active registration.' : 'This registration isn’t active.' });
    if (body.type === 'partial' && !file) throw new ApiError(400, { error: 'file_missing', message: 'Please attach the proof of refund.', fields: { file: 'Required for a partial refund.' } });
    let attachment: MailAttachment | null = null;
    if (file) {
      const kind = sniff(file.buffer, true);
      if (!kind || file.size > MAX_UPLOAD_BYTES) throw new ApiError(400, { error: 'file_type', message: 'Please attach an image (JPG, PNG or WebP) or a PDF, up to 10 MB.', fields: { file: 'Wrong file.' } });
      attachment = { filename: `proof-of-refund.${kind.ext}`, content: file.buffer, contentType: kind.type };
    }
    const spots = body.scope === 'spot' ? [t] : await bookingSpots(this.db, t, allowed);
    const { ticket, places } = await this.refunds.record(c.org.id, e, spots.length ? spots : [t], { type: body.type, amount: body.amount ?? null, currency: body.currency ?? null, note: body.note ?? null, cancel: body.type === 'full' && body.cancel === true, attachment, proofName: file ? file.originalname : null }, who(c));
    return { ...ticketRow(ticket), places };
  }
}

// ---- The public side ----

/** "{ticket id}.{secret}" from an upload link, checked against the current request's secret. */
async function ticketByUploadToken(db: ClientsDb, e: { id: number }, raw: unknown) {
  const m = typeof raw === 'string' ? /^(\d+)\.([0-9a-f]{48})$/.exec(raw) : null;
  const t = m ? await db.eventTicket.findFirst({ where: { id: Number(m[1]), eventId: e.id } }) : null;
  if (!t || !t.uploadTokenHash || !sameSecret(t.uploadTokenHash, sha256(m![2]))) {
    throw new ApiError(404, { error: 'bad_link', message: 'This upload link isn’t valid any more. Please use the link in your latest email.' });
  }
  return t;
}

@Controller('public/bookings/:slug/events')
export class PublicEventPaymentsController {
  constructor(
    private readonly db: ClientsDb,
    private readonly files: PaymentFiles,
    private readonly mails: EventMails,
    private readonly live: EventLive,
  ) {}

  @Post(':event/register-paid')
  @StrictRateLimit()
  @UseInterceptors(FileInterceptor('file', UPLOAD_OPTIONS))
  async register(@Param('slug') slug: string, @Param('event') eventSlug: string, @Body(new YupValidationPipe(registerPaidSchema)) body: yup.InferType<typeof registerPaidSchema>, @UploadedFile() file?: UploadedFileLike) {
    const { e } = await publicEvent(this.db, slug, eventSlug);
    if (e.kind !== 'paid') throw new ApiError(409, { error: 'free_event', message: 'This event is free: just fill in your details.' });
    if (e.endsAt <= new Date()) throw new ApiError(409, { error: 'over', message: 'This event is over.' });
    // With a proof: one step, straight to review. Without: reserved, the proof follows with the link.
    const proof = file ? await this.files.save('event-proofs', file, { allowPdf: true, field: 'file' }) : null;
    const quantity = body.quantity ?? 1;
    const name = `${body.firstName} ${body.lastName}`;
    const secret = randomBytes(24).toString('hex');
    const until = new Date(Date.now() + RESERVE_MS);
    try {
      const made = await this.db.$transaction(async (tx) => {
        // Checked with the event locked: two bookings at once can't overbook it.
        await tx.$queryRaw`SELECT "id" FROM "booking"."events" WHERE "id" = ${e.id} FOR UPDATE`;
        if (e.capacity !== null) {
          // The waitlist comes first: its people get the next freed places.
          const queue = await waiting(tx, e.id);
          const left = Math.max(0, e.capacity - (await taken(tx, e.id)) - queue);
          if (quantity > left) {
            const unverified = await tx.eventTicket.count({ where: { eventId: e.id, status: { in: UNVERIFIED_STATUSES } } });
            const canWait = !proof && (unverified > 0 || queue > 0);
            if (quantity > 1) {
              throw new ApiError(409, {
                error: 'not_enough_places',
                message: left
                  ? `Sorry, there aren’t enough spots for ${quantity} people: only ${left} left.${canWait ? ' Bulk bookings can’t join the waitlist.' : ''}`
                  : `Sorry, there aren’t enough spots for ${quantity} people.${canWait ? ' All the spots are reserved, and bulk bookings can’t join the waitlist.' : ' The event is full.'}`,
                fields: { quantity: left ? `At most ${left}.` : 'Not enough spots.' },
              });
            }
            if (!canWait) throw new ApiError(409, { error: 'full', message: 'Sorry, the event is full.', fields: { quantity: 'The event is full.' } });
            // One person, full but not every place is verified yet: the waitlist.
            if (await tx.eventTicket.count({ where: { eventId: e.id, status: 'waitlist', email: { equals: body.email, mode: 'insensitive' } } })) {
              throw new ApiError(409, { error: 'already_waiting', message: 'This email address is already on the waitlist for this event.', fields: { email: 'Already on the waitlist.' } });
            }
            // A promo code is checked now and used if a spot is offered.
            let promoCode: string | null = null;
            if (body.promoCode) {
              const q = await quotePromo(tx, e, body.promoCode, 1);
              if (!q.valid) throw new ApiError(400, { error: 'bad_promo', message: q.reason ?? 'This promo code isn’t valid for this event.', fields: { promoCode: q.reason ?? 'Not valid.' } });
              promoCode = q.code;
            }
            const w = await tx.eventTicket.create({ data: { eventId: e.id, organizationId: e.organizationId, name, email: body.email, phone: body.phone, status: 'waitlist', source: 'payment', promoCode } });
            return { kind: 'waitlist' as const, tickets: [w], position: queue + 1 };
          }
        }
        // A promo code: one use per place, until its uses run out (the rest pay the full price).
        const { promo, granted } = await takePromo(tx, e.id, body.promoCode, quantity);
        const price = e.price === null ? 0 : Number(e.price);
        const groupId = quantity > 1 ? randomUUID() : null;
        const tickets = [];
        for (let i = 0; i < quantity; i++) {
          const discount = promo && i < granted ? discountFor(promo, price) : null;
          const created = await tx.eventTicket.create({
            data: {
              eventId: e.id,
              organizationId: e.organizationId,
              name,
              email: body.email,
              phone: body.phone,
              // No check-in code until the payment is confirmed.
              status: proof ? 'review' : 'reserved',
              ...(proof ? {} : { reuploadBy: until, uploadTokenHash: sha256(secret) }),
              source: 'payment',
              ...(groupId ? { groupId, groupSize: quantity } : {}),
              ...(discount !== null ? { promoCodeId: promo!.id, promoCode: promo!.code, discount } : {}),
            },
          });
          // One proof of payment for the whole booking: each place points to it.
          if (proof) await tx.eventPaymentProof.create({ data: { ticketId: created.id, organizationId: e.organizationId, file: proof.file, name: proof.originalName, type: proof.type, size: proof.size } });
          tickets.push(created);
        }
        return { kind: proof ? ('review' as const) : ('reserved' as const), tickets, position: 0 };
      });
      const t = made.tickets[0];
      if (made.kind === 'waitlist') {
        await this.mails.waitlisted(e, t);
        await logTicket(this.db, t, 'waitlisted', ATTENDEE, `On the event page: the event was full · #${made.position} in line${t.promoCode ? ` · promo ${t.promoCode} (used if a spot is offered)` : ''}`);
        this.live.emit({ eventId: e.id, type: 'waitlisted', name: t.name });
        logger.info({ eventId: e.id, ticketId: t.id, position: made.position }, 'Event waitlist');
        return { waitlisted: true, name: t.name, email: t.email, position: made.position };
      }
      const tickets = made.tickets;
      const price = e.price === null ? 0 : Number(e.price);
      const toPay = tickets.reduce((a, x) => a + Math.max(0, price - (x.discount === null ? 0 : Number(x.discount))), 0);
      const amountLabel = e.currency ? formatMoney(toPay, e.currency) : null;
      for (const [i, x] of tickets.entries()) {
        await logTicket(this.db, x, made.kind === 'reserved' ? 'reserved' : 'registered', ATTENDEE, [made.kind === 'reserved' ? 'On the event page: reserved for 2 hours' : 'On the event page, with a proof of payment', quantity > 1 ? `Bulk booking: spot ${i + 1} of ${quantity}` : null, x.promoCode && x.discount !== null && e.currency ? `Promo ${x.promoCode}: ${formatMoney(Number(x.discount), e.currency)} off` : null].filter(Boolean).join(' · '));
        if (proof) await logTicket(this.db, x, 'proof_uploaded', ATTENDEE, proof.originalName);
      }
      const common = { name: t.name, email: t.email, places: quantity, promoCode: t.promoCode, promoted: tickets.filter((x) => x.promoCode).length, amountLabel };
      if (made.kind === 'reserved') {
        // The upload link is on the page now, and emailed in case it's closed.
        await this.mails.reserved(e, t, secret, { places: quantity, amountLabel, fromWaitlist: false });
        this.live.emit({ eventId: e.id, type: 'reserved', name: t.name });
        logger.info({ eventId: e.id, ticketId: t.id, places: quantity }, 'Event spots reserved');
        return { reserved: true, ...common, token: `${t.id}.${secret}`, reservedUntil: until };
      }
      await this.mails.paymentReceived(e, t);
      await this.mails.paymentToVerify(e, t, false);
      this.live.emit({ eventId: e.id, type: 'payment_submitted', name: t.name });
      logger.info({ eventId: e.id, ticketId: t.id, places: quantity }, 'Event registration with proof of payment');
      return { review: true, ...common };
    } catch (err) {
      if (proof) await this.files.remove('event-proofs', proof.file);
      if (isUniqueClash(err)) throw new ApiError(409, { error: 'already_registered', message: 'This email address is already registered for this event.', fields: { email: 'Already registered.' } });
      throw err;
    }
  }

  /** What an upload link is for (X-Upload-Token): another or an additional proof, until when. */
  @Get(':event/upload-request')
  @Header('Cache-Control', 'no-store')
  async uploadRequest(@Req() req: Request, @Param('slug') slug: string, @Param('event') eventSlug: string) {
    const { e } = await publicEvent(this.db, slug, eventSlug);
    const t = await ticketByUploadToken(this.db, e, req.headers['x-upload-token']);
    // A reservation: what to pay for its spots.
    const spots = t.groupId ? await this.db.eventTicket.findMany({ where: { groupId: t.groupId, status: t.status, uploadTokenHash: t.uploadTokenHash } }) : [t];
    const price = e.price === null ? 0 : Number(e.price);
    const toPay = spots.reduce((a, x) => a + Math.max(0, price - (x.discount === null ? 0 : Number(x.discount))), 0);
    return {
      name: t.name,
      email: t.email,
      status: t.status,
      kind: t.status === 'reserved' ? 'first' : t.proofRequest,
      amountDue: t.amountDue,
      note: t.paymentNote,
      reuploadBy: t.reuploadBy,
      places: spots.length,
      amountLabel: e.currency ? formatMoney(toPay, e.currency) : null,
      promoCode: t.promoCode,
      promoted: spots.filter((x) => x.promoCode && x.discount !== null).length,
    };
  }

  /** The reservation's proof (within 2 hours), or one asked for (within 10 hours), with the link. It works once. */
  @Post(':event/payment')
  @HttpCode(200)
  @StrictRateLimit()
  @UseInterceptors(FileInterceptor('file', UPLOAD_OPTIONS))
  async reupload(@Param('slug') slug: string, @Param('event') eventSlug: string, @Body(new YupValidationPipe(tokenSchema)) body: yup.InferType<typeof tokenSchema>, @UploadedFile() file?: UploadedFileLike) {
    const { e } = await publicEvent(this.db, slug, eventSlug);
    const t = await ticketByUploadToken(this.db, e, body.token);
    const from = t.status;
    if ((from !== 'rejected' && from !== 'reserved') || !t.reuploadBy || t.reuploadBy <= new Date()) {
      throw new ApiError(410, { error: 'expired', message: from === 'reserved' || from === 'revoked' ? 'The 2 hours to send the proof have passed, so the reservation expired and the spot was released. You can register again while spots are left.' : 'The time to upload has passed, so the spot was released. You can register again while spots are left.' });
    }
    const first = from === 'reserved';
    const proof = await this.files.save('event-proofs', file, { allowPdf: true, field: 'file' });
    const replace = !first && t.proofRequest !== 'additional';
    // A bulk booking's places share the link: the proof goes to all of them.
    const places = t.groupId ? (await this.db.eventTicket.findMany({ where: { groupId: t.groupId, status: from, uploadTokenHash: t.uploadTokenHash }, select: { id: true } })).map((x) => x.id) : [t.id];
    const ok = await this.db.$transaction(async (tx) => {
      // The link works once: its secret is cleared with the upload.
      const { count } = await tx.eventTicket.updateMany({ where: { id: { in: places }, status: from, uploadTokenHash: t.uploadTokenHash }, data: { status: 'review', reuploadBy: null, uploadTokenHash: null } });
      if (!count) return false;
      for (const pid of places) {
        // Replaced proofs stay (with their files) in the history.
        if (replace) await tx.eventPaymentProof.updateMany({ where: { ticketId: pid, outcome: null }, data: { outcome: 'replaced', outcomeAt: new Date() } });
        await tx.eventPaymentProof.create({ data: { ticketId: pid, organizationId: t.organizationId, file: proof.file, name: proof.originalName, type: proof.type, size: proof.size } });
      }
      return true;
    });
    if (!ok) {
      await this.files.remove('event-proofs', proof.file);
      throw new ApiError(409, { error: 'changed', message: 'This request changed meanwhile. Please use the link in your latest email.' });
    }
    const updated = await this.db.eventTicket.findUniqueOrThrow({ where: { id: t.id } });
    await this.mails.paymentReceived(e, updated);
    await this.mails.paymentToVerify(e, updated, !first);
    this.live.emit({ eventId: e.id, type: 'payment_submitted', name: updated.name });
    for (const pid of places) await logTicket(this.db, { id: pid, organizationId: t.organizationId }, 'proof_uploaded', ATTENDEE, first ? proof.originalName : `${replace ? 'Another proof (replaces the last)' : 'Additional proof'}: ${proof.originalName}`);
    logger.info({ eventId: e.id, ticketId: t.id, kind: first ? 'first' : replace ? 'replace' : 'additional' }, 'Event proof of payment uploaded with the link');
    return { review: true, first, name: updated.name, email: updated.email, places: places.length };
  }
}

/** The payment QR codes shown on event pages (random, unguessable names). */
@Controller('public/event-files')
export class PublicEventFilesController {
  constructor(
    private readonly db: ClientsDb,
    private readonly files: PaymentFiles,
  ) {}

  @Get('qr/:file')
  async qr(@Param('file') name: string, @Res() res: Response) {
    const ch = await this.db.eventPaymentChannel.findFirst({ where: { qrFile: name }, select: { qrType: true } });
    const body = ch ? await this.files.read('event-payment-qr', name) : null;
    if (!body || !ch?.qrType) throw new ApiError(404, { error: 'not_found', message: 'That image does not exist.' });
    res.status(200).set({ 'Content-Type': ch.qrType, 'Cache-Control': 'public, max-age=86400, immutable', 'X-Content-Type-Options': 'nosniff' }).send(body);
  }

  /** An event's cover photo or logo (shown on its page). */
  @Get('media/:file')
  async media(@Param('file') name: string, @Res() res: Response) {
    const e = await this.db.event.findFirst({ where: { OR: [{ coverFile: name }, { logoFile: name }] }, select: { coverFile: true, coverType: true, logoType: true } });
    const type = e ? (e.coverFile === name ? e.coverType : e.logoType) : null;
    const body = e ? await this.files.read('event-media', name) : null;
    if (!body || !type) throw new ApiError(404, { error: 'not_found', message: 'That image does not exist.' });
    res.status(200).set({ 'Content-Type': type, 'Cache-Control': 'public, max-age=86400, immutable', 'X-Content-Type-Options': 'nosniff' }).send(body);
  }
}

/** Cover photo (wide, up to 2000 px) and logo (up to 600 px): images only, stored as WebP. */
const MEDIA = { cover: { maxSide: 2000, quality: 80 }, logo: { maxSide: 600, quality: 90 } } as const;

@Controller('client/bookings/events/:id/media')
export class EventMediaController {
  constructor(
    private readonly db: ClientsDb,
    private readonly files: PaymentFiles,
  ) {}

  private kind(raw: string) {
    if (raw !== 'cover' && raw !== 'logo') throw new ApiError(404, { error: 'not_found', message: 'Not found.' });
    return raw;
  }

  @Post(':kind')
  @HttpCode(200)
  @ClientRoute(EVENT_ROUTES.manage)
  @UseInterceptors(FileInterceptor('file', UPLOAD_OPTIONS))
  async upload(@Req() req: Request, @Param('id', ParseIntPipe) id: number, @Param('kind') raw: string, @UploadedFile() file?: UploadedFileLike) {
    const kind = this.kind(raw);
    const e = await this.db.event.findFirst({ where: { id, organizationId: ctx(req).org.id } });
    if (!e) throw new ApiError(404, { error: 'not_found', message: 'That event does not exist.' });
    const saved = await this.files.save('event-media', file, { allowPdf: false, field: 'file', image: MEDIA[kind] });
    const old = kind === 'cover' ? e.coverFile : e.logoFile;
    const data = kind === 'cover' ? { coverFile: saved.file, coverType: saved.type } : { logoFile: saved.file, logoType: saved.type };
    await this.db.event.update({ where: { id }, data });
    await this.files.remove('event-media', old);
    return { url: mediaUrl(saved.file) };
  }

  @Delete(':kind')
  @ClientRoute(EVENT_ROUTES.manage)
  async remove(@Req() req: Request, @Param('id', ParseIntPipe) id: number, @Param('kind') raw: string) {
    const kind = this.kind(raw);
    const e = await this.db.event.findFirst({ where: { id, organizationId: ctx(req).org.id } });
    if (!e) throw new ApiError(404, { error: 'not_found', message: 'That event does not exist.' });
    const old = kind === 'cover' ? e.coverFile : e.logoFile;
    await this.db.event.update({ where: { id }, data: kind === 'cover' ? { coverFile: null, coverType: null } : { logoFile: null, logoType: null } });
    await this.files.remove('event-media', old);
    return { ok: true };
  }
}

export const mediaUrl = (file: string | null) => (file ? `/api/public/event-files/media/${file}` : null);

// ---- The 10-hour re-upload window, and stray files ----

@Injectable()
export class PaymentReviewJob implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  private lastSweep = 0;

  constructor(
    private readonly db: ClientsDb,
    private readonly files: PaymentFiles,
    private readonly mails: EventMails,
    private readonly live: EventLive,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  onModuleInit() {
    if (this.cfg.nodeEnv === 'test') return;
    this.timer = setInterval(() => void this.run(), 60_000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Reservations whose 2 hours are up: the spots are freed (revoked), their promo uses given back, the attendee told. */
  private async expireReservations(now: Date) {
    const due = await this.db.eventTicket.findMany({ where: { status: 'reserved', reuploadBy: { lte: now } }, include: { event: true }, take: 200 });
    const told = new Set<string>();
    let n = 0;
    for (const t of due) {
      const freed = await this.db.$transaction(async (tx) => {
        const { count } = await tx.eventTicket.updateMany({ where: { id: t.id, status: 'reserved' }, data: { status: 'revoked', revokedAt: now, revokeReason: 'Reservation expired: no proof of payment within 2 hours', reuploadBy: null, uploadTokenHash: null } });
        if (count && t.promoCodeId && t.discount !== null) await tx.eventPromoCode.updateMany({ where: { id: t.promoCodeId, used: { gt: 0 } }, data: { used: { decrement: 1 } } });
        return count > 0;
      });
      if (!freed) continue;
      await logTicket(this.db, t, 'expired', SYSTEM, 'Reservation expired: no proof within 2 hours, spot released');
      // One email per booking (a bulk booking's places expire together).
      if (t.event.endsAt > now && (!t.groupId || !told.has(t.groupId))) await this.mails.paymentExpired(t.event, t, true);
      if (t.groupId) told.add(t.groupId);
      this.live.emit({ eventId: t.eventId, type: 'payment_expired', name: t.name });
      n++;
    }
    return n;
  }

  /** Freed places go to the waitlist, first come first served: each gets a reservation and the payment link. */
  async promoteWaitlist(now = new Date()) {
    const events = await this.db.eventTicket.groupBy({ by: ['eventId'], where: { status: 'waitlist' } });
    let n = 0;
    for (const { eventId } of events) {
      const secrets = new Map<number, string>();
      const promoted = await this.db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "booking"."events" WHERE "id" = ${eventId} FOR UPDATE`;
        const e = await tx.event.findUnique({ where: { id: eventId } });
        if (!e || e.endsAt <= now || e.kind !== 'paid') return [];
        const free = e.capacity === null ? Infinity : e.capacity - (await taken(tx, eventId));
        if (free <= 0) return [];
        const next = await tx.eventTicket.findMany({ where: { eventId, status: 'waitlist' }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: Number.isFinite(free) ? free : 200 });
        const price = e.price === null ? 0 : Number(e.price);
        const out = [];
        for (const w of next) {
          const secret = randomBytes(24).toString('hex');
          // Their promo code, if it still has a use left (else the full price).
          let promo: Awaited<ReturnType<typeof takePromo>>['promo'] = null;
          if (w.promoCode) {
            try {
              const r = await takePromo(tx, eventId, w.promoCode, 1);
              promo = r.granted ? r.promo : null;
            } catch {
              promo = null;
            }
          }
          const discount = promo ? discountFor(promo, price) : null;
          const t = await tx.eventTicket.update({
            where: { id: w.id },
            data: { status: 'reserved', reuploadBy: new Date(now.getTime() + RESERVE_MS), uploadTokenHash: sha256(secret), ...(promo ? { promoCodeId: promo.id, promoCode: promo.code, discount } : { promoCodeId: null, promoCode: null, discount: null }) },
          });
          secrets.set(t.id, secret);
          out.push(t);
        }
        return out.map((t) => ({ t, e }));
      });
      for (const { t, e } of promoted) {
        const price = e.price === null ? 0 : Number(e.price);
        const amountLabel = e.currency ? formatMoney(Math.max(0, price - (t.discount === null ? 0 : Number(t.discount))), e.currency) : null;
        await this.mails.reserved(e, t, secrets.get(t.id)!, { places: 1, amountLabel, fromWaitlist: true });
        await logTicket(this.db, t, 'reserved', SYSTEM, 'From the waitlist: a spot was freed · reserved for 2 hours, payment link emailed');
        this.live.emit({ eventId, type: 'reserved', name: t.name });
        n++;
      }
    }
    return n;
  }

  /** Requests for a proof whose 10 hours are up: place freed (revoked), proofs kept as expired, attendee told. */
  async run(now = new Date()) {
    const result = { expired: 0, reservationsExpired: 0, offered: 0, swept: 0 };
    try {
      result.reservationsExpired = await this.expireReservations(now);
      const due = await this.db.eventTicket.findMany({ where: { status: 'rejected', reuploadBy: { lte: now } }, include: { event: true }, take: 200 });
      const told = new Set<string>();
      for (const t of due) {
        // The place is freed (revoked); the registration and its proofs stay in the history.
        const { count } = await this.db.eventTicket.updateMany({ where: { id: t.id, status: 'rejected' }, data: { status: 'revoked', revokedAt: now, revokeReason: 'No proof of payment in time', reuploadBy: null, uploadTokenHash: null } });
        if (!count) continue;
        await this.db.eventPaymentProof.updateMany({ where: { ticketId: t.id, outcome: null }, data: { outcome: 'expired', outcomeAt: now } });
        await logTicket(this.db, t, 'expired', SYSTEM, 'No proof within 10 hours: spot released');
        // One email per booking (a bulk booking's places expire together).
        if (t.event.endsAt > now && (!t.groupId || !told.has(t.groupId))) await this.mails.paymentExpired(t.event, t);
        if (t.groupId) told.add(t.groupId);
        this.live.emit({ eventId: t.eventId, type: 'payment_expired', name: t.name });
        result.expired++;
      }
      // Any freed place (an expiry, a removal, more capacity): the waitlist, in order.
      result.offered = await this.promoteWaitlist(now);
      // Hourly: files no row points to (an event or business deleted by a cascade).
      if (now.getTime() - this.lastSweep >= 3_600_000) {
        this.lastSweep = now.getTime();
        const [proofs, qrs] = await Promise.all([
          this.db.eventPaymentProof.findMany({ select: { file: true } }),
          this.db.eventPaymentChannel.findMany({ where: { qrFile: { not: null } }, select: { qrFile: true } }),
        ]);
        result.swept += await this.files.sweep('event-proofs', new Set(proofs.map((p) => p.file)), 3_600_000, now.getTime());
        result.swept += await this.files.sweep('event-payment-qr', new Set(qrs.map((q) => q.qrFile!)), 3_600_000, now.getTime());
        const refundQrs = await this.db.eventRefundRequest.findMany({ where: { qrFile: { not: null } }, select: { qrFile: true } });
        const refundProofs = await this.db.eventRefund.findMany({ where: { proofFile: { not: null } }, select: { proofFile: true } });
        result.swept += await this.files.sweep('event-refund-proofs', new Set(refundProofs.map((r) => r.proofFile!)), 3_600_000, now.getTime());
        const media = await this.db.event.findMany({ where: { OR: [{ coverFile: { not: null } }, { logoFile: { not: null } }] }, select: { coverFile: true, logoFile: true } });
        result.swept += await this.files.sweep('event-media', new Set(media.flatMap((m) => [m.coverFile, m.logoFile]).filter((f): f is string => !!f)), 3_600_000, now.getTime());
        result.swept += await this.files.sweep('event-refund-details', new Set(refundQrs.map((q) => q.qrFile!)), 3_600_000, now.getTime());
        // Chat attachments whose event room went with its event.
        const chatFiles = await this.db.chatMessage.findMany({ where: { file: { not: null } }, select: { file: true } });
        result.swept += await this.files.sweep('chat-files', new Set(chatFiles.map((m) => m.file!)), 3_600_000, now.getTime());
      }
      if (result.expired || result.reservationsExpired || result.offered || result.swept) logger.info(result, 'Payment review job');
    } catch (err) {
      logger.error({ reason: err instanceof Error ? err.message : String(err) }, 'Payment review job failed');
    }
    return result;
  }
}
