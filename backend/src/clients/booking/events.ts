// Events: one-time seminars, webinars and classes, on a public page (/{business}/e/{event}).
//
//   free  anyone registers on the page: confirmed straight away, QR code on screen and by email
//   paid  no payment gateway yet. The attendee pays through one of the event's payment channels
//         (up to 4: a QR code or bank details, shown on the form), then registers with their
//         details and a proof of payment (image or PDF, event-payments.ts). The business's owners
//         and admins are emailed to verify it; approved -> confirmed, QR code by email; rejected
//         -> the attendee has 10 hours to upload a new one, or the place is released.
//         The business can also take the payment itself and give an 8-character code instead.
//
// No rescheduling. Free events: attendees can cancel their own registration any time before the
// event ends, with the private link in their email; paid events can't be cancelled. The business
// can revoke free registrations (the attendee is emailed) and delete unused paid codes. Online events may get their link later:
// adding or changing it emails every confirmed attendee.
// Check-in is per event: the event's scanner only accepts that event's codes.
// Publishing: a paid event can only be published with at least one payment channel (it's made
// unpublished, the channels are added on its Details tab, then it's published). Any event can be
// unpublished (hidden) and published again: its page is then "not available"; registrations stay.
//
// Limits: limit:events.participants (every plan: 50 per event included) and limit:events.per_day
// (free plan: 1 event a day; no row = no limit). Bigger events are bought per event (EVENT_SIZES):
// Byte Bun takes the payment by hand and creates a voucher on the admin site; the client enters it
// when making (or growing) the event, and it sets that event's participantLimit. The client can
// then go up and down within it, not past it (a new payment: a new voucher, or Byte Bun raises it).
//
//   GET    /api/client/bookings/events                       list, with counts
//   POST   /api/client/bookings/events                       create
//   GET    /api/client/bookings/events/:id                   the event and its registrations
//   PATCH  /api/client/bookings/events/:id                   edit (link added/changed -> attendees emailed)
//   GET    /api/client/bookings/events/:id/export.xlsx       Excel: Details, Attendees, Claimables, Scanners tabs
//   GET    /api/client/bookings/events/:id/export.csv        the attendees
//   GET    /api/client/bookings/events/:id/export.json       all of it, structured
//   GET    /api/client/bookings/events/:id/export.zip        all of the above + proofs of payment, a folder per attendee
//   POST   /api/client/bookings/events/:id/delete-code       emails a 6-digit code to the person asking
//   POST   /api/client/bookings/events/:id/delete            { code, notifyAttendees }: the whole event goes
//   POST   /api/client/bookings/events/:id/tickets           paid: issue a code { name, email, phone }
//   POST   /api/client/bookings/events/:id/tickets/manual    Manual Register { name, email, phone, quantity, free, amount }: confirmed now
//                                                            (bulk: quantity places for one person, within the places left)
//   GET    /api/client/bookings/events/:id/collections       paid: payments and refunds, with a running total
//   GET    /api/client/bookings/events/:id/tickets/:tid/log  a registration's activity log
//   DELETE /api/client/bookings/events/:id/tickets/:tid      paid: delete an unused code
//   POST   /api/client/bookings/events/:id/tickets/:tid/revoke   free: { reason }
//   POST   /api/client/bookings/events/vouchers/check        { code } -> { participants }
//   POST   /api/client/bookings/events/:id/upgrade-request   { participants }: emails Byte Bun
//   POST   /api/client/bookings/events/:id/check-in          { code } | { ticketId }, force
//   POST   /api/client/bookings/events/:id/tickets/:tid/check-in/undo
//   GET    /api/public/bookings/:slug/events                 the business's upcoming public events
//   GET    /api/public/bookings/:slug/events/:event          the event page
//   POST   /api/public/bookings/:slug/events/:event/register { firstName, lastName, email, phone }  (free; all required)
//   POST   /api/public/bookings/:slug/events/:event/claim    { code }                (paid)
//   GET    /api/public/bookings/:slug/events/:event/registration  (X-Registration-Token)  the attendee's registration
//   POST   /api/public/bookings/:slug/events/:event/cancel   { token }  free events only: the attendee cancels
import { createHash, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';
import { Body, Controller, Delete, Get, Header, HttpCode, Inject, Injectable, Param, ParseIntPipe, Patch, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Subject } from 'rxjs';
import * as yup from 'yup';
import { ADMINS } from '../../auth/admins';
import { MAILER } from '../../auth/auth.module';
import type { Mailer, MailAttachment } from '../../auth/mailer';
import { ApiError } from '../../common/api-error';
import { xlsx } from '../../common/xlsx';
import { StrictRateLimit } from '../../common/rate-limit';
import { YupValidationPipe } from '../../common/yup-validation.pipe';
import { APP_CONFIG, type AppConfig } from '../../config/config';
import { logger } from '../../logging/logger';
import { calendarFor, cleanInstructions, eventCancelledByBusinessMail, eventCancelledMail, eventCheckedInMail, eventBulkConfirmationMail, eventConfirmationMail, eventDeleteCodeMail, eventLinkMail, eventPaymentExpiredMail, eventPaymentNotApprovedMail, eventPaymentReceivedMail, eventProofRequestMail, eventRefundMail, eventReservedMail, eventRevokedMail, eventWaitlistedMail, paymentToVerifyMail, type EventView } from '../client-emails';
import { ClientsDb, type ClientsTx } from '../clients-db';
import { ClientRoute, orgStatus, type ClientContext } from '../client-context';
import { hasFeature, limitOf, loadEntitlements } from '../entitlements';
import { checkInQrPng, checkInUrl, formatCheckInCode, newCheckInCode, parseCheckInCode } from './check-in';
import { csvCell } from './csv';
import { formatMoney, isCurrency } from './money';
import { eventZip } from './event-zip';
import { qrPdf } from './qr-pdf';
import { discountFor, takePromo } from './event-promos';
import { channelRow, PaymentFiles } from './payment-files';
import { SLUG_RE } from './schemas';
import { addDays, formatInZone, fromLocal, isDate, toLocal, todayIn } from './time';
import { EVENT_ROUTES } from '../roles';

const ctx = (req: Request) => req.client as ClientContext;
type Db = ClientsDb | ClientsTx;

// ---- Validation ----

export const optionalText = (max: number) => yup.string().trim().max(max, `At most ${max} characters.`).nullable().transform((v) => (v === '' ? null : v));
const email = () => yup.string().trim().lowercase().email('Please enter a valid email address.').max(254);
const url = () =>
  optionalText(500).test('url', 'Please enter a full link starting with https://', (v) => {
    if (!v) return true;
    try {
      return ['http:', 'https:'].includes(new URL(v).protocol);
    } catch {
      return false;
    }
  });

export const eventSchema = yup.object({
  title: yup.string().trim().min(3, 'Please enter a title.').max(160).required('Please enter a title.'),
  slug: yup.string().trim().lowercase().matches(SLUG_RE, 'Use 3-60 lowercase letters, numbers and dashes.').required('Please choose the event link.'),
  description: optionalText(20000),
  kind: yup.string().oneOf(['free', 'paid']).required(),
  /** Paid events: the price (required) and its currency (ISO 4217, e.g. PHP). */
  price: yup
    .number()
    .typeError('Please enter the price as a number.')
    .min(0.01, 'Please enter the price.')
    .max(10_000_000, 'That’s too high.')
    .nullable()
    .transform((v, raw) => (raw === '' || raw === null ? null : v)),
  currency: yup
    .string()
    .trim()
    .uppercase()
    .nullable()
    .test('currency', 'Please choose a currency.', (v) => !v || isCurrency(v)),
  date: yup.string().test('date', 'Please choose the date.', (v) => v === undefined || isDate(v)).required('Please choose the date.'),
  startMinute: yup.number().integer().min(0).max(1439).required(),
  endMinute: yup
    .number()
    .integer()
    .min(1)
    .max(1440)
    .required()
    .test('order', 'The end time must be after the start time.', function (v) {
      return v === undefined || this.parent.startMinute === undefined || v > this.parent.startMinute;
    }),
  /** The event's time zone (IANA). Missing on create: the business's. */
  timeZone: yup
    .string()
    .trim()
    .max(64)
    .nullable()
    .test('zone', 'Please choose a time zone.', (v) => !v || isTimeZone(v)),
  format: yup.string().oneOf(['onsite', 'online']).required(),
  address: optionalText(300),
  addressDetails: optionalText(300),
  /** The map pin (onsite): both or neither. */
  latitude: yup.number().min(-90).max(90).nullable(),
  longitude: yup
    .number()
    .min(-180)
    .max(180)
    .nullable()
    .test('pair', 'Please place the pin again.', function (v) {
      return (v === undefined || v === null) === (this.parent.latitude === undefined || this.parent.latitude === null);
    }),
  meetingUrl: url(),
  capacity: yup.number().integer().min(1).max(100000).nullable().transform((v, raw) => (raw === '' || raw === null ? null : v)),
  // No default: an edit that leaves it out must not unpublish the event.
  published: yup.boolean(),
  /** The registration button's text (default: "Register for free" / "Register"). */
  registerLabel: optionalText(40),
  /** A bigger event (more than the plan's participants): the voucher from Byte Bun. */
  voucherCode: yup.string().trim().max(40).nullable(),
  /** Events without a voucher: the business agrees they're deleted 3 months after they end. */
  retentionAgreed: yup.boolean(),
});
const eventPatchSchema = eventSchema.partial();
/** Codes and Manual Register: the name, email and mobile number (all required). */
const attendeeSchema = yup.object({
  name: yup.string().trim().min(2, 'Please enter the name.').max(120).required('Please enter the name.'),
  email: email().required('Please enter the email address.'),
  phone: yup
    .string()
    .trim()
    .max(40, 'At most 40 characters.')
    .required('Please enter the mobile number.')
    .test('phone', 'Please enter a valid mobile number.', (v) => !v || (/^\+?[\d\s().-]+$/.test(v) && v.replace(/\D/g, '').length >= 7)),
});
/** Manual Register: the business registers someone itself (paid to it directly, or free). */
const manualSchema = attendeeSchema.shape({
  /** Bulk: this many places for the same person (each its own code and QR code). */
  quantity: yup.number().typeError('How many spots?').integer('Whole spots only.').min(1, 'At least 1.').max(500, 'At most 500 at once.').default(1),
  /** A promo code: applied place by place until its uses run out (the rest pay the full amount). */
  promoCode: optionalText(40),
  free: yup.boolean().default(false),
  amount: yup
    .number()
    .typeError('Please enter the amount as a number.')
    .min(0, 'Please enter the amount.')
    .max(10_000_000, 'That’s too high.')
    .nullable()
    .transform((v, raw) => (raw === '' || raw === null ? null : v)),
});

/**
 * One line in a registration's activity log (the Activity button on the registrations list).
 * Never fails the action it records.
 */
/**
 * The spots of a bulk booking acted on together (its group, in these statuses, oldest first),
 * or just this one. `t` is always included when it's in one of the statuses.
 */
export async function bookingSpots<T extends { id: number; groupId: string | null; status: string }>(db: Db, t: T, statuses: string[]): Promise<TicketRow[]> {
  if (!t.groupId) return statuses.includes(t.status) ? [t as unknown as TicketRow] : [];
  return db.eventTicket.findMany({ where: { groupId: t.groupId, status: { in: statuses } }, orderBy: { id: 'asc' } });
}

/** "only this spot" or (default) the whole bulk booking. */
export const scopeField = () => yup.string().oneOf(['booking', 'spot']).default('booking');

export async function logTicket(db: Db, t: { id: number; organizationId: string }, action: string, by: string | null, detail?: string | null) {
  await db.eventTicketLog
    .create({ data: { ticketId: t.id, organizationId: t.organizationId, action, by: by ? by.slice(0, 200) : null, detail: detail ? detail.slice(0, 500) : null } })
    .catch((err: unknown) => logger.warn({ ticketId: t.id, action, reason: err instanceof Error ? err.message : String(err) }, 'Activity log entry not saved'));
}
export const ATTENDEE = 'Attendee';
export const SYSTEM = 'System';

/** What a paid event's registration paid, when it's confirmed (the Collections tab). */
export function paidData(e: { kind: string; price: unknown; currency: string | null }, method: 'proof' | 'code' | 'manual' | 'free', amount?: number | null) {
  if (e.kind !== 'paid') return {};
  const value = method === 'free' ? 0 : (amount ?? (e.price === null || e.price === undefined ? null : Number(e.price)));
  return { paymentMethod: method, amountPaid: value, paidCurrency: e.currency, paidAt: new Date() };
}
/** At least 7 digits; spaces, dashes, dots, brackets and a leading + are fine. */
const phone = () =>
  yup
    .string()
    .trim()
    .max(40, 'At most 40 characters.')
    .required('Please enter your mobile number.')
    .test('phone', 'Please enter a valid mobile number.', (v) => !v || (/^\+?[\d\s().-]+$/.test(v) && v.replace(/\D/g, '').length >= 7));
/** The public registration form: first and last name, email and phone (all required). */
export const registerSchema = yup.object({
  firstName: yup.string().trim().min(1, 'Please enter your first name.').max(60).required('Please enter your first name.'),
  lastName: yup.string().trim().min(1, 'Please enter your last name.').max(60).required('Please enter your last name.'),
  email: email().required('Please enter your email address.'),
  phone: phone(),
  /** Bulk booking: this many places under the same name and email (each its own QR code). */
  quantity: yup.number().typeError('How many spots?').integer('Whole spots only.').min(1, 'At least 1.').max(100, 'At most 100 at once.').default(1),
});
const revokeSchema = yup.object({ reason: optionalText(500), scope: yup.string().oneOf(['booking', 'spot']).default('booking') });
const deleteSchema = yup.object({ code: yup.string().trim().matches(/^\d{6}$/, 'Enter the 6-digit code from the email.').required('Enter the 6-digit code from the email.'), notifyAttendees: yup.boolean().default(true) });
const DELETE_CODE_MINUTES = 10;
const DELETE_CODE_TRIES = 5;
const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');
const upgradeSchema = yup.object({ participants: yup.number().integer().min(51, 'More than 50, please.').max(1000000).required('How many participants?'), note: optionalText(1000) });

/** Bigger events, bought per event (no payment gateway yet: Byte Bun invoices it). */
export const EVENT_SIZES = [
  { upTo: 300, price: '$10' },
  { upTo: 500, price: '$20' },
] as const;
export const eventSizePrice = (participants: number) => EVENT_SIZES.find((s) => participants <= s.upTo)?.price ?? 'custom pricing';
const cancelSchema = yup.object({ token: yup.string().trim().max(80).required() });
const claimSchema = yup.object({ code: yup.string().trim().max(40).required('Please enter your code.') });
const checkInSchema = yup.object({ code: yup.string().trim().max(300).nullable(), ticketId: yup.number().integer().positive().nullable(), force: yup.boolean().default(false) });

// ---- Shared ----

/** A code no booking or event registration of this business has. */
export async function freeCode(db: Db, organizationId: string) {
  for (;;) {
    const code = newCheckInCode();
    const [b, t] = await Promise.all([
      db.booking.findFirst({ where: { organizationId, checkInCode: code }, select: { id: true } }),
      db.eventTicket.findFirst({ where: { organizationId, code }, select: { id: true } }),
    ]);
    if (!b && !t) return code;
  }
}

type EventRow = NonNullable<Awaited<ReturnType<ClientsDb['event']['findFirst']>>>;
type TicketRow = NonNullable<Awaited<ReturnType<ClientsDb['eventTicket']['findFirst']>>>;

/** Registrations that hold a place: confirmed, unused paid codes, reserved (paid: the proof not sent yet), and payments being verified (or re-uploaded). */
export const LIVE_STATUSES = ['confirmed', 'pending', 'reserved', 'review', 'rejected'];
/** Paid places held but not verified yet: they may still be freed, so the waitlist is open. */
export const UNVERIFIED_STATUSES = ['reserved', 'review', 'rejected'];
/** People waiting for a place (paid events, one spot each), first come first served. */
export const waiting = (db: Db, eventId: number) => db.eventTicket.count({ where: { eventId, status: 'waitlist' } });
/** Places taken. */
export const taken = (db: Db, eventId: number) => db.eventTicket.count({ where: { eventId, status: { in: LIVE_STATUSES } } });

/** The most participants this event may have: the plan's limit, or more if Byte Bun raised it. Null = no limit. */
const participantCap = (e: { participantLimit: number | null }, planCap: number | null) => (planCap === null ? null : Math.max(planCap, e.participantLimit ?? 0));

/** Events without a voucher are deleted this many months after they end (event-retention.ts). */
export const EVENT_RETENTION_MONTHS = 3;
/** "2026-12-03" + 3 months -> "2027-03-03" (the last day of the month when shorter). */
export function addMonths(date: string, months: number) {
  const [y, m, d] = date.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return `${target.getUTCFullYear()}-${String(target.getUTCMonth() + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}
/** Does automatic deletion apply, and on which day (in the event's time zone)? */
export function retentionOf(e: { participantLimit: number | null; retentionAgreedAt: Date | null; endsAt: Date; timeZone: string | null }, businessTz: string) {
  const applies = e.participantLimit === null && !!e.retentionAgreedAt;
  return { applies, deleteOn: applies ? addMonths(toLocal(e.endsAt, zoneOf(e, businessTz)).date, EVENT_RETENTION_MONTHS) : null };
}

/** 840 -> "2:00 PM" */
const minuteText = (m: number) => {
  const h = Math.floor(m / 60) % 24;
  return `${h % 12 || 12}:${String(m % 60).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};

const isTimeZone = (v: string) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: v });
    return true;
  } catch {
    return false;
  }
};
/** The event's own time zone, or the business's for events made before events had one. */
export const zoneOf = (e: { timeZone: string | null }, businessTz: string) => e.timeZone || businessTz;

