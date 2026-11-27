// Refund requests (paid events). The business asks an attendee where to send their refund:
//
//   1. "Send a refund request" on a registration: full (what hasn't been refunded yet, optionally
//      cancelling the registration when done) or partial (an amount), with a note. The attendee
//      gets an email with a unique link (a new one if it's sent again).
//   2. On that link they upload their e-wallet / bank QR code, or enter bank details (bank name,
//      account name, account number). The owners and admins are emailed; the event page gets a
//      live toast.
//   3. The business sends the money itself, then marks the request completed: the proof of refund
//      is required; it's emailed to the attendee and the refund is recorded (Collections).
//   The attendee's QR image is kept (UPLOADS_DIR/event-refund-details/) until the event is deleted.
//
//   POST /api/client/bookings/events/:id/tickets/:tid/refund-request   { type, amount, note, cancel }
//   GET  /api/client/bookings/events/:id/refund-requests
//   GET  /api/client/bookings/events/:id/refund-requests/:rid/qr       the attendee's QR image
//   POST /api/client/bookings/events/:id/refund-requests/:rid/resend   a new link, emailed again
//   POST /api/client/bookings/events/:id/refund-requests/:rid/complete multipart { file (required), note }
//   POST /api/client/bookings/events/:id/refund-requests/:rid/cancel
//   GET  /api/public/bookings/:slug/events/:event/refund-request       (X-Refund-Token) what it's for
//   POST /api/public/bookings/:slug/events/:event/refund-request       multipart { token, method, bankName, accountName, accountNumber, file }
import { createHash, randomBytes } from 'node:crypto';
import { Body, Controller, Get, Header, HttpCode, Inject, Param, ParseIntPipe, Post, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import * as yup from 'yup';
import { MAILER } from '../../auth/auth.module';
import type { Mailer, MailAttachment } from '../../auth/mailer';
import { ApiError } from '../../common/api-error';
import { StrictRateLimit } from '../../common/rate-limit';
import { YupValidationPipe } from '../../common/yup-validation.pipe';
import { APP_CONFIG, type AppConfig } from '../../config/config';
import { logger } from '../../logging/logger';
import { eventRefundRequestMail, refundDetailsReceivedMail } from '../client-emails';
import { ClientsDb } from '../clients-db';
import { ClientRoute, type ClientContext } from '../client-context';
import { formatCheckInCode } from './check-in';
import { EventRefunds, refundableOf } from './event-payments';
import { ATTENDEE, bookingSpots, EventLive, EventMails, logTicket, optionalText, publicEvent, sameSecret, scopeField } from './events';
import { formatMoney } from './money';
import { MAX_UPLOAD_BYTES, PaymentFiles, sniff, UPLOAD_OPTIONS, type UploadedFileLike } from './payment-files';
import { EVENT_ROUTES } from '../roles';

const ctx = (req: Request) => req.client as ClientContext;
const who = (c: ClientContext) => c.user.name || c.user.email;
const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');
const money = () =>
  yup
    .number()
    .typeError('Please enter the amount as a number.')
    .min(0.01, 'Please enter the amount.')
    .max(10_000_000)
    .nullable()
    .transform((v, raw) => (raw === '' || raw === null ? null : v));

const requestSchema = yup.object({
  type: yup.string().oneOf(['full', 'partial'], 'Choose full or partial.').required('Choose full or partial.'),
  amount: money().when('type', { is: 'partial', then: (s) => s.required('How much will you refund?') }),
  note: optionalText(500),
  cancel: yup.boolean().default(false),
  /** A bulk booking: the whole booking (default) or only this spot. */
  scope: scopeField(),
});
const detailsSchema = yup.object({
  token: yup.string().trim().max(100).required('This link isn’t valid.'),
  method: yup.string().oneOf(['qr', 'bank'], 'Choose QR code or bank details.').required('Choose QR code or bank details.'),
  bankName: optionalText(100).when('method', { is: 'bank', then: (s) => s.required('Please enter the bank name.') }),
  accountName: optionalText(120).when('method', { is: 'bank', then: (s) => s.required('Please enter the account name.') }),
  accountNumber: optionalText(60).when('method', { is: 'bank', then: (s) => s.required('Please enter the account number.') }),
});
const completeSchema = yup.object({ note: optionalText(500) });

const OPEN = ['waiting', 'submitted'];
const ACTIVE = ['confirmed', 'review', 'rejected'];
type EventRowT = NonNullable<Awaited<ReturnType<ClientsDb['event']['findFirst']>>>;
type TicketRowT = NonNullable<Awaited<ReturnType<ClientsDb['eventTicket']['findFirst']>>>;

/** The spots a request covers: the whole bulk booking (still active), or its one ticket. */
async function spotsOf(db: ClientsDb, r: { wholeBooking: boolean; ticket: TicketRowT }) {
  if (!r.wholeBooking || !r.ticket.groupId) return [r.ticket];
  const spots = await bookingSpots(db, r.ticket, ACTIVE);
  return spots.length ? spots : [r.ticket];
}

/** What's left to refund over these spots (in the paid currency). */
async function leftOver(db: ClientsDb, e: EventRowT, spots: TicketRowT[]) {
  const lefts = await Promise.all(spots.map((t) => refundableOf(db, e, t)));
  return { currency: lefts[0].currency, remaining: Math.round(lefts.reduce((a, l) => a + l.remaining, 0) * 100) / 100 };
}

/** Full: what's left to refund now; partial: the amount. */
async function requestAmount(db: ClientsDb, e: EventRowT, r: { type: string; amountValue: unknown; currency: string | null; wholeBooking: boolean; ticket: TicketRowT }) {
  if (r.type === 'partial') return r.amountValue !== null && r.amountValue !== undefined ? formatMoney(Number(r.amountValue), r.currency ?? e.currency ?? 'PHP') : null;
  const left = await leftOver(db, e, await spotsOf(db, r));
  return left.remaining ? formatMoney(left.remaining, left.currency) : null;
}

@Controller('client/bookings/events/:id')
export class EventRefundRequestsController {
  constructor(
    private readonly db: ClientsDb,
    private readonly files: PaymentFiles,
    private readonly mails: EventMails,
    private readonly refunds: EventRefunds,
    @Inject(MAILER) private readonly mailer: Mailer,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  private async event(orgId: string, id: number) {
    const e = await this.db.event.findFirst({ where: { id, organizationId: orgId } });
    if (!e) throw new ApiError(404, { error: 'not_found', message: 'That event does not exist.' });
    if (e.kind !== 'paid') throw new ApiError(409, { error: 'free_event', message: 'Refund requests are for paid events.' });
    return e;
  }

  private async request(eventId: number, rid: number) {
    const r = await this.db.eventRefundRequest.findFirst({ where: { id: rid, ticket: { eventId } }, include: { ticket: true } });
    if (!r) throw new ApiError(404, { error: 'not_found', message: 'That refund request does not exist.' });
    return r;
  }

  /** A new secret for the request's link, emailed to the attendee. */
  private async sendLink(e: NonNullable<Awaited<ReturnType<ClientsDb['event']['findFirst']>>>, r: NonNullable<Awaited<ReturnType<EventRefundRequestsController['request']>>>) {
    const secret = randomBytes(24).toString('hex');
    await this.db.eventRefundRequest.update({ where: { id: r.id }, data: { tokenHash: sha256(secret) } });
    const v = await this.mails.view(e, r.ticket);
    if (!v) return;
    const amount = await requestAmount(this.db, e, r);
    const spots = (await spotsOf(this.db, r)).length;
    this.mailer.sendInBackground(eventRefundRequestMail(this.cfg, v, { amount, full: r.type === 'full', note: r.note, url: `${v.pageUrl}#refund=${r.id}.${secret}`, spots }));
  }

  @Post('tickets/:tid/refund-request')
  @ClientRoute(EVENT_ROUTES.payments)
  async create(@Req() req: Request, @Param('id', ParseIntPipe) id: number, @Param('tid', ParseIntPipe) tid: number, @Body(new YupValidationPipe(requestSchema)) body: yup.InferType<typeof requestSchema>) {
    const c = ctx(req);
    const e = await this.event(c.org.id, id);
    const t = await this.db.eventTicket.findFirst({ where: { id: tid, eventId: id, organizationId: c.org.id } });
    if (!t) throw new ApiError(404, { error: 'not_found', message: 'That registration does not exist.' });
    if (!ACTIVE.includes(t.status)) throw new ApiError(409, { error: 'not_refundable', message: 'This registration isn’t active.' });
    // A bulk booking: one request for the whole booking (unless only this spot).
    const wholeBooking = !!t.groupId && body.scope !== 'spot';
    const spots = wholeBooking ? await bookingSpots(this.db, t, ACTIVE) : [t];
    if (await this.db.eventRefundRequest.count({ where: { ticketId: { in: spots.map((x) => x.id) }, status: { in: OPEN } } })) throw new ApiError(409, { error: 'already_requested', message: 'There’s already an open refund request for this registration (see the Refund requests tab).' });
    if (wholeBooking && t.groupId && (await this.db.eventRefundRequest.count({ where: { wholeBooking: true, status: { in: OPEN }, ticket: { groupId: t.groupId } } }))) throw new ApiError(409, { error: 'already_requested', message: 'There’s already an open refund request for this booking (see the Refund requests tab).' });
    const left = await leftOver(this.db, e, spots);
    if (body.type === 'full' && !left.remaining) throw new ApiError(409, { error: 'nothing_to_refund', message: 'Everything they paid has already been refunded.' });
    if (body.type === 'partial' && body.amount! > left.remaining) throw new ApiError(400, { error: 'validation_failed', message: `At most ${formatMoney(left.remaining, left.currency)} is left to refund.`, fields: { amount: `At most ${formatMoney(left.remaining, left.currency)}.` } });
    const r = await this.db.eventRefundRequest.create({
      data: { ticketId: tid, organizationId: c.org.id, type: body.type, amountValue: body.type === 'partial' ? body.amount! : null, currency: left.currency, cancel: body.type === 'full' && body.cancel === true, note: body.note ?? null, wholeBooking: wholeBooking && spots.length > 1, createdBy: who(c) },
      include: { ticket: true },
    });
    await this.sendLink(e, r);
    const detail = [body.type === 'partial' ? `Partial: ${formatMoney(body.amount!, left.currency)}` : `Full: ${formatMoney(left.remaining, left.currency)}`, spots.length > 1 ? `Bulk booking: all ${spots.length} spots` : null, r.cancel ? 'Cancels the registration when completed' : null, 'Link emailed for their refund details'].filter(Boolean).join(' · ');
    for (const x of spots) await logTicket(this.db, x, 'refund_requested', who(c), detail);
    logger.info({ org: c.org.id, eventId: id, ticketId: tid, requestId: r.id }, 'Event refund requested');
    return this.row(e, r);
  }

  private async row(e: NonNullable<Awaited<ReturnType<ClientsDb['event']['findFirst']>>>, r: NonNullable<Awaited<ReturnType<EventRefundRequestsController['request']>>>) {
    return {
      id: r.id,
      ticketId: r.ticketId,
      name: r.ticket.name,
      email: r.ticket.email,
      code: r.ticket.code ? formatCheckInCode(r.ticket.code) : null,
      spots: r.status === 'completed' || r.status === 'cancelled' ? (r.wholeBooking ? r.ticket.groupSize ?? 1 : 1) : (await spotsOf(this.db, r)).length,
      type: r.type,
      amount: r.status === 'completed' ? null : await requestAmount(this.db, e, r),
      cancel: r.cancel,
      note: r.note,
      status: r.status,
      method: r.method,
      bankName: r.bankName,
      accountName: r.accountName,
      accountNumber: r.accountNumber,
      hasQr: !!r.qrFile,
      submittedAt: r.submittedAt,
      completedAt: r.completedAt,
      completedBy: r.completedBy,
      createdBy: r.createdBy,
      createdAt: r.createdAt,
    };
  }

  @Get('refund-requests')
  @ClientRoute(EVENT_ROUTES.payments)
  async list(@Req() req: Request, @Param('id', ParseIntPipe) id: number) {
    const e = await this.event(ctx(req).org.id, id);
    const rows = await this.db.eventRefundRequest.findMany({ where: { ticket: { eventId: id } }, orderBy: { createdAt: 'desc' }, include: { ticket: true } });
    return { requests: await Promise.all(rows.map((r) => this.row(e, r))) };
  }

  @Get('refund-requests/:rid/qr')
  @ClientRoute(EVENT_ROUTES.payments)
  async qr(@Req() req: Request, @Param('id', ParseIntPipe) id: number, @Param('rid', ParseIntPipe) rid: number, @Res() res: Response) {
    await this.event(ctx(req).org.id, id);
    const r = await this.request(id, rid);
    const body = await this.files.read('event-refund-details', r.qrFile);
    if (!body || !r.qrType) throw new ApiError(404, { error: 'not_found', message: 'There’s no QR code for this request.' });
    res.status(200).set({ 'Content-Type': r.qrType, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' }).send(body);
  }

  @Post('refund-requests/:rid/resend')
  @HttpCode(200)
  @ClientRoute(EVENT_ROUTES.payments)
  async resend(@Req() req: Request, @Param('id', ParseIntPipe) id: number, @Param('rid', ParseIntPipe) rid: number) {
    const e = await this.event(ctx(req).org.id, id);
    const r = await this.request(id, rid);
    if (r.status !== 'waiting') throw new ApiError(409, { error: 'not_waiting', message: r.status === 'submitted' ? 'They already sent their details.' : 'This request is closed.' });
    await this.sendLink(e, r);
    return { ok: true };
  }

  /** Completed: the proof of refund is required; it's emailed to the attendee and the refund recorded. */
  @Post('refund-requests/:rid/complete')
  @HttpCode(200)
  @ClientRoute(EVENT_ROUTES.payments)
  @UseInterceptors(FileInterceptor('file', UPLOAD_OPTIONS))
  async complete(@Req() req: Request, @Param('id', ParseIntPipe) id: number, @Param('rid', ParseIntPipe) rid: number, @Body(new YupValidationPipe(completeSchema)) body: yup.InferType<typeof completeSchema>, @UploadedFile() file?: UploadedFileLike) {
    const c = ctx(req);
    const e = await this.event(c.org.id, id);
    const r = await this.request(id, rid);
    if (!OPEN.includes(r.status)) throw new ApiError(409, { error: 'closed', message: 'This request is already closed.' });
    if (!file) throw new ApiError(400, { error: 'file_missing', message: 'Please attach the proof of refund.', fields: { file: 'Required.' } });
    const kind = sniff(file.buffer, true);
    if (!kind || file.size > MAX_UPLOAD_BYTES) throw new ApiError(400, { error: 'file_type', message: 'Please attach an image (JPG, PNG or WebP) or a PDF, up to 10 MB.', fields: { file: 'Wrong file.' } });
    const attachment: MailAttachment = { filename: `proof-of-refund.${kind.ext}`, content: file.buffer, contentType: kind.type };
    // Only one completion at a time.
    const { count } = await this.db.eventRefundRequest.updateMany({ where: { id: rid, status: { in: OPEN } }, data: { status: 'completed', completedAt: new Date(), completedBy: who(c), tokenHash: null } });
    if (!count) throw new ApiError(409, { error: 'closed', message: 'This request is already closed.' });
    try {
      const { refund } = await this.refunds.record(
        c.org.id,
        e,
        await spotsOf(this.db, r),
        { type: r.type as 'full' | 'partial', amount: r.amountValue === null ? null : Number(r.amountValue), currency: r.currency, note: body.note ?? r.note, cancel: r.cancel, attachment, proofName: file.originalname },
        who(c),
      );
      await this.db.eventRefundRequest.update({ where: { id: rid }, data: { refundId: refund.id } });
    } catch (err) {
      await this.db.eventRefundRequest.update({ where: { id: rid }, data: { status: r.status, completedAt: null, completedBy: null } });
      throw err;
    }
    logger.info({ org: c.org.id, eventId: id, requestId: rid }, 'Event refund request completed');
    return this.row(e, await this.request(id, rid));
  }

  @Post('refund-requests/:rid/cancel')
  @HttpCode(200)
  @ClientRoute(EVENT_ROUTES.payments)
  async cancel(@Req() req: Request, @Param('id', ParseIntPipe) id: number, @Param('rid', ParseIntPipe) rid: number) {
    const c = ctx(req);
    const e = await this.event(c.org.id, id);
    const { count } = await this.db.eventRefundRequest.updateMany({ where: { id: rid, ticket: { eventId: id }, status: { in: OPEN } }, data: { status: 'cancelled', tokenHash: null } });
    if (!count) throw new ApiError(409, { error: 'closed', message: 'This request is already closed.' });
    const r = await this.request(id, rid);
    await logTicket(this.db, r.ticket, 'refund_request_cancelled', who(c));
    return this.row(e, r);
  }
}

/** "{request id}.{secret}" from the emailed link. */
async function requestByToken(db: ClientsDb, eventId: number, raw: unknown) {
  const m = typeof raw === 'string' ? /^(\d+)\.([0-9a-f]{48})$/.exec(raw) : null;
  const r = m ? await db.eventRefundRequest.findFirst({ where: { id: Number(m[1]), ticket: { eventId } }, include: { ticket: true } }) : null;
  if (!r || !r.tokenHash || !sameSecret(r.tokenHash, sha256(m![2]))) throw new ApiError(404, { error: 'bad_link', message: 'This link isn’t valid any more. Please use the link in your latest email.' });
  return r;
}

@Controller('public/bookings/:slug/events')
export class PublicRefundRequestsController {
  constructor(
    private readonly db: ClientsDb,
    private readonly files: PaymentFiles,
    private readonly live: EventLive,
    @Inject(MAILER) private readonly mailer: Mailer,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  @Get(':event/refund-request')
  @Header('Cache-Control', 'no-store')
  async get(@Req() req: Request, @Param('slug') slug: string, @Param('event') eventSlug: string) {
    const { e } = await publicEvent(this.db, slug, eventSlug);
    const r = await requestByToken(this.db, e.id, req.headers['x-refund-token']);
    const amount = await requestAmount(this.db, e, r);
    return { name: r.ticket.name, status: r.status, type: r.type, amount, note: r.note, method: r.method, spots: (await spotsOf(this.db, r)).length };
  }

  @Post(':event/refund-request')
  @HttpCode(200)
  @StrictRateLimit()
  @UseInterceptors(FileInterceptor('file', UPLOAD_OPTIONS))
  async submit(@Param('slug') slug: string, @Param('event') eventSlug: string, @Body(new YupValidationPipe(detailsSchema)) body: yup.InferType<typeof detailsSchema>, @UploadedFile() file?: UploadedFileLike) {
    const { e, s } = await publicEvent(this.db, slug, eventSlug);
    const r = await requestByToken(this.db, e.id, body.token);
    if (r.status !== 'waiting' && r.status !== 'submitted') throw new ApiError(409, { error: 'closed', message: 'This refund request is closed.' });
    const qr = body.method === 'qr' ? await this.files.save('event-refund-details', file, { allowPdf: false, field: 'file' }) : null;
    await this.db.eventRefundRequest.update({
      where: { id: r.id },
      data: {
        status: 'submitted',
        submittedAt: new Date(),
        method: body.method,
        bankName: body.method === 'bank' ? (body.bankName ?? null) : null,
        accountName: body.accountName ?? null,
        accountNumber: body.accountNumber ?? null,
        qrFile: qr?.file ?? null,
        qrType: qr?.type ?? null,
      },
    });
    // A new QR replaces the old one.
    if (r.qrFile && r.qrFile !== qr?.file) await this.files.remove('event-refund-details', r.qrFile);
    await logTicket(this.db, r.ticket, 'refund_details_received', ATTENDEE, body.method === 'qr' ? 'QR code uploaded' : `Bank: ${body.bankName}, ${body.accountName}`);
    this.live.emit({ eventId: e.id, type: 'refund_details', name: r.ticket.name });
    const members = await this.db.member.findMany({ where: { organizationId: e.organizationId, role: { in: ['owner', 'admin'] } }, include: { user: { select: { email: true } } } });
    const amount = await requestAmount(this.db, e, r);
    for (const to of new Set(members.map((m) => m.user.email))) {
      this.mailer.sendInBackground(refundDetailsReceivedMail(this.cfg, { to, businessName: s.businessName, eventTitle: e.title, attendeeName: r.ticket.name, amount, method: body.method, eventUrl: `${this.cfg.clients.bookingsUrl}/app/events/${e.id}` }));
    }
    return { ok: true, status: 'submitted' };
  }
}