export function eventRow(e: EventRow, businessTz: string, counts?: { confirmed: number; pending: number; checkedIn: number; revoked: number; review: number; reserved?: number; waitlist?: number }) {
  const tz = zoneOf(e, businessTz);
  const start = toLocal(e.startsAt, tz);
  const end = toLocal(e.endsAt, tz);
  return {
    id: e.id,
    slug: e.slug,
    title: e.title,
    description: e.description,
    kind: e.kind,
    price: e.price === null ? null : Number(e.price),
    currency: e.currency,
    priceLabel: e.priceLabel,
    startsAt: e.startsAt,
    endsAt: e.endsAt,
    timeZone: tz,
    date: start.date,
    startMinute: start.minute,
    endMinute: end.date === start.date ? end.minute : 1440,
    format: e.format,
    address: e.address,
    addressDetails: e.addressDetails,
    latitude: e.latitude,
    longitude: e.longitude,
    meetingUrl: e.meetingUrl,
    capacity: e.capacity,
    participantLimit: e.participantLimit,
    published: e.published,
    registerLabel: e.registerLabel,
    coverUrl: e.coverFile ? `/api/public/event-files/media/${e.coverFile}` : null,
    logoUrl: e.logoFile ? `/api/public/event-files/media/${e.logoFile}` : null,
    retention: retentionOf(e, businessTz),
    ...(counts ? { counts } : {}),
  };
}

/** The attendee's private cancel link token: "{ticket id}.{nonce}". */
export const registrationToken = (t: { id: number; manageNonce: string }) => `${t.id}.${t.manageNonce}`;
export const sameSecret = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

type ProofRow = { id: number; name: string; type: string; size: number; createdAt: Date; outcome: string | null; outcomeAt: Date | null };
type RefundRow = { id: number; type: string; amount: string | null; amountValue?: unknown; currency?: string | null; proofFile?: string | null; proofType?: string | null; cancelled: boolean; note: string | null; proofName: string | null; createdBy: string; createdAt: Date };

export const ticketRow = (t: TicketRow & { proofs?: ProofRow[]; refunds?: RefundRow[] }) => ({
  id: t.id,
  name: t.name,
  email: t.email,
  phone: t.phone,
  // None yet while a payment isn't confirmed.
  code: t.code ? formatCheckInCode(t.code) : null,
  status: t.status,
  source: t.source,
  confirmedAt: t.confirmedAt,
  revokedAt: t.revokedAt,
  revokeReason: t.revokeReason,
  cancelledAt: t.cancelledAt,
  checkedInAt: t.checkedInAt,
  createdAt: t.createdAt,
  // Paid events: the proof of payment (the file itself: GET …/tickets/:tid/proof).
  // Paid events: the proofs of payment (each file: GET …/tickets/:tid/proofs/:pid) and refunds.
  // The proofs being verified now (no outcome yet).
  proofs: (t.proofs ?? []).filter((p) => !p.outcome).map((p) => ({ id: p.id, name: p.name, type: p.type, size: p.size, uploadedAt: p.createdAt })),
  // Every file ever uploaded for it, all kept until the event is deleted, with what became of it.
  uploads: (t.proofs ?? []).map((p) => ({ id: p.id, name: p.name, type: p.type, size: p.size, uploadedAt: p.createdAt, outcome: p.outcome, outcomeAt: p.outcomeAt })),
  refunds: (t.refunds ?? []).map((r) => ({ id: r.id, type: r.type, amount: r.amount, amountValue: r.amountValue == null ? null : Number(r.amountValue), currency: r.currency ?? null, hasProof: !!r.proofFile, proofType: r.proofType ?? null, cancelled: r.cancelled, note: r.note, proofName: r.proofName, by: r.createdBy, at: r.createdAt })),
  // What they paid (paid events, once confirmed).
  paymentMethod: t.paymentMethod,
  amountPaid: t.amountPaid === null ? null : Number(t.amountPaid),
  paidCurrency: t.paidCurrency,
  promoCode: t.promoCode,
  discount: t.discount === null ? null : Number(t.discount),
  // Bulk bookings: the places booked together.
  groupId: t.groupId,
  groupSize: t.groupSize,
  proofRequest: t.proofRequest,
  amountDue: t.amountDue,
  paymentNote: t.paymentNote,
  reuploadBy: t.reuploadBy,
  paymentReviewedAt: t.paymentReviewedAt,
  paymentReviewedBy: t.paymentReviewedBy,
});

const isLive = (status: string) => LIVE_STATUSES.includes(status);
const isUniqueClash = (err: unknown) => (err as { code?: string })?.code === 'P2002';
/** Paid events need a way to pay before their page goes live. */
export const noChannels = () =>
  new ApiError(409, { error: 'no_payment_channels', message: 'Add at least one payment channel (a QR code or bank details) before publishing this paid event.', fields: { published: 'Add a payment channel first.' } });
const alreadyRegistered = () => new ApiError(409, { error: 'already_registered', message: 'This email address is already registered for this event.', fields: { email: 'Already registered.' } });

/** The event's emails: the business's branding, the time, the place or link, the QR code. */
@Injectable()
export class EventMails {
  constructor(
    private readonly db: ClientsDb,
    @Inject(MAILER) private readonly mailer: Mailer,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  cfgFor() {
    return this.cfg;
  }

  async view(e: EventRow, t: TicketRow): Promise<EventView | null> {
    const s = await this.db.bookingSettings.findUnique({ where: { organizationId: e.organizationId } });
    if (!s) return null;
    const ents = await loadEntitlements(this.db, e.organizationId);
    const f = formatInZone(e.startsAt, zoneOf(e, s.timeZone));
    const endTime = formatInZone(e.endsAt, zoneOf(e, s.timeZone)).time;
    const pageUrl = `${this.cfg.clients.bookingsUrl}/${s.slug}/e/${e.slug}`;
    const where = e.format === 'online' ? e.meetingUrl || 'Online (link to follow)' : e.address || s.businessName;
    const calendar = calendarFor({
      uid: `client-event-${e.id}-${t.id}@bytebuntech.com`,
      sequence: 0,
      title: `${e.title} · ${s.businessName}`,
      description: [`${e.title} with ${s.businessName}.`, ...(e.format === 'online' && e.meetingUrl ? [`Join: ${e.meetingUrl}`] : []), `Event page: ${pageUrl}`].join('\n'),
      location: where,
      start: e.startsAt,
      end: e.endsAt,
      allDay: null,
    });
    return {
      brand: { businessName: s.businessName, primaryColor: s.primaryColor, poweredBy: !hasFeature(ents, 'bookings.full_branding'), replyTo: s.contactEmail, phone: s.phone },
      attendeeName: t.name,
      attendeeEmail: t.email,
      title: e.title,
      when: `${f.date}, ${f.time} – ${endTime} (${f.zone})`,
      dateLabel: f.date,
      format: e.format as 'onsite' | 'online',
      address: e.addressDetails ? `${e.address ?? ''}${e.address ? ' · ' : ''}${e.addressDetails}` : e.address,
      pin: e.latitude !== null && e.longitude !== null ? { lat: e.latitude, lng: e.longitude } : null,
      meetingUrl: e.meetingUrl,
      pageUrl,
      calendar,
      // Online events: no QR code or scanning, attendees just join with the link.
      checkIn: e.format === 'online' || !t.code ? null : { code: formatCheckInCode(t.code), qrPng: await checkInQrPng(checkInUrl(this.cfg.clients.bookingsUrl, t.code!)) },
      cancelUrl: e.kind === 'free' ? `${pageUrl}#cancel=${registrationToken(t)}` : null,
      ticketUrl: e.format === 'online' ? null : `${pageUrl}#ticket=${registrationToken(t)}`,
    };
  }

  async confirmation(e: EventRow, t: TicketRow) {
    const v = await this.view(e, t);
    if (v) this.mailer.sendInBackground(eventConfirmationMail(this.cfg, v));
  }

  /** Several places for one person: one email, every code and QR code. */
  async bulkConfirmation(e: EventRow, tickets: TicketRow[]) {
    if (tickets.length === 1) return this.confirmation(e, tickets[0]);
    const v = await this.view(e, tickets[0]);
    if (!v) return;
    const list = await Promise.all(
      tickets.map(async (t) => ({
        code: formatCheckInCode(t.code),
        qrPng: e.format === 'online' ? null : await checkInQrPng(checkInUrl(this.cfg.clients.bookingsUrl, t.code!)),
        ticketUrl: e.format === 'online' ? null : `${v.pageUrl}#ticket=${registrationToken(t)}`,
      })),
    );
    // Onsite: every QR code in one PDF too, to print or keep.
    const pdf = e.format === 'online' ? null : await qrPdf(this.cfg.clients.bookingsUrl, tickets.map((t, i) => ({ code: formatCheckInCode(t.code), raw: t.code!, label: `Spot ${i + 1} · ${t.name}` })), { title: e.title, sub: v.when });
    this.mailer.sendInBackground(eventBulkConfirmationMail(this.cfg, v, list, pdf));
  }

  async checkedIn(e: EventRow, t: TicketRow) {
    const v = await this.view(e, t);
    if (!v || !t.checkedInAt) return;
    const s = await this.db.bookingSettings.findUnique({ where: { organizationId: e.organizationId }, select: { timeZone: true } });
    this.mailer.sendInBackground(eventCheckedInMail(this.cfg, v, formatInZone(t.checkedInAt, zoneOf(e, s?.timeZone ?? 'UTC')).time));
  }

  /** The event was deleted: everyone registered hears it's cancelled. */
  async eventCancelled(e: EventRow, tickets: TicketRow[]) {
    for (const t of tickets) {
      const v = await this.view(e, t);
      if (v) this.mailer.sendInBackground(eventCancelledByBusinessMail(this.cfg, v));
    }
  }

  async cancelled(e: EventRow, t: TicketRow, spots = 1) {
    const v = await this.view(e, t);
    if (v) this.mailer.sendInBackground(eventCancelledMail(this.cfg, v, spots));
  }

  async revoked(e: EventRow, t: TicketRow, reason: string | null, spots = 1) {
    const v = await this.view(e, t);
    if (v) this.mailer.sendInBackground(eventRevokedMail(this.cfg, v, reason, spots));
  }

  async paymentReceived(e: EventRow, t: TicketRow) {
    const v = await this.view(e, t);
    if (v) this.mailer.sendInBackground(eventPaymentReceivedMail(this.cfg, v));
  }

  /** Another or an additional proof is asked for: the request's own upload link, until t.reuploadBy. */
  async proofRequested(e: EventRow, t: TicketRow, uploadToken: string) {
    const v = await this.view(e, t);
    if (!v || !t.reuploadBy) return;
    const s = await this.db.bookingSettings.findUnique({ where: { organizationId: e.organizationId }, select: { timeZone: true } });
    const f = formatInZone(t.reuploadBy, zoneOf(e, s?.timeZone ?? 'UTC'));
    this.mailer.sendInBackground(
      eventProofRequestMail(this.cfg, v, { kind: t.proofRequest === 'additional' ? 'additional' : 'replace', note: t.paymentNote, amountDue: t.amountDue, deadline: `${f.date}, ${f.time} (${f.zone})`, uploadUrl: `${v.pageUrl}#upload=${t.id}.${uploadToken}` }),
    );
  }

  async paymentNotApproved(e: EventRow, t: TicketRow, reason: string | null) {
    const v = await this.view(e, t);
    if (v) this.mailer.sendInBackground(eventPaymentNotApprovedMail(this.cfg, v, reason));
  }

  /** A refund notice, with the proof of refund attached when given. */
  async refunded(e: EventRow, t: TicketRow, d: { type: 'full' | 'partial'; amount: string | null; note: string | null; cancelled: boolean; attachment: MailAttachment | null; spots?: number }) {
    const v = await this.view(e, t);
    if (v) this.mailer.sendInBackground(eventRefundMail(this.cfg, v, d));
  }

  async paymentExpired(e: EventRow, t: TicketRow, reservation = false) {
    const v = await this.view(e, t);
    if (v) this.mailer.sendInBackground(eventPaymentExpiredMail(this.cfg, v, reservation));
  }

  /** Paid: the spots are reserved (or a waitlisted person got one): pay and upload the proof by t.reuploadBy. */
  async reserved(e: EventRow, t: TicketRow, uploadToken: string, d: { places: number; amountLabel: string | null; fromWaitlist: boolean }) {
    const v = await this.view(e, t);
    if (!v || !t.reuploadBy) return;
    const s = await this.db.bookingSettings.findUnique({ where: { organizationId: e.organizationId }, select: { timeZone: true } });
    const f = formatInZone(t.reuploadBy, zoneOf(e, s?.timeZone ?? 'UTC'));
    this.mailer.sendInBackground(eventReservedMail(this.cfg, v, { ...d, deadline: `${f.date}, ${f.time} (${f.zone})`, uploadUrl: `${v.pageUrl}#upload=${t.id}.${uploadToken}` }));
  }

  /** Paid, full: on the waitlist; a payment link follows if a reserved spot is freed. */
  async waitlisted(e: EventRow, t: TicketRow) {
    const v = await this.view(e, t);
    if (v) this.mailer.sendInBackground(eventWaitlistedMail(this.cfg, v));
  }

  /** The owners and admins: a proof of payment to verify. */
  async paymentToVerify(e: EventRow, t: TicketRow, again: boolean) {
    const s = await this.db.bookingSettings.findUnique({ where: { organizationId: e.organizationId }, select: { businessName: true } });
    const members = await this.db.member.findMany({ where: { organizationId: e.organizationId, role: { in: ['owner', 'admin'] } }, include: { user: { select: { email: true } } } });
    for (const to of new Set(members.map((m) => m.user.email))) {
      this.mailer.sendInBackground(paymentToVerifyMail(this.cfg, { to, businessName: s?.businessName ?? '', eventTitle: e.title, attendeeName: t.name, attendeeEmail: t.email, eventUrl: `${this.cfg.clients.bookingsUrl}/app/events/${e.id}`, again }));
    }
  }

  /** The online link was added or changed: every confirmed attendee gets it. */
  async linkChanged(e: EventRow, changed: boolean) {
    const tickets = await this.db.eventTicket.findMany({ where: { eventId: e.id, status: 'confirmed' } });
    for (const t of tickets) {
      const v = await this.view(e, t);
      if (v) this.mailer.sendInBackground(eventLinkMail(this.cfg, v, changed));
    }
    logger.info({ eventId: e.id, attendees: tickets.length, changed }, 'Event link emailed to attendees');
  }
}

/** Something happened at an event: pushed live to the business's open event page (event-live.ts). */
export interface EventLiveMessage {
  eventId: number;
  type: 'checked_in' | 'check_in_undone' | 'registered' | 'revoked' | 'cancelled' | 'code_deleted' | 'scanner' | 'claimed' | 'claim_undone' | 'payment_submitted' | 'reserved' | 'waitlisted' | 'payment_approved' | 'payment_rejected' | 'payment_expired' | 'refunded' | 'refund_details';
  /** Claims: the item, e.g. "Free Water". */
  item?: string;
  name?: string;
  by?: string;
}

/** The live feed of every event (one process; the pages listen through EventsLiveController). */
@Injectable()
export class EventLive {
  readonly feed = new Subject<EventLiveMessage>();
  emit(m: EventLiveMessage) {
    this.feed.next(m);
  }
}

/**
 * Check-in at one event, from the business's own pages or a scanner link. Codes of other events
 * or of appointments are refused. Another day than the event's, a revoked registration or an
 * unused paid code are reported; `force` checks in anyway (not revoked ones, not other events').
 * Two scanners scanning the same code at once: only one checks in, the other sees "already".
 */
@Injectable()
export class EventCheckIns {
  constructor(
    private readonly db: ClientsDb,
    private readonly mails: EventMails,
    private readonly live: EventLive,
  ) {}

  async checkIn(orgId: string, eventId: number, body: { code?: string | null; ticketId?: number | null; force?: boolean }, who: { userId: string; by: string }) {
    const s = await this.db.bookingSettings.findUnique({ where: { organizationId: orgId }, select: { timeZone: true } });
    const e = await this.db.event.findFirst({ where: { id: eventId, organizationId: orgId } });
    if (!e) throw new ApiError(404, { error: 'not_found', message: 'That event does not exist.' });
    const tz = zoneOf(e, s?.timeZone ?? 'UTC');
    const code = body.code ? parseCheckInCode(body.code) : null;
    if (!body.ticketId && !code) throw new ApiError(400, { error: 'validation_failed', message: 'That is not a check-in code. Codes have 8 letters and numbers, like ABCD-EFGH.', fields: { code: 'Please check the code.' } });
    const t = await this.db.eventTicket.findFirst({ where: { organizationId: orgId, ...(body.ticketId ? { id: body.ticketId } : { code: code! }) }, include: { event: true } });
    if (!t) {
      // Maybe an appointment's code, or nothing at all.
      const booking = code ? await this.db.booking.findFirst({ where: { organizationId: orgId, checkInCode: code }, select: { id: true } }) : null;
      throw new ApiError(booking ? 409 : 404, booking ? { error: 'not_this_event', message: 'This is an appointment’s code, not a code for this event.' } : { error: 'not_found', message: 'No registration matches this code.' });
    }
    if (t.eventId !== eventId) {
      throw new ApiError(409, { error: 'not_this_event', message: `This code is for another event: “${t.event.title}”.`, event: { id: t.event.id, title: t.event.title, date: toLocal(t.event.startsAt, zoneOf(t.event, s?.timeZone ?? 'UTC')).date } });
    }
    const today = todayIn(tz);
    const eventDay = toLocal(e.startsAt, tz).date;
    let state = t.status === 'revoked' ? 'revoked' : t.status === 'cancelled' ? 'cancelled' : t.status === 'review' || t.status === 'rejected' || t.status === 'reserved' || t.status === 'waitlist' ? 'unpaid' : t.checkedInAt ? 'already' : t.status === 'pending' ? 'unclaimed' : eventDay !== today ? (eventDay > today ? 'early' : 'over') : 'ok';
    let row = t;
    let checkedIn = false;
    if (state === 'ok' || (body.force && ['early', 'over', 'unclaimed'].includes(state))) {
      const now = new Date();
      const { count } = await this.db.eventTicket.updateMany({
        where: { id: t.id, checkedInAt: null, status: { in: ['confirmed', 'pending'] } },
        data: { checkedInAt: now, checkedInBy: who.userId, ...(t.status === 'pending' ? { status: 'confirmed', confirmedAt: now, ...paidData(e, 'code') } : {}) },
      });
      row = await this.db.eventTicket.findUniqueOrThrow({ where: { id: t.id }, include: { event: true } });
      if (count) {
        checkedIn = true;
        await this.mails.checkedIn(e, row);
        this.live.emit({ eventId, type: 'checked_in', name: row.name, by: who.by });
        await logTicket(this.db, row, 'checked_in', who.by, t.status === 'pending' ? 'Unused code: registered at check-in' : state !== 'ok' ? `Checked in anyway (${state === 'early' ? 'not the event day' : state === 'over' ? 'after the event' : state})` : null);
        logger.info({ org: orgId, eventId, ticketId: t.id, state, by: who.by }, 'Event attendee checked in');
      } else state = 'already';
    }
    return { state, checkedIn, today, eventDate: eventDay, ticket: ticketRow(row) };
  }

  async undo(orgId: string, eventId: number, ticketId: number, by: string | null = null) {
    const t = await this.db.eventTicket.findFirst({ where: { id: ticketId, eventId, organizationId: orgId } });
    if (!t) throw new ApiError(404, { error: 'not_found', message: 'That registration does not exist.' });
    await this.db.eventTicket.update({ where: { id: ticketId }, data: { checkedInAt: null, checkedInBy: null } });
    await logTicket(this.db, t, 'check_in_undone', by);
    this.live.emit({ eventId, type: 'check_in_undone', name: t.name });
    return { ok: true };
  }
}

/**
 * Everything about the event, for the exports: the details (with totals), the attendees, every
 * claim, and the scanners. Times are in the event's time zone ("2026-12-03 14:05"); the JSON
 * also has the exact instants (ISO).
 */
export async function eventExportData(db: ClientsDb, orgId: string, id: number) {
  const businessTz = (await db.bookingSettings.findUnique({ where: { organizationId: orgId }, select: { timeZone: true } }))?.timeZone ?? 'UTC';
  const e = await db.event.findFirst({ where: { id, organizationId: orgId } });
  if (!e) throw new ApiError(404, { error: 'not_found', message: 'That event does not exist.' });
  const tz = zoneOf(e, businessTz);
  const [tickets, claimables, scanners, settings, refundRows, promoRows, requestRows] = await Promise.all([
    db.eventTicket.findMany({ where: { eventId: id }, orderBy: { createdAt: 'asc' }, include: { claims: true } }),
    db.eventClaimable.findMany({ where: { eventId: id }, orderBy: [{ position: 'asc' }, { id: 'asc' }] }),
    db.eventScanner.findMany({ where: { eventId: id }, orderBy: { createdAt: 'asc' }, include: { claimable: true } }),
    db.bookingSettings.findUnique({ where: { organizationId: orgId }, select: { businessName: true } }),
    db.eventRefund.findMany({ where: { ticket: { eventId: id } }, orderBy: { createdAt: 'asc' }, include: { ticket: { select: { name: true, email: true, code: true } } } }),
    db.eventPromoCode.findMany({ where: { eventId: id }, orderBy: { createdAt: 'asc' } }),
    db.eventRefundRequest.findMany({ where: { ticket: { eventId: id } }, orderBy: { createdAt: 'asc' }, include: { ticket: { select: { name: true, email: true, code: true } } } }),
  ]);
  const currency = e.currency ?? 'PHP';
  const money = (v: number) => formatMoney(v, currency);
  const at = (d: Date | null | undefined) => {
    if (!d) return '';
    const l = toLocal(d, tz);
    return `${l.date} ${String(Math.floor(l.minute / 60)).padStart(2, '0')}:${String(l.minute % 60).padStart(2, '0')}`;
  };
  const scannerName = (by: string | null) => {
    const sid = by?.startsWith('scanner:') ? Number(by.slice(8)) : null;
    const s = sid ? scanners.find((x) => x.id === sid) : null;
    return s ? `${s.firstName} ${s.lastName} (scanner)` : by ? 'Staff (in the app)' : '';
  };
  const STATUS: Record<string, string> = { confirmed: 'Registered', pending: 'Code not used yet', reserved: 'Reserved (proof of payment not sent yet)', waitlist: 'Waitlist', review: 'For verification', rejected: 'Payment rejected (re-upload)', revoked: 'Revoked', cancelled: 'Cancelled by attendee' };
  const row = eventRow(e, businessTz);
  const count = (f: (t: (typeof tickets)[number]) => boolean) => tickets.filter(f).length;
  const totals = {
    registered: count((t) => t.status === 'confirmed'),
    codesNotUsed: count((t) => t.status === 'pending'),
    paymentsToVerify: count((t) => t.status === 'review' || t.status === 'rejected'),
    reserved: count((t) => t.status === 'reserved'),
    waitlist: count((t) => t.status === 'waitlist'),
    cancelledOrRevoked: count((t) => t.status === 'cancelled' || t.status === 'revoked'),
    checkedIn: count((t) => !!t.checkedInAt),
  };
  // Attendance: everyone registered (confirmed), who came (admitted) and who didn't.
  const registered = tickets.filter((t) => t.status === 'confirmed');
  const admitted = registered.filter((t) => t.checkedInAt);
  const notAdmitted = registered.filter((t) => !t.checkedInAt);
  const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : 0);
  const arrivals = admitted.map((t) => Math.round((t.checkedInAt!.getTime() - e.startsAt.getTime()) / 60_000)).sort((a, b) => a - b);
  const median = arrivals.length ? arrivals[Math.floor(arrivals.length / 2)] : null;
  const hours = new Map<string, number>();
  for (const t of admitted) {
    const l = toLocal(t.checkedInAt!, tz);
    const key = `${l.date} ${String(Math.floor(l.minute / 60)).padStart(2, '0')}:00`;
    hours.set(key, (hours.get(key) ?? 0) + 1);
  }
  const SOURCE: Record<string, string> = { public: 'Event page', payment: 'Event page (proof of payment)', business: 'Code from the business', manual: 'Manual Register' };
  const bySource = [...new Set(registered.map((t) => t.source))].map((src) => {
    const all = registered.filter((t) => t.source === src);
    const came = all.filter((t) => t.checkedInAt).length;
    return { source: SOURCE[src] ?? src, registered: all.length, admitted: came, notAdmitted: all.length - came, rate: pct(came, all.length) };
  });
  const attendance = {
    registered: registered.length,
    admitted: admitted.length,
    notAdmitted: notAdmitted.length,
    attendanceRate: pct(admitted.length, registered.length),
    capacity: e.capacity,
    capacityFilled: e.capacity ? pct(registered.length, e.capacity) : null,
    cancelled: count((t) => t.status === 'cancelled'),
    revoked: count((t) => t.status === 'revoked'),
    firstCheckIn: admitted.length ? at(new Date(Math.min(...admitted.map((t) => t.checkedInAt!.getTime())))) : null,
    lastCheckIn: admitted.length ? at(new Date(Math.max(...admitted.map((t) => t.checkedInAt!.getTime())))) : null,
    medianArrivalMinutes: median,
    arrivedEarly: arrivals.filter((m) => m < 0).length,
    arrivedOnTime: arrivals.filter((m) => m >= 0 && m <= 15).length,
    arrivedLate: arrivals.filter((m) => m > 15).length,
    checkInsByHour: [...hours.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([hour, n]) => ({ hour, checkIns: n })),
    bySource,
  };

  // Collections: payments (with promo discounts) and refunds, oldest first, with a running total.
  const paidTickets = tickets.filter((t) => t.paidAt);
  const moves = [
    ...paidTickets.map((t) => ({ at: t.paidAt!, kind: 'Payment', name: t.name, code: formatCheckInCode(t.code), method: t.paymentMethod ?? '', amount: Number(t.amountPaid ?? 0), cur: t.paidCurrency ?? currency, promo: t.promoCode ?? '', discount: t.discount === null ? 0 : Number(t.discount) })),
    ...refundRows.map((r) => ({ at: r.createdAt, kind: r.type === 'partial' ? 'Partial refund' : 'Full refund', name: r.ticket.name, code: formatCheckInCode(r.ticket.code), method: '', amount: -Number(r.amountValue ?? 0), cur: r.currency ?? currency, promo: '', discount: 0 })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());
  let runningTotal = 0;
  const collectionRows = moves.map((m) => {
    if (m.cur === currency) runningTotal += m.amount;
    return { ...m, running: Math.round(runningTotal * 100) / 100 };
  });
  const sumOf = (f: (m: (typeof moves)[number]) => boolean) => Math.round(moves.filter((m) => m.cur === currency && f(m)).reduce((a, m) => a + m.amount, 0) * 100) / 100;
  const collections = {
    currency,
    collected: sumOf((m) => m.kind === 'Payment'),
    refunded: -sumOf((m) => m.kind !== 'Payment'),
    net: sumOf(() => true),
    discounts: Math.round(moves.filter((m) => m.cur === currency).reduce((a, m) => a + m.discount, 0) * 100) / 100,
    payments: paidTickets.filter((t) => t.paymentMethod !== 'free').length,
    freePlaces: paidTickets.filter((t) => t.paymentMethod === 'free').length,
    refunds: refundRows.length,
  };
  const refundedOf = (ticketId: number) => refundRows.filter((r) => r.ticketId === ticketId).reduce((a, r) => a + Number(r.amountValue ?? 0), 0);

  const claims = claimables.flatMap((k) =>
    tickets
      .flatMap((t) => t.claims.filter((c) => c.claimableId === k.id).map((c) => ({ k, t, c })))
      .sort((a, b) => a.c.claimedAt.getTime() - b.c.claimedAt.getTime()),
  );

  const json = {
    exportedAt: new Date().toISOString(),
    event: {
      id: e.id,
      title: e.title,
      business: settings?.businessName ?? '',
      kind: e.kind,
      priceLabel: e.priceLabel,
      date: row.date,
      startTime: minuteText(row.startMinute),
      endTime: minuteText(row.endMinute),
      timeZone: tz,
      startsAt: e.startsAt.toISOString(),
      endsAt: e.endsAt.toISOString(),
      format: e.format,
      address: e.address,
      meetingUrl: e.meetingUrl,
      capacity: e.capacity,
      published: e.published,
      price: e.price === null ? null : Number(e.price),
      currency: e.currency,
      totals,
      attendance,
      collections,
    },
    attendees: tickets.map((t) => ({
      name: t.name,
      email: t.email,
      phone: t.phone,
      code: formatCheckInCode(t.code),
      status: t.status,
      source: t.source,
      registeredAt: (t.confirmedAt ?? t.createdAt).toISOString(),
      checkedInAt: t.checkedInAt?.toISOString() ?? null,
      checkedInBy: scannerName(t.checkedInBy) || null,
      admitted: !!t.checkedInAt,
      paymentMethod: t.paymentMethod,
      amountPaid: t.amountPaid === null ? null : Number(t.amountPaid),
      promoCode: t.promoCode,
      discount: t.discount === null ? null : Number(t.discount),
      refunded: refundedOf(t.id) || null,
      claims: t.claims.map((c) => ({ item: claimables.find((k) => k.id === c.claimableId)?.name ?? null, claimedAt: c.claimedAt.toISOString(), claimedBy: c.claimedBy })),
    })),
    claimables: claimables.map((k) => ({
      name: k.name,
      claimed: claims.filter((x) => x.k.id === k.id).length,
      notClaimed: tickets.filter((t) => t.status === 'confirmed' && !t.claims.some((c) => c.claimableId === k.id)).length,
      scanners: scanners.filter((s) => s.claimableId === k.id).map((s) => `${s.firstName} ${s.lastName}`),
    })),
    collections: collectionRows.map((m) => ({ at: m.at.toISOString(), type: m.kind, name: m.name, code: m.code, method: m.method || null, amount: m.amount, currency: m.cur, promoCode: m.promo || null, discount: m.discount || null, runningTotal: m.running })),
    refunds: refundRows.map((r) => ({ at: r.createdAt.toISOString(), type: r.type, name: r.ticket.name, email: r.ticket.email, code: formatCheckInCode(r.ticket.code), amount: r.amountValue === null ? null : Number(r.amountValue), currency: r.currency, cancelledRegistration: r.cancelled, note: r.note, proofOfRefund: r.proofName, by: r.createdBy })),
    refundRequests: requestRows.map((r) => ({ at: r.createdAt.toISOString(), name: r.ticket.name, code: formatCheckInCode(r.ticket.code), type: r.type, amount: r.amountValue === null ? null : Number(r.amountValue), status: r.status, method: r.method, completedAt: r.completedAt?.toISOString() ?? null })),
    promoCodes: promoRows.map((p) => ({
      code: p.code,
      discount: p.discountType === 'percent' ? `${Number(p.discountValue)}%` : money(Number(p.discountValue)),
      usageLimit: p.usageLimit,
      used: p.used,
      expiresAt: p.expiresAt?.toISOString() ?? null,
      active: p.active,
      places: tickets.filter((t) => t.promoCodeId === p.id).length,
      totalDiscount: Math.round(tickets.filter((t) => t.promoCodeId === p.id).reduce((a, t) => a + Number(t.discount ?? 0), 0) * 100) / 100,
    })),
    scanners: scanners.map((s) => ({
      name: `${s.firstName} ${s.lastName}`,
      email: s.email,
      section: s.claimable?.name ?? 'Attendance',
      scannerCode: formatCheckInCode(s.scannerCode),
      status: !s.codeHash ? 'revoked' : s.redeemedAt ? 'signed_in' : 'not_signed_in',
      signedInAt: s.redeemedAt?.toISOString() ?? null,
      lastActiveAt: s.lastSeenAt?.toISOString() ?? null,
    })),
  };

  const details: (string | number)[][] = [
    ['Event', e.title],
    ['Business', settings?.businessName ?? ''],
    ['Date', row.date],
    ['Time', `${minuteText(row.startMinute)} – ${minuteText(row.endMinute)}`],
    ['Time zone', tz],
    ['Type', e.kind === 'paid' ? `Paid${e.priceLabel ? ` (${e.priceLabel})` : ''}` : 'Free'],
    ['Where', e.format === 'online' ? `Online${e.meetingUrl ? `: ${e.meetingUrl}` : ''}` : (e.address ?? '')],
    ['Capacity', e.capacity ?? 'No limit'],
    ['Published', e.published ? 'Yes' : 'No'],
    [],
    ['Registered', totals.registered],
    ['Codes not used yet', totals.codesNotUsed],
    ['Payments to verify', totals.paymentsToVerify],
    ['Cancelled or revoked', totals.cancelledOrRevoked],
    ['Checked in', totals.checkedIn],
    ...json.claimables.map((k) => [`Claimed: ${k.name}`, k.claimed]),
    [],
    ['ATTENDANCE', ''],
    ['Admitted', attendance.admitted],
    ['Not admitted', attendance.notAdmitted],
    ['Attendance rate', `${attendance.attendanceRate}%`],
    ...(e.capacity ? [['Capacity filled', `${attendance.capacityFilled}%`]] : []),
    ...(e.kind === 'paid'
      ? [
          [],
          ['COLLECTIONS', currency],
          ['Collected', money(collections.collected)],
          ['Refunded', money(collections.refunded)],
          ['Net', money(collections.net)],
          ['Promo discounts', money(collections.discounts)],
          ['Payments', collections.payments],
          ['Free spots', collections.freePlaces],
          ['Refunds', collections.refunds],
        ]
      : []),
    [],
    ['Exported at', at(new Date())],
  ];
  const attendees = [
    ['Name', 'Email', 'Phone', 'Code', 'Status', 'Source', 'Registered at', 'Admitted', 'Checked in at', 'Checked in by', ...(e.kind === 'paid' ? ['Paid', 'Method', 'Promo code', 'Discount', 'Refunded'] : []), ...claimables.map((k) => k.name)],
    ...tickets.map((t) => [
      t.name,
      t.email,
      t.phone ?? '',
      formatCheckInCode(t.code),
      STATUS[t.status] ?? t.status,
      t.source === 'business' ? 'Code from the business' : t.source === 'payment' ? 'Event page (proof of payment)' : 'Event page',
      at(t.confirmedAt ?? t.createdAt),
      t.checkedInAt ? 'Yes' : t.status === 'confirmed' ? 'No' : '',
      at(t.checkedInAt),
      scannerName(t.checkedInBy),
      ...(e.kind === 'paid' ? [t.amountPaid === null ? '' : money(Number(t.amountPaid)), t.paymentMethod ?? '', t.promoCode ?? '', t.discount === null ? '' : money(Number(t.discount)), refundedOf(t.id) ? money(refundedOf(t.id)) : ''] : []),
      ...claimables.map((k) => (t.claims.some((c) => c.claimableId === k.id) ? 'Claimed' : '')),
    ]),
  ];
  const claimRows = [
    ['Claimable', 'Attendee', 'Email', 'Code', 'Claimed at', 'Claimed by'],
    ...claims.map(({ k, t, c }) => [k.name, t.name, t.email, formatCheckInCode(t.code), at(c.claimedAt), c.claimedBy ?? '']),
    [],
    ['Claimable', 'Claimed', 'Not claimed yet', 'Scanners'],
    ...json.claimables.map((k) => [k.name, k.claimed, k.notClaimed, k.scanners.join(', ')]),
  ];
  const scannerRows = [
    ['Name', 'Email', 'Section', 'Scanner code', 'Status', 'Signed in at', 'Last active'],
    ...scanners.map((s) => [`${s.firstName} ${s.lastName}`, s.email, s.claimable?.name ?? 'Attendance', formatCheckInCode(s.scannerCode), !s.codeHash ? 'Access revoked' : s.redeemedAt ? 'Signed in' : 'Not signed in', at(s.redeemedAt), at(s.lastSeenAt)]),
  ];
  const analysisRows: (string | number)[][] = [
    ['Attendance analysis', ''],
    ['Registered', attendance.registered],
    ['Admitted', attendance.admitted],
    ['Not admitted (no-shows)', attendance.notAdmitted],
    ['Attendance rate', `${attendance.attendanceRate}%`],
    ...(attendance.capacityFilled !== null ? [['Capacity filled', `${attendance.capacityFilled}% of ${attendance.capacity}`]] : []),
    ['Cancelled by them', attendance.cancelled],
    ['Revoked', attendance.revoked],
    ['First check-in', attendance.firstCheckIn ?? ''],
    ['Last check-in', attendance.lastCheckIn ?? ''],
    ['Median arrival', attendance.medianArrivalMinutes === null ? '' : `${attendance.medianArrivalMinutes >= 0 ? `${attendance.medianArrivalMinutes} min after` : `${-attendance.medianArrivalMinutes} min before`} the start`],
    ['Arrived early (before the start)', attendance.arrivedEarly],
    ['On time (within 15 min)', attendance.arrivedOnTime],
    ['Late (more than 15 min)', attendance.arrivedLate],
    [],
    ['By source', 'Registered', 'Admitted', 'Not admitted', 'Attendance rate'],
    ...attendance.bySource.map((x) => [x.source, x.registered, x.admitted, x.notAdmitted, `${x.rate}%`]),
    [],
    ['Check-ins by hour', 'Check-ins'],
    ...attendance.checkInsByHour.map((x) => [x.hour, x.checkIns]),
    ...(claimables.length ? [[], ['Claimables', 'Claimed', 'Not claimed (registered)', 'Claim rate (of admitted)'], ...json.claimables.map((k) => [k.name, k.claimed, k.notClaimed, `${pct(k.claimed, attendance.admitted)}%`])] : []),
    [],
    ['Not admitted', 'Email', 'Code'],
    ...notAdmitted.map((t) => [t.name, t.email, formatCheckInCode(t.code)]),
  ];
  const collectionSheet = [
    ['When', 'Type', 'Attendee', 'Code', 'Method', 'Promo code', 'Discount', 'Amount', 'Running total'],
    ...collectionRows.map((m) => [at(m.at), m.kind, m.name, m.code, m.method, m.promo, m.discount ? formatMoney(m.discount, m.cur) : '', `${m.amount < 0 ? '−' : ''}${formatMoney(Math.abs(m.amount), m.cur)}`, money(m.running)]),
    [],
    ['Collected', money(collections.collected)],
    ['Refunded', money(collections.refunded)],
    ['Net', money(collections.net)],
    ['Promo discounts', money(collections.discounts)],
  ];
  const refundSheet = [
    ['When', 'Type', 'Attendee', 'Email', 'Code', 'Amount', 'Registration cancelled', 'Proof of refund', 'Note', 'By'],
    ...refundRows.map((r) => [at(r.createdAt), r.type === 'partial' ? 'Partial' : 'Full', r.ticket.name, r.ticket.email, formatCheckInCode(r.ticket.code), r.amount ?? '', r.cancelled ? 'Yes' : 'No', r.proofName ?? '', r.note ?? '', r.createdBy]),
    [],
    ['Refund requests', 'Attendee', 'Code', 'Type', 'Amount', 'Status', 'Details given', 'Completed'],
    ...requestRows.map((r) => [at(r.createdAt), r.ticket.name, formatCheckInCode(r.ticket.code), r.type, r.amountValue === null ? '' : formatMoney(Number(r.amountValue), r.currency ?? currency), r.status, r.method === 'qr' ? 'QR code' : r.method === 'bank' ? `${r.bankName}, ${r.accountName}` : '', at(r.completedAt)]),
  ];
  const promoSheet = [
    ['Code', 'Discount', 'Usage limit', 'Used', 'Spots with it', 'Total discount', 'Expires', 'Active'],
    ...json.promoCodes.map((p, i) => [p.code, p.discount, p.usageLimit ?? 'Unlimited', p.used, p.places, money(p.totalDiscount), promoRows[i].expiresAt ? at(promoRows[i].expiresAt) : 'Never', p.active ? 'Yes' : 'No']),
  ];
  return { file: `${e.slug}-${row.date}`, json, details, attendees, claims: claimRows, scanners: scannerRows, analysis: analysisRows, collections: collectionSheet, refunds: refundSheet, promos: promoSheet, paid: e.kind === 'paid' };
}

/** The Excel workbook's tabs (the xlsx export, the zip, and the deletion backup). */
export function eventSheets(d: Awaited<ReturnType<typeof eventExportData>>) {
  return [
    { name: 'Details', rows: d.details },
    { name: 'Attendees', rows: d.attendees, header: true },
    { name: 'Attendance analysis', rows: d.analysis },
    ...(d.paid
      ? [
          { name: 'Collections', rows: d.collections, header: true },
          { name: 'Refunds', rows: d.refunds, header: true },
          { name: 'Promo codes', rows: d.promos, header: true },
        ]
      : []),
    { name: 'Claimables', rows: d.claims, header: true },
    { name: 'Scanners', rows: d.scanners, header: true },
  ];
}


/** The attendees as CSV (UTF-8 with a BOM, so Excel reads accents; formula-looking cells neutralized). */
export const eventCsv = (d: { attendees: (string | number)[][] }) => '\uFEFF' + d.attendees.map((r) => r.map((v) => csvCell(String(v ?? ''))).join(',')).join('\r\n') + '\r\n';

// ---- The business's side ----

@Controller('client/bookings/events')
export class EventsAdminController {
  constructor(
    private readonly db: ClientsDb,
    private readonly mails: EventMails,
    private readonly checkIns: EventCheckIns,
    private readonly live: EventLive,
    private readonly files: PaymentFiles,
    @Inject(MAILER) private readonly mailer: Mailer,
  ) {}

  private async tz(orgId: string) {
    const s = await this.db.bookingSettings.findUnique({ where: { organizationId: orgId }, select: { timeZone: true } });
    if (!s) throw new ApiError(404, { error: 'not_set_up', message: 'Bookings is not set up for this business yet.' });
    return s.timeZone;
  }

  private async limits(orgId: string) {
    const ents = await loadEntitlements(this.db, orgId);
    return { participants: limitOf(ents, 'events.participants'), perDay: limitOf(ents, 'events.per_day'), planName: ents.planName };
  }

  /**
   * The plan's rules for a new or changed event: capacity within the participant limit (on a
   * limited plan, no capacity = the limit), and at most `perDay` events on its date.
   */
  private async checkLimits(orgId: string, tz: string, data: Record<string, unknown>, current?: EventRow) {
    const l = await this.limits(orgId);
    const granted = Math.max((data.participantLimit as number | undefined) ?? 0, current?.participantLimit ?? 0) || null;
    const cap = participantCap({ participantLimit: granted }, l.participants);
    if (cap !== null) {
      const capacity = 'capacity' in data ? (data.capacity as number | null) : (current?.capacity ?? null);
      if (capacity === null) data.capacity = cap;
      else if (capacity > cap && 'capacity' in data) {
        throw new ApiError(403, {
          error: 'participant_limit',
          message:
            cap > (l.participants ?? 0)
              ? `This event's voucher allows up to ${cap} participants. For more, a new voucher is needed (51–300 for $10, up to 500 for $20, more: custom pricing).`
              : `Events include up to ${cap} participants. For a bigger event, enter the 8-character voucher from Byte Bun (51–300 for $10, up to 500 for $20, more: custom pricing).`,
          fields: { capacity: `At most ${cap}.` },
        });
      }
    }
    if (l.perDay !== null && data.startsAt) {
      const zone = (data.timeZone as string | undefined) ?? (current ? zoneOf(current, tz) : tz);
      const date = toLocal(data.startsAt as Date, zone).date;
      const sameDay = await this.db.event.count({
        where: { organizationId: orgId, startsAt: { gte: fromLocal(date, 0, zone), lt: fromLocal(addDays(date, 1), 0, zone) }, ...(current ? { id: { not: current.id } } : {}) },
      });
      if (sameDay >= l.perDay) {
        throw new ApiError(403, { error: 'per_day_limit', message: `Your plan includes ${l.perDay === 1 ? 'one event' : `${l.perDay} events`} per day, and there's already one on this date. Pick another date, or upgrade your plan.`, fields: { date: 'Already an event on this date.' } });
      }
    }
  }

  /** A voucher this business can still use (or why not). */
  private async voucher(orgId: string, raw: string) {
    const code = parseCheckInCode(raw);
    const v = code ? await this.db.eventVoucher.findUnique({ where: { code } }) : null;
    if (!v || v.organizationId !== orgId) throw new ApiError(400, { error: 'bad_voucher', message: 'This voucher code isn’t valid. Please check it with Byte Bun.', fields: { voucherCode: 'Not a valid voucher.' } });
    if (v.usedAt) throw new ApiError(409, { error: 'voucher_used', message: 'This voucher has already been used for another event.', fields: { voucherCode: 'Already used.' } });
    return v;
  }

  /** Marks the voucher used by this event (once: a second use in parallel fails). */
  private async useVoucher(tx: ClientsTx, voucherId: number, eventId: number) {
    const { count } = await tx.eventVoucher.updateMany({ where: { id: voucherId, usedAt: null }, data: { usedAt: new Date(), eventId } });
    if (!count) throw new ApiError(409, { error: 'voucher_used', message: 'This voucher has already been used for another event.', fields: { voucherCode: 'Already used.' } });
  }

  @Post('vouchers/check')
  @HttpCode(200)
  @ClientRoute(EVENT_ROUTES.manage)
  async checkVoucher(@Req() req: Request, @Body(new YupValidationPipe(claimSchema)) body: yup.InferType<typeof claimSchema>) {
    const v = await this.voucher(ctx(req).org.id, body.code);
    return { participants: v.participants, priceLabel: v.priceLabel };
  }

  private async event(orgId: string, id: number) {
    const e = await this.db.event.findFirst({ where: { id, organizationId: orgId } });
    if (!e) throw new ApiError(404, { error: 'not_found', message: 'That event does not exist.' });
    return e;
  }

  @Get()
  @ClientRoute(EVENT_ROUTES.view)
  async list(@Req() req: Request) {
    const c = ctx(req);
    const tz = await this.tz(c.org.id);
    // Owners and admins: every event; everyone else: the events they're assigned to.
    const events = await this.db.event.findMany({ where: { organizationId: c.org.id, ...(c.allEvents ? {} : { team: { some: { userId: c.user.id } } }) }, orderBy: { startsAt: 'desc' }, take: 200 });
    const groups = await this.db.eventTicket.groupBy({ by: ['eventId', 'status'], where: { organizationId: c.org.id }, _count: { _all: true } });
    const checked = await this.db.eventTicket.groupBy({ by: ['eventId'], where: { organizationId: c.org.id, checkedInAt: { not: null } }, _count: { _all: true } });
    const count = (id: number, status: string) => groups.find((g) => g.eventId === id && g.status === status)?._count._all ?? 0;
    return events.map((e) =>
      eventRow(e, tz, { confirmed: count(e.id, 'confirmed'), pending: count(e.id, 'pending'), review: count(e.id, 'review') + count(e.id, 'rejected'), reserved: count(e.id, 'reserved'), waitlist: count(e.id, 'waitlist'), revoked: count(e.id, 'revoked'), checkedIn: checked.find((g) => g.eventId === e.id)?._count._all ?? 0 }),
    );
  }

  @Post()
  @ClientRoute(EVENT_ROUTES.manage)
  async create(@Req() req: Request, @Body(new YupValidationPipe(eventSchema)) body: yup.InferType<typeof eventSchema>) {
    const c = ctx(req);
    const tz = await this.tz(c.org.id);
    const data = this.fields(body, tz);
    // A new paid event has no payment channels yet: it starts unpublished.
    const heldBack = data.kind === 'paid' && data.published === true;
    if (heldBack) data.published = false;
    const voucher = body.voucherCode ? await this.voucher(c.org.id, body.voucherCode) : null;
    if (voucher) data.participantLimit = voucher.participants;
    else {
      // Without a voucher, the event is deleted 3 months after it ends: the business must agree.
      if (body.retentionAgreed !== true) {
        throw new ApiError(400, { error: 'retention_not_agreed', message: `Please agree that this event is deleted automatically ${EVENT_RETENTION_MONTHS} months after it ends.`, fields: { retentionAgreed: 'Required to create the event.' } });
      }
      data.retentionAgreedAt = new Date();
    }
    await this.checkLimits(c.org.id, tz, data);
    try {
      const e = await this.db.$transaction(async (tx) => {
        const created = await tx.event.create({ data: { organizationId: c.org.id, ...data } as never });
        if (voucher) await this.useVoucher(tx, voucher.id, created.id);
        // Whoever creates it works on it (they'd otherwise not see it, unless an owner or admin).
        if (!c.allEvents) await tx.eventMember.create({ data: { eventId: created.id, userId: c.user.id, organizationId: c.org.id, assignedBy: c.user.email } });
        return created;
      });
      logger.info({ org: c.org.id, eventId: e.id }, 'Event created');
      return { ...eventRow(e, tz), needsPaymentChannels: e.kind === 'paid', publishHeldBack: heldBack };
    } catch (err) {
      if (isUniqueClash(err)) throw new ApiError(409, { error: 'slug_taken', message: 'Another event already uses this link.', fields: { slug: 'Already used by another event.' } });
      throw err;
    }
  }

  /** Form fields -> columns (the date and times are in the event's time zone). */
  private fields(body: Partial<yup.InferType<typeof eventSchema>>, businessTz: string, current?: EventRow) {
    const tz = body.timeZone || (current ? zoneOf(current, businessTz) : businessTz);
    const data: Record<string, unknown> = {};
    for (const k of ['title', 'slug', 'kind', 'format', 'address', 'addressDetails', 'latitude', 'longitude', 'meetingUrl', 'capacity', 'registerLabel'] as const) if (body[k] !== undefined) data[k] = body[k] ?? null;
    // Paid events: a price and a currency are required (both editable); the page shows them
    // formatted ("₱1,500"). Free events have none.
    const kind = (data.kind as string | undefined) ?? current?.kind ?? 'free';
    if (kind === 'paid') {
      const price = body.price !== undefined ? body.price : current?.price === null || current?.price === undefined ? null : Number(current.price);
      const currency = body.currency !== undefined ? body.currency : (current?.currency ?? null);
      const missing: Record<string, string> = {};
      if (!price) missing.price = 'Please enter the price attendees pay.';
      if (!currency) missing.currency = 'Please choose the currency.';
      if (Object.keys(missing).length) throw new ApiError(400, { error: 'validation_failed', message: 'A paid event needs a price and a currency.', fields: missing });
      data.price = price;
      data.currency = currency;
      data.priceLabel = formatMoney(price!, currency!);
    } else if (data.kind === 'free' || !current) {
      data.price = null;
      data.currency = null;
      data.priceLabel = null;
    }
    if (body.published !== undefined) data.published = body.published;
    else if (!current) data.published = false;
    if (body.description !== undefined) data.description = cleanInstructions(body.description ?? null);
    if (body.timeZone !== undefined || !current) data.timeZone = tz;
    // Same wall-clock date and times, in the (possibly new) zone.
    if (body.date !== undefined || body.startMinute !== undefined || body.endMinute !== undefined || (current && body.timeZone && body.timeZone !== zoneOf(current, businessTz))) {
      const was = current ? eventRow(current, businessTz) : null;
      const date = body.date ?? was!.date;
      const startMinute = body.startMinute ?? was!.startMinute;
      const endMinute = body.endMinute ?? was!.endMinute;
      if (endMinute <= startMinute) throw new ApiError(400, { error: 'validation_failed', message: 'The end time must be after the start time.', fields: { endMinute: 'After the start time.' } });
      data.startsAt = fromLocal(date, startMinute, tz);
      data.endsAt = endMinute >= 1440 ? fromLocal(date, 1439, tz) : fromLocal(date, endMinute, tz);
    }
    return data;
  }

  @Get(':id')
  @ClientRoute(EVENT_ROUTES.view)
  async get(@Req() req: Request, @Param('id', ParseIntPipe) id: number) {
    const c = ctx(req);
    const tz = await this.tz(c.org.id);
    const e = await this.event(c.org.id, id);
    const tickets = await this.db.eventTicket.findMany({
      where: { eventId: id },
      orderBy: { createdAt: 'desc' },
      include: { claims: { select: { claimableId: true, claimedAt: true } }, proofs: { orderBy: { id: 'asc' } }, refunds: { orderBy: { id: 'asc' } } },
    });
    const claimables = await this.db.eventClaimable.findMany({ where: { eventId: id }, orderBy: [{ position: 'asc' }, { id: 'asc' }], select: { id: true, name: true } });
    const channels = await this.db.eventPaymentChannel.findMany({ where: { eventId: id }, orderBy: [{ position: 'asc' }, { id: 'asc' }] });
    const l = await this.limits(c.org.id);
    return {
      event: eventRow(e, tz),
      claimables,
      paymentChannels: channels.map(channelRow),
      tickets: tickets.map((t) => ({ ...ticketRow(t), claims: t.claims })),
      taken: tickets.filter((t) => isLive(t.status)).length,
      limits: { participants: participantCap(e, l.participants), perDay: l.perDay, planName: l.planName, sizes: EVENT_SIZES },
    };
  }

  @Patch(':id')
  @ClientRoute(EVENT_ROUTES.manage)
  async update(@Req() req: Request, @Param('id', ParseIntPipe) id: number, @Body(new YupValidationPipe(eventPatchSchema)) body: yup.InferType<typeof eventPatchSchema>) {
    const c = ctx(req);
    const tz = await this.tz(c.org.id);
    const before = await this.event(c.org.id, id);
    if (body.kind && body.kind !== before.kind && (await this.db.eventTicket.count({ where: { eventId: id } }))) {
      throw new ApiError(409, { error: 'has_registrations', message: 'People are already registered, so the event can’t switch between free and paid.', fields: { kind: 'Fixed once people register.' } });
    }
    const data = this.fields(body, tz, before);
    const willBePublished = (data.published as boolean | undefined) ?? before.published;
    const willBePaid = ((data.kind as string | undefined) ?? before.kind) === 'paid';
    if (willBePublished && willBePaid && !(await this.db.eventPaymentChannel.count({ where: { eventId: id } }))) throw noChannels();
    // A new voucher grows the event (a new payment); it never shrinks what was paid for before.
    const voucher = body.voucherCode ? await this.voucher(c.org.id, body.voucherCode) : null;
    if (voucher) data.participantLimit = Math.max(voucher.participants, before.participantLimit ?? 0);
    await this.checkLimits(c.org.id, tz, data, before);
    let e: EventRow;
    try {
      e = await this.db.$transaction(async (tx) => {
        const updated = await tx.event.update({ where: { id }, data });
        if (voucher) await this.useVoucher(tx, voucher.id, id);
        return updated;
      });
    } catch (err) {
      if (isUniqueClash(err)) throw new ApiError(409, { error: 'slug_taken', message: 'Another event already uses this link.', fields: { slug: 'Already used by another event.' } });
      throw err;
    }
    // Online link added or changed: tell everyone registered.
    let emailed = 0;
    if (e.format === 'online' && e.meetingUrl && e.meetingUrl !== before.meetingUrl) {
      emailed = await this.db.eventTicket.count({ where: { eventId: id, status: 'confirmed' } });
      await this.mails.linkChanged(e, !!before.meetingUrl);
    }
    return { event: eventRow(e, tz), emailed };
  }

  @Get(':id/export.xlsx')
  @Header('Cache-Control', 'no-store')
  @ClientRoute(EVENT_ROUTES.view)
  async exportXlsx(@Req() req: Request, @Param('id', ParseIntPipe) id: number, @Res() res: Response) {
    const d = await eventExportData(this.db, ctx(req).org.id, id);
    const body = xlsx(eventSheets(d));
    res
      .status(200)
      .set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${d.file}.xlsx"` })
      .send(body);
  }

  /** Everything in one zip, with every proof of payment in a folder per attendee (event-zip.ts). */
  @Get(':id/export.zip')
  @Header('Cache-Control', 'no-store')
  @ClientRoute(EVENT_ROUTES.view)
  async exportZip(@Req() req: Request, @Param('id', ParseIntPipe) id: number, @Res() res: Response) {
    const z = await eventZip(this.db, this.files, ctx(req).org.id, id);
    res.status(200).set({ 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${z.file}"` }).send(z.body);
  }

  @Get(':id/export.csv')
  @Header('Cache-Control', 'no-store')
  @ClientRoute(EVENT_ROUTES.view)
  async exportCsv(@Req() req: Request, @Param('id', ParseIntPipe) id: number, @Res() res: Response) {
    const d = await eventExportData(this.db, ctx(req).org.id, id);
    // Excel opens it as UTF-8 thanks to the BOM; formula-looking cells are neutralized.
    const csv = '﻿' + d.attendees.map((r) => r.map((v) => csvCell(String(v ?? ''))).join(',')).join('\r\n') + '\r\n';
    res.status(200).set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${d.file}.csv"` }).send(csv);
  }

  @Get(':id/export.json')
  @Header('Cache-Control', 'no-store')
  @ClientRoute(EVENT_ROUTES.view)
  async exportJson(@Req() req: Request, @Param('id', ParseIntPipe) id: number, @Res() res: Response) {
    const d = await eventExportData(this.db, ctx(req).org.id, id);
    res
      .status(200)
      .set({ 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="${d.file}.json"` })
      .send(JSON.stringify(d.json, null, 2));
  }

  /** Step 1 of deleting: a 6-digit code, emailed to the person asking (10 minutes, 5 tries). */
  @Post(':id/delete-code')
  @HttpCode(200)
  @StrictRateLimit()
  @ClientRoute(EVENT_ROUTES.manage)
  async requestDelete(@Req() req: Request, @Param('id', ParseIntPipe) id: number) {
    const c = ctx(req);
    const e = await this.event(c.org.id, id);
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.db.event.update({ where: { id }, data: { deleteCodeHash: sha256(`${id}:${code}`), deleteCodeExpiresAt: new Date(Date.now() + DELETE_CODE_MINUTES * 60_000), deleteCodeUserId: c.user.id, deleteCodeAttempts: 0 } });
    const registrations = await this.db.eventTicket.count({ where: { eventId: id, status: { in: LIVE_STATUSES } } });
    this.mailer.sendInBackground(eventDeleteCodeMail(this.mails.cfgFor(), { to: c.user.email, name: c.user.name || c.user.email, businessName: c.org.name, eventTitle: e.title, code, minutes: DELETE_CODE_MINUTES, registrations }));
    logger.info({ org: c.org.id, eventId: id }, 'Event delete code sent');
    return { sentTo: c.user.email, registrations, minutes: DELETE_CODE_MINUTES };
  }

  /** Step 2: with the emailed code, the whole event goes (registrations, scanners, claimables, claims). */
  @Post(':id/delete')
  @HttpCode(200)
  @ClientRoute(EVENT_ROUTES.manage)
  async remove(@Req() req: Request, @Param('id', ParseIntPipe) id: number, @Body(new YupValidationPipe(deleteSchema)) body: yup.InferType<typeof deleteSchema>) {
    const c = ctx(req);
    const e = await this.event(c.org.id, id);
    const expired = !e.deleteCodeHash || !e.deleteCodeExpiresAt || e.deleteCodeExpiresAt <= new Date() || e.deleteCodeAttempts >= DELETE_CODE_TRIES || e.deleteCodeUserId !== c.user.id;
    if (expired) throw new ApiError(410, { error: 'code_expired', message: 'This code has expired. Ask for a new one.', fields: { code: 'Expired: ask for a new code.' } });
    if (sha256(`${id}:${body.code}`) !== e.deleteCodeHash) {
      await this.db.event.update({ where: { id }, data: { deleteCodeAttempts: { increment: 1 } } });
      const left = DELETE_CODE_TRIES - e.deleteCodeAttempts - 1;
      throw new ApiError(400, { error: 'bad_code', message: left > 0 ? `That code isn’t right. ${left} ${left === 1 ? 'try' : 'tries'} left.` : 'Too many wrong codes. Ask for a new one.', fields: { code: 'Wrong code.' } });
    }
    const attendees = body.notifyAttendees ? await this.db.eventTicket.findMany({ where: { eventId: id, status: 'confirmed' } }) : [];
    if (attendees.length && e.endsAt > new Date()) await this.mails.eventCancelled(e, attendees);
    const [proofs, qrs] = await Promise.all([
      this.db.eventPaymentProof.findMany({ where: { ticket: { eventId: id } }, select: { file: true } }),
      this.db.eventPaymentChannel.findMany({ where: { eventId: id, qrFile: { not: null } }, select: { qrFile: true } }),
    ]);
    const refundQrs = await this.db.eventRefundRequest.findMany({ where: { ticket: { eventId: id }, qrFile: { not: null } }, select: { qrFile: true } });
    const refundProofs = await this.db.eventRefund.findMany({ where: { ticket: { eventId: id }, proofFile: { not: null } }, select: { proofFile: true } });
    await this.db.$transaction([this.db.eventVoucher.updateMany({ where: { eventId: id }, data: { eventId: null } }), this.db.event.delete({ where: { id } })]);
    // Its uploads go with it: proofs of payment and payment QR codes.
    await this.files.remove('event-proofs', ...proofs.map((p) => p.file));
    await this.files.remove('event-payment-qr', ...qrs.map((q) => q.qrFile));
    await this.files.remove('event-refund-details', ...refundQrs.map((q) => q.qrFile));
    await this.files.remove('event-media', e.coverFile, e.logoFile);
    await this.files.remove('event-refund-proofs', ...refundProofs.map((r) => r.proofFile));
    this.live.emit({ eventId: id, type: 'scanner' });
    logger.info({ org: c.org.id, eventId: id, notified: attendees.length }, 'Event deleted');
    return { ok: true, notified: e.endsAt > new Date() ? attendees.length : 0 };
  }

  /** "We need more places": emails Byte Bun, who invoices it and raises the event's limit. */
  @Post(':id/upgrade-request')
  @HttpCode(200)
  @ClientRoute(EVENT_ROUTES.manage)
  async upgradeRequest(@Req() req: Request, @Param('id', ParseIntPipe) id: number, @Body(new YupValidationPipe(upgradeSchema)) body: yup.InferType<typeof upgradeSchema>) {
    const c = ctx(req);
    const tz = await this.tz(c.org.id);
    const e = await this.event(c.org.id, id);
    const price = eventSizePrice(body.participants);
    const when = formatInZone(e.startsAt, zoneOf(e, tz));
    const lines = [
      `${c.org.name} asks for a bigger event.`,
      '',
      `Event: ${e.title} (id ${e.id})`,
      `When: ${when.date}, ${when.time} (${when.zone})`,
      `Participants wanted: ${body.participants}`,
      `Price: ${price}${price === 'custom pricing' ? '' : ' (one time, for this event)'}`,
      `Asked by: ${c.user.name || c.user.email} <${c.user.email}>`,
      ...(body.note ? ['', `Note: ${body.note}`] : []),
      '',
      'After payment, raise the event’s participant limit on the admin site (Clients > this client > Events).',
    ];
    this.mailer.sendInBackground({ to: ADMINS.map((a) => a.email), subject: `Event upgrade request: ${c.org.name}, ${body.participants} participants`, text: lines.join('\n'), replyTo: c.user.email });
    logger.info({ org: c.org.id, eventId: id, participants: body.participants }, 'Event upgrade requested');
    return { ok: true, price };
  }

  @Post(':id/tickets')
  @ClientRoute(EVENT_ROUTES.attendees)
  async issue(@Req() req: Request, @Param('id', ParseIntPipe) id: number, @Body(new YupValidationPipe(attendeeSchema)) body: yup.InferType<typeof attendeeSchema>) {
    const c = ctx(req);
    const e = await this.event(c.org.id, id);
    if (e.kind !== 'paid') throw new ApiError(409, { error: 'free_event', message: 'Codes are for paid events. People register for free events on the event page.' });
    try {
      const t = await this.db.$transaction(async (tx) => {
        if (e.capacity !== null && (await taken(tx, id)) >= e.capacity) throw new ApiError(409, { error: 'full', message: `The event is full (${e.capacity} spots). Raise the capacity to add more.` });
        return tx.eventTicket.create({ data: { eventId: id, organizationId: c.org.id, name: body.name, email: body.email, phone: body.phone ?? null, code: await freeCode(tx, c.org.id), status: 'pending', source: 'business' } });
      });
      await logTicket(this.db, t, 'code_issued', c.user.name || c.user.email);
      logger.info({ org: c.org.id, eventId: id, ticketId: t.id }, 'Event code issued');
      return ticketRow(t);
    } catch (err) {
      if (isUniqueClash(err)) throw alreadyRegistered();
      throw err;
    }
  }

  /**
   * Manual Register: the business adds someone itself; confirmed straight away, QR code emailed.
   * Paid events: the amount they paid the business directly (default: the price), or free.
   */
  @Post(':id/tickets/manual')
  @ClientRoute(EVENT_ROUTES.attendees)
  async manual(@Req() req: Request, @Param('id', ParseIntPipe) id: number, @Body(new YupValidationPipe(manualSchema)) body: yup.InferType<typeof manualSchema>) {
    const c = ctx(req);
    const e = await this.event(c.org.id, id);
    if (e.endsAt <= new Date()) throw new ApiError(409, { error: 'over', message: 'This event is over.' });
    const quantity = body.quantity ?? 1;
    const tickets = await this.db.$transaction(async (tx) => {
      // Checked when saving, with the event locked: two registrations at once can't overbook it.
      await tx.$queryRaw`SELECT "id" FROM "booking"."events" WHERE "id" = ${id} FOR UPDATE`;
      if (e.capacity !== null) {
        const left = Math.max(0, e.capacity - (await taken(tx, id)));
        if (quantity > left) {
          throw new ApiError(409, {
            error: left ? 'not_enough_places' : 'full',
            message: left ? `Only ${left} spot${left === 1 ? '' : 's'} left. Register up to ${left}, or raise the capacity.` : `The event is full (${e.capacity} spots). Raise the capacity to add more.`,
            fields: { quantity: left ? `At most ${left}.` : 'The event is full.' },
          });
        }
      }
      const groupId = quantity > 1 ? randomUUID() : null;
      // A promo code (paid, not free places): as many uses as it has left, one per place.
      const { promo, granted } = e.kind === 'paid' && !body.free ? await takePromo(tx, id, body.promoCode, quantity) : { promo: null, granted: 0 };
      const price = e.price === null ? 0 : Number(e.price);
      const per = body.amount ?? price;
      const made = [];
      for (let i = 0; i < quantity; i++) {
        const discount = promo && i < granted ? discountFor(promo, price) : null;
        made.push(
          await tx.eventTicket.create({
            data: {
              eventId: id,
              organizationId: c.org.id,
              name: body.name,
              email: body.email,
              phone: body.phone ?? null,
              code: await freeCode(tx, c.org.id),
              status: 'confirmed',
              confirmedAt: new Date(),
              source: 'manual',
              ...(groupId ? { groupId, groupSize: quantity } : {}),
              ...paidData(e, body.free ? 'free' : 'manual', discount !== null ? Math.max(0, per - discount) : per),
              ...(discount !== null ? { promoCodeId: promo!.id, promoCode: promo!.code, discount } : {}),
            },
          }),
        );
      }
      return made;
    });
    await this.mails.bulkConfirmation(e, tickets);
    this.live.emit({ eventId: id, type: 'registered', name: quantity > 1 ? `${body.name} (${quantity} spots)` : body.name });
    const by = c.user.name || c.user.email;
    const paidNote = (t: (typeof tickets)[number]) => (e.kind !== 'paid' ? null : body.free ? 'Marked as free' : t.amountPaid !== null && e.currency ? `Paid ${formatMoney(Number(t.amountPaid), e.currency)} directly` : null);
    const promoNote = (t: (typeof tickets)[number]) => (t.promoCode && t.discount !== null && e.currency ? `Promo ${t.promoCode}: ${formatMoney(Number(t.discount), e.currency)} off` : null);
    for (const [i, t] of tickets.entries()) await logTicket(this.db, t, 'registered_manually', by, [quantity > 1 ? `Bulk: spot ${i + 1} of ${quantity}` : null, paidNote(t), promoNote(t)].filter(Boolean).join(' · ') || null);
    logger.info({ org: c.org.id, eventId: id, tickets: tickets.length, free: body.free }, 'Event manual registration');
    const promoted = tickets.filter((t) => t.promoCode).length;
    return { ...ticketRow(tickets[0]), count: tickets.length, promoted, tickets: tickets.map(ticketRow) };
  }

  /**
   * Paid events: the running collections. Every payment (approved proofs, organizer codes, manual
   * registrations, free places at 0) and every refund (negative), oldest first, with a running total.
   */
  @Get(':id/collections')
  @ClientRoute(EVENT_ROUTES.payments)
  async collections(@Req() req: Request, @Param('id', ParseIntPipe) id: number) {
    const e = await this.event(ctx(req).org.id, id);
    const [paid, refunds] = await Promise.all([
      this.db.eventTicket.findMany({ where: { eventId: id, paidAt: { not: null } }, orderBy: { paidAt: 'asc' } }),
      this.db.eventRefund.findMany({ where: { ticket: { eventId: id } }, orderBy: { createdAt: 'asc' }, include: { ticket: { select: { name: true, email: true, code: true, groupId: true } } } }),
    ]);
    const currency = e.currency ?? 'PHP';
    const rows = [
      ...paid.map((t) => ({ kind: 'payment' as const, id: `p${t.id}`, ticketId: t.id, groupId: t.groupId, at: t.paidAt!, name: t.name, email: t.email, code: formatCheckInCode(t.code), method: t.paymentMethod ?? 'manual', amount: Number(t.amountPaid ?? 0), currency: t.paidCurrency ?? currency, status: t.status, note: null as string | null, promoCode: t.promoCode, discount: t.discount === null ? 0 : Number(t.discount) })),
      ...refunds.map((r) => ({ kind: 'refund' as const, id: `r${r.id}`, ticketId: r.ticketId, groupId: r.ticket.groupId, at: r.createdAt, name: r.ticket.name, email: r.ticket.email, code: formatCheckInCode(r.ticket.code), method: r.type, amount: -Number(r.amountValue ?? 0), currency: r.currency ?? currency, status: r.cancelled ? 'cancelled' : null, note: r.note, promoCode: null as string | null, discount: 0 })),
    ].sort((a, b) => a.at.getTime() - b.at.getTime());
    // Running total, in the event's currency (other currencies are listed but not added up).
    let running = 0;
    const out = rows.map((r) => {
      if (r.currency === currency) running += r.amount;
      return { ...r, label: formatMoney(Math.abs(r.amount), r.currency), discountLabel: r.discount ? formatMoney(r.discount, r.currency) : null, running: Math.round(running * 100) / 100, runningLabel: formatMoney(Math.abs(running), currency) };
    });
    const sum = (f: (r: (typeof rows)[number]) => boolean) => Math.round(rows.filter((r) => r.currency === currency && f(r)).reduce((a, r) => a + r.amount, 0) * 100) / 100;
    const collected = sum((r) => r.kind === 'payment');
    const refunded = -sum((r) => r.kind === 'refund');
    const discounts = Math.round(rows.filter((r) => r.currency === currency).reduce((a, r) => a + r.discount, 0) * 100) / 100;
    return {
      currency,
      price: e.price === null ? null : Number(e.price),
      rows: out,
      totals: {
        collected,
        refunded,
        net: Math.round((collected - refunded) * 100) / 100,
        payments: rows.filter((r) => r.kind === 'payment' && r.method !== 'free').length,
        free: rows.filter((r) => r.kind === 'payment' && r.method === 'free').length,
        refunds: refunds.length,
        discounts,
        promoUses: rows.filter((r) => r.promoCode).length,
        labels: { collected: formatMoney(collected, currency), refunded: formatMoney(refunded, currency), net: formatMoney(collected - refunded, currency), discounts: formatMoney(discounts, currency) },
      },
    };
  }

  /** A registration's activity log, oldest first. */
  @Get(':id/tickets/:tid/log')
  @ClientRoute(EVENT_ROUTES.view)
  async log(@Req() req: Request, @Param('id', ParseIntPipe) id: number, @Param('tid', ParseIntPipe) tid: number) {
    const t = await this.db.eventTicket.findFirst({ where: { id: tid, eventId: id, organizationId: ctx(req).org.id }, select: { id: true } });
    if (!t) throw new ApiError(404, { error: 'not_found', message: 'That registration does not exist.' });
    const rows = await this.db.eventTicketLog.findMany({ where: { ticketId: tid }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    return { entries: rows.map((r) => ({ id: r.id, action: r.action, by: r.by, detail: r.detail, at: r.createdAt })) };
  }

  @Delete(':id/tickets/:tid')
  @ClientRoute(EVENT_ROUTES.attendees)
  async deleteCode(@Req() req: Request, @Param('id', ParseIntPipe) id: number, @Param('tid', ParseIntPipe) tid: number) {
    // An unused code is deleted. A registration whose payment isn't confirmed is removed from the
    // list (revoked: its place is freed) but kept with its proofs until the event is deleted.
    const t = await this.db.eventTicket.findFirst({ where: { id: tid, eventId: id, organizationId: ctx(req).org.id, status: { in: ['pending', 'reserved', 'waitlist', 'review', 'rejected'] } } });
    let count = 0;
    if (t?.status === 'pending') count = (await this.db.eventTicket.deleteMany({ where: { id: tid, status: 'pending' } })).count;
    else if (t) {
      // A bulk booking waiting for verification is removed as a whole.
      const ids = (await bookingSpots(this.db, t, ['reserved', 'waitlist', 'review', 'rejected'])).map((x) => x.id);
      count = (await this.db.eventTicket.updateMany({ where: { id: { in: ids }, status: { in: ['reserved', 'waitlist', 'review', 'rejected'] } }, data: { status: 'revoked', revokedAt: new Date(), revokeReason: 'Removed by the business', reuploadBy: null, uploadTokenHash: null } })).count;
      if (count) {
        await this.db.eventPaymentProof.updateMany({ where: { ticketId: { in: ids }, outcome: null }, data: { outcome: 'removed', outcomeAt: new Date() } });
        for (const pid of ids) await logTicket(this.db, { id: pid, organizationId: t.organizationId }, 'removed', ctx(req).user.name || ctx(req).user.email, ids.length > 1 ? `Bulk booking: all ${ids.length} spots` : null);
      }
    }
    if (!count) throw new ApiError(409, { error: 'not_pending', message: 'Only a code that hasn’t been used yet, or a registration whose payment isn’t confirmed, can be deleted.' });
    this.live.emit({ eventId: id, type: 'code_deleted' });
    return { ok: true };
  }

  @Post(':id/tickets/:tid/revoke')
  @HttpCode(200)
  @ClientRoute(EVENT_ROUTES.attendees)
  async revoke(@Req() req: Request, @Param('id', ParseIntPipe) id: number, @Param('tid', ParseIntPipe) tid: number, @Body(new YupValidationPipe(revokeSchema)) body: yup.InferType<typeof revokeSchema>) {
    const c = ctx(req);
    const e = await this.event(c.org.id, id);
    if (e.kind !== 'free') throw new ApiError(409, { error: 'paid_event', message: 'Registrations for paid events can’t be revoked here.' });
    const t = await this.db.eventTicket.findFirst({ where: { id: tid, eventId: id, status: 'confirmed' } });
    if (!t) throw new ApiError(404, { error: 'not_found', message: 'That registration is not active.' });
    const ids = body.scope === 'spot' ? [tid] : (await bookingSpots(this.db, t, ['confirmed'])).map((x) => x.id);
    await this.db.eventTicket.updateMany({ where: { id: { in: ids }, status: 'confirmed' }, data: { status: 'revoked', revokedAt: new Date(), revokeReason: body.reason ?? null } });
    const updated = await this.db.eventTicket.findUniqueOrThrow({ where: { id: tid } });
    await this.mails.revoked(e, updated, body.reason ?? null, ids.length);
    this.live.emit({ eventId: id, type: 'revoked', name: updated.name });
    for (const pid of ids) await logTicket(this.db, { id: pid, organizationId: updated.organizationId }, 'revoked', c.user.name || c.user.email, [ids.length > 1 ? `Bulk booking: all ${ids.length} spots` : null, body.reason ?? null].filter(Boolean).join(' · ') || null);
    logger.info({ org: c.org.id, eventId: id, ticketId: tid, places: ids.length }, 'Event registration revoked');
    return { ...ticketRow(updated), places: ids.length };
  }

  /**
   * Check-in at this event only. Codes of other events or of appointments are refused. Another
   * day than the event's, a revoked registration or an unused paid code are reported; `force`
   * checks in anyway (not revoked ones, not other events').
   */
  @Post(':id/check-in')
  @HttpCode(200)
  @ClientRoute(EVENT_ROUTES.attendees)
  async checkIn(@Req() req: Request, @Param('id', ParseIntPipe) id: number, @Body(new YupValidationPipe(checkInSchema)) body: yup.InferType<typeof checkInSchema>) {
    const c = ctx(req);
    await this.event(c.org.id, id);
    return this.checkIns.checkIn(c.org.id, id, body, { userId: c.user.id, by: c.user.name || c.user.email });
  }

  @Post(':id/tickets/:tid/check-in/undo')
  @HttpCode(200)
  @ClientRoute(EVENT_ROUTES.attendees)
  async undoCheckIn(@Req() req: Request, @Param('id', ParseIntPipe) id: number, @Param('tid', ParseIntPipe) tid: number) {
    return this.checkIns.undo(ctx(req).org.id, id, tid, ctx(req).user.name || ctx(req).user.email);
  }
}

// ---- The public side ----

/** The business behind a public link, if it takes registrations (active account and plan). */
export async function publicBusiness(db: ClientsDb, slug: string) {
  if (!SLUG_RE.test(slug)) throw new ApiError(404, { error: 'not_found', message: 'That page does not exist.' });
  const s = await db.bookingSettings.findUnique({ where: { slug } });
  if (!s) throw new ApiError(404, { error: 'not_found', message: 'That page does not exist.' });
  const ents = await loadEntitlements(db, s.organizationId);
  const sub = await db.subscription.findUnique({ where: { organizationId: s.organizationId }, select: { status: true } });
  const open = (await orgStatus(db, s.organizationId)) === 'active' && sub?.status === 'active' && ents.apps.includes('bookings');
  return { s, ents, open };
}

/** A published event of an open business (404 otherwise). */
export async function publicEvent(db: ClientsDb, slug: string, eventSlug: string) {
  const b = await publicBusiness(db, slug);
  const e = b.open ? await db.event.findFirst({ where: { organizationId: b.s.organizationId, slug: eventSlug.toLowerCase(), published: true } }) : null;
  if (!e) throw new ApiError(404, { error: 'not_found', message: 'This event is not available.' });
  return { ...b, e };
}

/** The registration behind an attendee's private link ("{id}.{nonce}"), if the token is right. */
export async function ticketByToken(db: ClientsDb, e: { id: number }, token: unknown) {
  const m = typeof token === 'string' ? /^(\d+)\.([0-9a-f]{32})$/.exec(token) : null;
  const t = m ? await db.eventTicket.findFirst({ where: { id: Number(m[1]), eventId: e.id } }) : null;
  if (!t || !sameSecret(t.manageNonce, m![2])) throw new ApiError(404, { error: 'bad_link', message: 'This link isn’t valid. Please use the link in your latest email.' });
  return t;
}

@Controller('public/bookings/:slug/events')
export class PublicEventsController {
  constructor(
    private readonly db: ClientsDb,
    private readonly mails: EventMails,
    private readonly live: EventLive,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  private business(slug: string) {
    return publicBusiness(this.db, slug);
  }

  private event(slug: string, eventSlug: string) {
    return publicEvent(this.db, slug, eventSlug);
  }

  private pageOf(s: { slug: string; businessName: string; timeZone: string; phone: string | null; primaryColor: string; accentColor: string | null; backgroundColor: string | null; theme: string; font: string; buttonStyle: string }, full: boolean) {
    return {
      business: { name: s.businessName, slug: s.slug, timeZone: s.timeZone, phone: s.phone },
      branding: {
        primaryColor: s.primaryColor,
        accentColor: full ? s.accentColor : null,
        backgroundColor: full ? s.backgroundColor : null,
        theme: full ? s.theme : 'light',
        font: full ? s.font : 'system',
        buttonStyle: full ? s.buttonStyle : 'rounded',
        poweredBy: !full,
      },
    };
  }

  @Get()
  @Header('Cache-Control', 'no-store')
  async list(@Param('slug') slug: string) {
    const { s, open } = await this.business(slug);
    if (!open) return { events: [] };
    const events = await this.db.event.findMany({ where: { organizationId: s.organizationId, published: true, endsAt: { gt: new Date() } }, orderBy: { startsAt: 'asc' }, take: 20 });
    return { events: events.map((e) => ({ slug: e.slug, title: e.title, kind: e.kind, priceLabel: e.priceLabel, startsAt: e.startsAt, endsAt: e.endsAt, format: e.format })) };
  }

  @Get(':event')
  @Header('Cache-Control', 'no-store')
  async page(@Param('slug') slug: string, @Param('event') eventSlug: string) {
    const { s, ents, e } = await this.event(slug, eventSlug);
    const used = await taken(this.db, e.id);
    // Paid: people on the waitlist get the next freed places, before anyone new.
    const queue = e.kind === 'paid' ? await waiting(this.db, e.id) : 0;
    const spotsLeft = e.capacity === null ? null : Math.max(0, e.capacity - used - queue);
    // Full, but some places aren't verified yet (they may be freed): one more can join the waitlist.
    const unverified = e.kind === 'paid' && spotsLeft === 0 ? await this.db.eventTicket.count({ where: { eventId: e.id, status: { in: UNVERIFIED_STATUSES } } }) : 0;
    const status = e.endsAt <= new Date() ? 'over' : spotsLeft === 0 ? (unverified || queue ? 'waitlist' : 'full') : 'open';
    const row = eventRow(e, s.timeZone);
    const channels = e.kind === 'paid' ? await this.db.eventPaymentChannel.findMany({ where: { eventId: e.id }, orderBy: [{ position: 'asc' }, { id: 'asc' }] }) : [];
    return {
      ...this.pageOf(s, hasFeature(ents, 'bookings.full_branding')),
      status,
      event: { ...row, meetingUrl: undefined, hasLink: !!e.meetingUrl, spotsLeft },
      paymentChannels: channels.map(channelRow),
    };
  }

  @Post(':event/register')
  @StrictRateLimit()
  async register(@Param('slug') slug: string, @Param('event') eventSlug: string, @Body(new YupValidationPipe(registerSchema)) body: yup.InferType<typeof registerSchema>) {
    const { e } = await this.event(slug, eventSlug);
    if (e.kind !== 'free') throw new ApiError(409, { error: 'paid_event', message: 'This is a paid event. Please register with your proof of payment, or the code you received from the organizer.' });
    if (e.endsAt <= new Date()) throw new ApiError(409, { error: 'over', message: 'This event is over.' });
    const quantity = body.quantity ?? 1;
    try {
      const tickets = await this.db.$transaction(async (tx) => {
        // Checked with the event locked: two bookings at once can't overbook it.
        await tx.$queryRaw`SELECT "id" FROM "booking"."events" WHERE "id" = ${e.id} FOR UPDATE`;
        if (e.capacity !== null) {
          const left = Math.max(0, e.capacity - (await taken(tx, e.id)));
          if (quantity > left) throw new ApiError(409, { error: left ? 'not_enough_places' : 'full', message: left ? `Only ${left} spot${left === 1 ? '' : 's'} left.` : 'Sorry, the event is full.', fields: { quantity: left ? `At most ${left}.` : 'The event is full.' } });
        }
        const groupId = quantity > 1 ? randomUUID() : null;
        const made = [];
        for (let i = 0; i < quantity; i++) {
          made.push(
            await tx.eventTicket.create({
              data: { eventId: e.id, organizationId: e.organizationId, name: `${body.firstName} ${body.lastName}`, email: body.email, phone: body.phone, code: await freeCode(tx, e.organizationId), status: 'confirmed', confirmedAt: new Date(), ...(groupId ? { groupId, groupSize: quantity } : {}) },
            }),
          );
        }
        return made;
      });
      const t = tickets[0];
      await this.mails.bulkConfirmation(e, tickets);
      this.live.emit({ eventId: e.id, type: 'registered', name: quantity > 1 ? `${t.name} (${quantity} spots)` : t.name });
      for (const [i, x] of tickets.entries()) await logTicket(this.db, x, 'registered', ATTENDEE, quantity > 1 ? `On the event page · bulk booking: spot ${i + 1} of ${quantity}` : 'On the event page');
      logger.info({ eventId: e.id, ticketId: t.id, places: quantity }, 'Event registration');
      return { ...this.confirmed(t, e), places: tickets.map((x) => this.confirmed(x, e).checkIn), count: quantity };
    } catch (err) {
      if (isUniqueClash(err)) throw alreadyRegistered();
      throw err;
    }
  }

  /**
   * Every QR code of a booking in one PDF (bulk bookings: all its places), from the private link
   * (?t={registration token} of one of its places). Confirmed places only.
   */
  @Get(':event/qr-codes.pdf')
  @Header('Cache-Control', 'no-store')
  async qrCodesPdf(@Param('slug') slug: string, @Param('event') eventSlug: string, @Query('t') token: string | undefined, @Res() res: Response) {
    const { e } = await this.event(slug, eventSlug);
    const t = await this.byToken(e, token);
    if (e.format === 'online') throw new ApiError(404, { error: 'online', message: 'Online events have no QR codes.' });
    const places = t.groupId ? await this.db.eventTicket.findMany({ where: { groupId: t.groupId, status: 'confirmed' }, orderBy: { id: 'asc' } }) : t.status === 'confirmed' ? [t] : [];
    if (!places.length) throw new ApiError(409, { error: 'not_confirmed', message: 'Your registration isn’t confirmed yet: the QR codes come once it is.' });
    const s = await this.db.bookingSettings.findUnique({ where: { organizationId: e.organizationId }, select: { timeZone: true } });
    const f = formatInZone(e.startsAt, zoneOf(e, s?.timeZone ?? 'UTC'));
    const pdf = await qrPdf(this.cfg.clients.bookingsUrl, places.map((x, i) => ({ code: formatCheckInCode(x.code), raw: x.code!, label: `Spot ${i + 1} · ${x.name}` })), { title: e.title, sub: `${f.date}, ${f.time} (${f.zone})` });
    res.status(200).set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${e.slug}-qr-codes.pdf"` }).send(pdf);
  }

  @Post(':event/claim')
  @HttpCode(200)
  @StrictRateLimit()
  async claim(@Param('slug') slug: string, @Param('event') eventSlug: string, @Body(new YupValidationPipe(claimSchema)) body: yup.InferType<typeof claimSchema>) {
    const { e } = await this.event(slug, eventSlug);
    if (e.kind !== 'paid') throw new ApiError(409, { error: 'free_event', message: 'This event is free: just fill in your details.' });
    const code = parseCheckInCode(body.code);
    const t = code ? await this.db.eventTicket.findFirst({ where: { eventId: e.id, code } }) : null;
    if (!t || t.status === 'revoked') throw new ApiError(404, { error: 'bad_code', message: 'This code doesn’t match this event. Please check it, or contact the organizer.', fields: { code: 'Please check the code.' } });
    if (t.status === 'pending') {
      const updated = await this.db.eventTicket.update({ where: { id: t.id }, data: { status: 'confirmed', confirmedAt: new Date(), ...paidData(e, 'code') } });
      await this.mails.confirmation(e, updated);
      this.live.emit({ eventId: e.id, type: 'registered', name: updated.name });
      await logTicket(this.db, updated, 'code_used', ATTENDEE, 'Registered with the organizer’s code');
      logger.info({ eventId: e.id, ticketId: t.id }, 'Event code used');
      return { ...this.confirmed(updated, e), first: true };
    }
    // Already confirmed: show it again (and send the email again), so a lost email isn't a problem.
    await this.mails.confirmation(e, t);
    return { ...this.confirmed(t, e), first: false };
  }

  private byToken(e: EventRow, token: unknown) {
    return ticketByToken(this.db, e, token);
  }

  @Get(':event/registration')
  @Header('Cache-Control', 'no-store')
  async registration(@Req() req: Request, @Param('slug') slug: string, @Param('event') eventSlug: string) {
    const { e } = await this.event(slug, eventSlug);
    const t = await this.byToken(e, req.headers['x-registration-token']);
    // A bulk booking is cancelled as a whole: the spots not checked in yet.
    const spots = t.groupId ? await this.db.eventTicket.count({ where: { groupId: t.groupId, status: 'confirmed', checkedInAt: null } }) : 1;
    return {
      name: t.name,
      email: t.email,
      status: t.status,
      spots,
      paymentNote: t.paymentNote,
      reuploadBy: t.reuploadBy,
      checkedIn: !!t.checkedInAt,
      // The ticket (QR code), for the "view in browser / download" links in the confirmation email.
      checkIn: t.status === 'confirmed' && e.format !== 'online' ? { code: formatCheckInCode(t.code), url: checkInUrl(this.cfg.clients.bookingsUrl, t.code!) } : null,
      canCancel: e.kind === 'free' && (t.groupId ? spots > 0 : t.status === 'confirmed' && !t.checkedInAt) && e.endsAt > new Date() };
  }

  /** Free events only: the attendee cancels (any time before the event ends, unless checked in). */
  @Post(':event/cancel')
  @HttpCode(200)
  @StrictRateLimit()
  async cancel(@Param('slug') slug: string, @Param('event') eventSlug: string, @Body(new YupValidationPipe(cancelSchema)) body: yup.InferType<typeof cancelSchema>) {
    const { e } = await this.event(slug, eventSlug);
    if (e.kind !== 'free') throw new ApiError(409, { error: 'paid_event', message: 'Registrations for paid events can’t be cancelled. Please contact the organizer.' });
    const t = await this.byToken(e, body.token);
    if (t.status === 'cancelled') return { ok: true, already: true };
    if (t.status !== 'confirmed') throw new ApiError(409, { error: 'not_active', message: 'This registration isn’t active.' });
    // A bulk booking is cancelled as a whole (the spots not checked in yet).
    const ids = (await bookingSpots(this.db, t, ['confirmed'])).filter((x) => !x.checkedInAt).map((x) => x.id);
    if (!ids.length) throw new ApiError(409, { error: 'checked_in', message: 'You’ve already checked in at this event.' });
    if (e.endsAt <= new Date()) throw new ApiError(409, { error: 'over', message: 'This event is over.' });
    await this.db.eventTicket.updateMany({ where: { id: { in: ids }, status: 'confirmed', checkedInAt: null }, data: { status: 'cancelled', cancelledAt: new Date() } });
    const updated = await this.db.eventTicket.findUniqueOrThrow({ where: { id: ids.includes(t.id) ? t.id : ids[0] } });
    await this.mails.cancelled(e, updated, ids.length);
    this.live.emit({ eventId: e.id, type: 'cancelled', name: updated.name });
    for (const pid of ids) await logTicket(this.db, { id: pid, organizationId: updated.organizationId }, 'cancelled', ATTENDEE, ids.length > 1 ? `Bulk booking: ${ids.length} spots` : null);
    logger.info({ eventId: e.id, ticketId: t.id, places: ids.length }, 'Event registration cancelled by the attendee');
    return { ok: true, already: false };
  }

  /** What the attendee sees after registering: the QR code for onsite events, nothing to scan online. */
  private confirmed(t: TicketRow, e: { format: string }) {
    return {
      name: t.name,
      email: t.email,
      online: e.format === 'online',
      checkIn: e.format === 'online' ? null : { code: formatCheckInCode(t.code), url: checkInUrl(this.cfg.clients.bookingsUrl, t.code!) },
      cancelToken: registrationToken(t),
    };
  }
}
