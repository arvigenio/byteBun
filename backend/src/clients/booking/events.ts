// Events: one-time seminars, webinars and classes, on a public page (/{business}/e/{event}).
//
//   free  anyone registers on the page: confirmed straight away, QR code on screen and by email
//   paid  no payment gateway yet: the business takes the payment itself, enters the attendee and
//         gets an 8-character code to give them; the attendee registers with the code, and gets
//         the QR code by email once it's confirmed
//
// No rescheduling. Free events: attendees can cancel their own registration any time before the
// event ends, with the private link in their email; paid events can't be cancelled. The business
// can revoke free registrations (the attendee is emailed) and delete unused paid codes. Online events may get their link later:
// adding or changing it emails every confirmed attendee.
// Check-in is per event: the event's scanner only accepts that event's codes.
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
//   POST   /api/client/bookings/events/:id/delete-code       emails a 6-digit code to the person asking
//   POST   /api/client/bookings/events/:id/delete            { code, notifyAttendees }: the whole event goes
//   POST   /api/client/bookings/events/:id/tickets           paid: issue a code { name, email, phone }
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
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';
import { Body, Controller, Delete, Get, Header, HttpCode, Inject, Injectable, Param, ParseIntPipe, Patch, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Subject } from 'rxjs';
import * as yup from 'yup';
import { ADMINS } from '../../auth/admins';
import { MAILER } from '../../auth/auth.module';
import type { Mailer } from '../../auth/mailer';
import { ApiError } from '../../common/api-error';
import { xlsx } from '../../common/xlsx';
import { StrictRateLimit } from '../../common/rate-limit';
import { YupValidationPipe } from '../../common/yup-validation.pipe';
import { APP_CONFIG, type AppConfig } from '../../config/config';
import { logger } from '../../logging/logger';
import { calendarFor, cleanInstructions, eventCancelledByBusinessMail, eventCancelledMail, eventCheckedInMail, eventConfirmationMail, eventDeleteCodeMail, eventLinkMail, eventRevokedMail, type EventView } from '../client-emails';
import { ClientsDb, type ClientsTx } from '../clients-db';
import { ClientRoute, orgStatus, type ClientContext } from '../client-context';
import { hasFeature, limitOf, loadEntitlements } from '../entitlements';
import { checkInQrPng, checkInUrl, formatCheckInCode, newCheckInCode, parseCheckInCode } from './check-in';
import { csvCell } from './csv';
import { SLUG_RE } from './schemas';
import { addDays, formatInZone, fromLocal, isDate, toLocal, todayIn } from './time';

const MANAGE = { app: 'bookings', permission: 'bookings.manage' } as const;
const SETTINGS = { app: 'bookings', permission: 'bookings.settings' } as const;
const ctx = (req: Request) => req.client as ClientContext;
type Db = ClientsDb | ClientsTx;

// ---- Validation ----

const optionalText = (max: number) => yup.string().trim().max(max, `At most ${max} characters.`).nullable().transform((v) => (v === '' ? null : v));
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
  priceLabel: optionalText(60),
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
  /** The registration button's text (default: "Register for free" / "Confirm my place"). */
  registerLabel: optionalText(40),
  /** A bigger event (more than the plan's participants): the voucher from Byte Bun. */
  voucherCode: yup.string().trim().max(40).nullable(),
  /** Events without a voucher: the business agrees they're deleted 3 months after they end. */
  retentionAgreed: yup.boolean(),
});
const eventPatchSchema = eventSchema.partial();
const attendeeSchema = yup.object({
  name: yup.string().trim().min(2, 'Please enter the name.').max(120).required('Please enter the name.'),
  email: email().required('Please enter the email address.'),
  phone: optionalText(40),
});
/** At least 7 digits; spaces, dashes, dots, brackets and a leading + are fine. */
const phone = () =>
  yup
    .string()
    .trim()
    .max(40, 'At most 40 characters.')
    .required('Please enter your phone number.')
    .test('phone', 'Please enter a valid phone number.', (v) => !v || (/^\+?[\d\s().-]+$/.test(v) && v.replace(/\D/g, '').length >= 7));
/** The public registration form: first and last name, email and phone (all required). */
const registerSchema = yup.object({
  firstName: yup.string().trim().min(1, 'Please enter your first name.').max(60).required('Please enter your first name.'),
  lastName: yup.string().trim().min(1, 'Please enter your last name.').max(60).required('Please enter your last name.'),
  email: email().required('Please enter your email address.'),
  phone: phone(),
});
const revokeSchema = yup.object({ reason: optionalText(500) });
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

/** Places taken: confirmed registrations and unused paid codes. */
const taken = (db: Db, eventId: number) => db.eventTicket.count({ where: { eventId, status: { in: ['confirmed', 'pending'] } } });

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

function eventRow(e: EventRow, businessTz: string, counts?: { confirmed: number; pending: number; checkedIn: number; revoked: number }) {
  const tz = zoneOf(e, businessTz);
  const start = toLocal(e.startsAt, tz);
  const end = toLocal(e.endsAt, tz);
  return {
    id: e.id,
    slug: e.slug,
    title: e.title,
    description: e.description,
    kind: e.kind,
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
    retention: retentionOf(e, businessTz),
    ...(counts ? { counts } : {}),
  };
}

/** The attendee's private cancel link token: "{ticket id}.{nonce}". */
const registrationToken = (t: { id: number; manageNonce: string }) => `${t.id}.${t.manageNonce}`;
const sameSecret = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

const ticketRow = (t: TicketRow) => ({
  id: t.id,
  name: t.name,
  email: t.email,
  phone: t.phone,
  code: formatCheckInCode(t.code),
  status: t.status,
  source: t.source,
  confirmedAt: t.confirmedAt,
  revokedAt: t.revokedAt,
  revokeReason: t.revokeReason,
  cancelledAt: t.cancelledAt,
  checkedInAt: t.checkedInAt,
  createdAt: t.createdAt,
});

const isLive = (status: string) => status === 'confirmed' || status === 'pending';
const isUniqueClash = (err: unknown) => (err as { code?: string })?.code === 'P2002';
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
      checkIn: e.format === 'online' ? null : { code: formatCheckInCode(t.code), qrPng: await checkInQrPng(checkInUrl(this.cfg.clients.bookingsUrl, t.code)) },
      cancelUrl: e.kind === 'free' ? `${pageUrl}#cancel=${registrationToken(t)}` : null,
    };
  }

  async confirmation(e: EventRow, t: TicketRow) {
    const v = await this.view(e, t);
    if (v) this.mailer.sendInBackground(eventConfirmationMail(this.cfg, v));
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

  async cancelled(e: EventRow, t: TicketRow) {
    const v = await this.view(e, t);
    if (v) this.mailer.sendInBackground(eventCancelledMail(this.cfg, v));
  }

  async revoked(e: EventRow, t: TicketRow, reason: string | null) {
    const v = await this.view(e, t);
    if (v) this.mailer.sendInBackground(eventRevokedMail(this.cfg, v, reason));
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
  type: 'checked_in' | 'check_in_undone' | 'registered' | 'revoked' | 'cancelled' | 'code_deleted' | 'scanner' | 'claimed' | 'claim_undone';
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
    let state = t.status === 'revoked' ? 'revoked' : t.status === 'cancelled' ? 'cancelled' : t.checkedInAt ? 'already' : t.status === 'pending' ? 'unclaimed' : eventDay !== today ? (eventDay > today ? 'early' : 'over') : 'ok';
    let row = t;
    let checkedIn = false;
    if (state === 'ok' || (body.force && ['early', 'over', 'unclaimed'].includes(state))) {
      const now = new Date();
      const { count } = await this.db.eventTicket.updateMany({
        where: { id: t.id, checkedInAt: null, status: { in: ['confirmed', 'pending'] } },
        data: { checkedInAt: now, checkedInBy: who.userId, ...(t.status === 'pending' ? { status: 'confirmed', confirmedAt: now } : {}) },
      });
      row = await this.db.eventTicket.findUniqueOrThrow({ where: { id: t.id }, include: { event: true } });
      if (count) {
        checkedIn = true;
        await this.mails.checkedIn(e, row);
        this.live.emit({ eventId, type: 'checked_in', name: row.name, by: who.by });
        logger.info({ org: orgId, eventId, ticketId: t.id, state, by: who.by }, 'Event attendee checked in');
      } else state = 'already';
    }
    return { state, checkedIn, today, eventDate: eventDay, ticket: ticketRow(row) };
  }

  async undo(orgId: string, eventId: number, ticketId: number) {
    const t = await this.db.eventTicket.findFirst({ where: { id: ticketId, eventId, organizationId: orgId } });
    if (!t) throw new ApiError(404, { error: 'not_found', message: 'That registration does not exist.' });
    await this.db.eventTicket.update({ where: { id: ticketId }, data: { checkedInAt: null, checkedInBy: null } });
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
  const [tickets, claimables, scanners, settings] = await Promise.all([
    db.eventTicket.findMany({ where: { eventId: id }, orderBy: { createdAt: 'asc' }, include: { claims: true } }),
    db.eventClaimable.findMany({ where: { eventId: id }, orderBy: [{ position: 'asc' }, { id: 'asc' }] }),
    db.eventScanner.findMany({ where: { eventId: id }, orderBy: { createdAt: 'asc' }, include: { claimable: true } }),
    db.bookingSettings.findUnique({ where: { organizationId: orgId }, select: { businessName: true } }),
  ]);
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
  const STATUS: Record<string, string> = { confirmed: 'Registered', pending: 'Code not used yet', revoked: 'Revoked', cancelled: 'Cancelled by attendee' };
  const row = eventRow(e, businessTz);
  const count = (f: (t: (typeof tickets)[number]) => boolean) => tickets.filter(f).length;
  const totals = {
    registered: count((t) => t.status === 'confirmed'),
    codesNotUsed: count((t) => t.status === 'pending'),
    cancelledOrRevoked: count((t) => t.status === 'cancelled' || t.status === 'revoked'),
    checkedIn: count((t) => !!t.checkedInAt),
  };
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
      totals,
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
      claims: t.claims.map((c) => ({ item: claimables.find((k) => k.id === c.claimableId)?.name ?? null, claimedAt: c.claimedAt.toISOString(), claimedBy: c.claimedBy })),
    })),
    claimables: claimables.map((k) => ({
      name: k.name,
      claimed: claims.filter((x) => x.k.id === k.id).length,
      notClaimed: tickets.filter((t) => t.status === 'confirmed' && !t.claims.some((c) => c.claimableId === k.id)).length,
      scanners: scanners.filter((s) => s.claimableId === k.id).map((s) => `${s.firstName} ${s.lastName}`),
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
    ['Cancelled or revoked', totals.cancelledOrRevoked],
    ['Checked in', totals.checkedIn],
    ...json.claimables.map((k) => [`Claimed: ${k.name}`, k.claimed]),
    [],
    ['Exported at', at(new Date())],
  ];
  const attendees = [
    ['Name', 'Email', 'Phone', 'Code', 'Status', 'Source', 'Registered at', 'Checked in at', 'Checked in by', ...claimables.map((k) => k.name)],
    ...tickets.map((t) => [
      t.name,
      t.email,
      t.phone ?? '',
      formatCheckInCode(t.code),
      STATUS[t.status] ?? t.status,
      t.source === 'business' ? 'Code from the business' : 'Event page',
      at(t.confirmedAt ?? t.createdAt),
      at(t.checkedInAt),
      scannerName(t.checkedInBy),
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
  return { file: `${e.slug}-${row.date}`, json, details, attendees, claims: claimRows, scanners: scannerRows };
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
  @ClientRoute(SETTINGS)
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
  @ClientRoute(MANAGE)
  async list(@Req() req: Request) {
    const c = ctx(req);
    const tz = await this.tz(c.org.id);
    const events = await this.db.event.findMany({ where: { organizationId: c.org.id }, orderBy: { startsAt: 'desc' }, take: 200 });
    const groups = await this.db.eventTicket.groupBy({ by: ['eventId', 'status'], where: { organizationId: c.org.id }, _count: { _all: true } });
    const checked = await this.db.eventTicket.groupBy({ by: ['eventId'], where: { organizationId: c.org.id, checkedInAt: { not: null } }, _count: { _all: true } });
    const count = (id: number, status: string) => groups.find((g) => g.eventId === id && g.status === status)?._count._all ?? 0;
    return events.map((e) =>
      eventRow(e, tz, { confirmed: count(e.id, 'confirmed'), pending: count(e.id, 'pending'), revoked: count(e.id, 'revoked'), checkedIn: checked.find((g) => g.eventId === e.id)?._count._all ?? 0 }),
    );
  }

  @Post()
  @ClientRoute(SETTINGS)
  async create(@Req() req: Request, @Body(new YupValidationPipe(eventSchema)) body: yup.InferType<typeof eventSchema>) {
    const c = ctx(req);
    const tz = await this.tz(c.org.id);
    const data = this.fields(body, tz);
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
        return created;
      });
      logger.info({ org: c.org.id, eventId: e.id }, 'Event created');
      return eventRow(e, tz);
    } catch (err) {
      if (isUniqueClash(err)) throw new ApiError(409, { error: 'slug_taken', message: 'Another event already uses this link.', fields: { slug: 'Already used by another event.' } });
      throw err;
    }
  }

  /** Form fields -> columns (the date and times are in the event's time zone). */
  private fields(body: Partial<yup.InferType<typeof eventSchema>>, businessTz: string, current?: EventRow) {
    const tz = body.timeZone || (current ? zoneOf(current, businessTz) : businessTz);
    const data: Record<string, unknown> = {};
    for (const k of ['title', 'slug', 'kind', 'priceLabel', 'format', 'address', 'addressDetails', 'latitude', 'longitude', 'meetingUrl', 'capacity', 'registerLabel'] as const) if (body[k] !== undefined) data[k] = body[k] ?? null;
    if (body.published !== undefined) data.published = body.published;
    else if (!current) data.published = false;
    if (body.description !== undefined) data.description = cleanInstructions(body.description ?? null);
    if (data.kind === 'free') data.priceLabel = null;
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
  @ClientRoute(MANAGE)
  async get(@Req() req: Request, @Param('id', ParseIntPipe) id: number) {
    const c = ctx(req);
    const tz = await this.tz(c.org.id);
    const e = await this.event(c.org.id, id);
    const tickets = await this.db.eventTicket.findMany({ where: { eventId: id }, orderBy: { createdAt: 'desc' }, include: { claims: { select: { claimableId: true, claimedAt: true } } } });
    const claimables = await this.db.eventClaimable.findMany({ where: { eventId: id }, orderBy: [{ position: 'asc' }, { id: 'asc' }], select: { id: true, name: true } });
    const l = await this.limits(c.org.id);
    return {
      event: eventRow(e, tz),
      claimables,
      tickets: tickets.map((t) => ({ ...ticketRow(t), claims: t.claims })),
      taken: tickets.filter((t) => isLive(t.status)).length,
      limits: { participants: participantCap(e, l.participants), perDay: l.perDay, planName: l.planName, sizes: EVENT_SIZES },
    };
  }

  @Patch(':id')
  @ClientRoute(SETTINGS)
  async update(@Req() req: Request, @Param('id', ParseIntPipe) id: number, @Body(new YupValidationPipe(eventPatchSchema)) body: yup.InferType<typeof eventPatchSchema>) {
    const c = ctx(req);
    const tz = await this.tz(c.org.id);
    const before = await this.event(c.org.id, id);
    if (body.kind && body.kind !== before.kind && (await this.db.eventTicket.count({ where: { eventId: id } }))) {
      throw new ApiError(409, { error: 'has_registrations', message: 'People are already registered, so the event can’t switch between free and paid.', fields: { kind: 'Fixed once people register.' } });
    }
    const data = this.fields(body, tz, before);
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
  @ClientRoute(MANAGE)
  async exportXlsx(@Req() req: Request, @Param('id', ParseIntPipe) id: number, @Res() res: Response) {
    const d = await eventExportData(this.db, ctx(req).org.id, id);
    const body = xlsx([
      { name: 'Details', rows: d.details },
      { name: 'Attendees', rows: d.attendees, header: true },
      { name: 'Claimables', rows: d.claims, header: true },
      { name: 'Scanners', rows: d.scanners, header: true },
    ]);
    res
      .status(200)
      .set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${d.file}.xlsx"` })
      .send(body);
  }

  @Get(':id/export.csv')
  @Header('Cache-Control', 'no-store')
  @ClientRoute(MANAGE)
  async exportCsv(@Req() req: Request, @Param('id', ParseIntPipe) id: number, @Res() res: Response) {
    const d = await eventExportData(this.db, ctx(req).org.id, id);
    // Excel opens it as UTF-8 thanks to the BOM; formula-looking cells are neutralized.
    const csv = '﻿' + d.attendees.map((r) => r.map((v) => csvCell(String(v ?? ''))).join(',')).join('\r\n') + '\r\n';
    res.status(200).set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${d.file}.csv"` }).send(csv);
  }

  @Get(':id/export.json')
  @Header('Cache-Control', 'no-store')
  @ClientRoute(MANAGE)
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
  @ClientRoute(SETTINGS)
  async requestDelete(@Req() req: Request, @Param('id', ParseIntPipe) id: number) {
    const c = ctx(req);
    const e = await this.event(c.org.id, id);
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    await this.db.event.update({ where: { id }, data: { deleteCodeHash: sha256(`${id}:${code}`), deleteCodeExpiresAt: new Date(Date.now() + DELETE_CODE_MINUTES * 60_000), deleteCodeUserId: c.user.id, deleteCodeAttempts: 0 } });
    const registrations = await this.db.eventTicket.count({ where: { eventId: id, status: { in: ['confirmed', 'pending'] } } });
    this.mailer.sendInBackground(eventDeleteCodeMail(this.mails.cfgFor(), { to: c.user.email, name: c.user.name || c.user.email, businessName: c.org.name, eventTitle: e.title, code, minutes: DELETE_CODE_MINUTES, registrations }));
    logger.info({ org: c.org.id, eventId: id }, 'Event delete code sent');
    return { sentTo: c.user.email, registrations, minutes: DELETE_CODE_MINUTES };
  }

  /** Step 2: with the emailed code, the whole event goes (registrations, scanners, claimables, claims). */
  @Post(':id/delete')
  @HttpCode(200)
  @ClientRoute(SETTINGS)
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
    await this.db.$transaction([this.db.eventVoucher.updateMany({ where: { eventId: id }, data: { eventId: null } }), this.db.event.delete({ where: { id } })]);
    this.live.emit({ eventId: id, type: 'scanner' });
    logger.info({ org: c.org.id, eventId: id, notified: attendees.length }, 'Event deleted');
    return { ok: true, notified: e.endsAt > new Date() ? attendees.length : 0 };
  }

  /** "We need more places": emails Byte Bun, who invoices it and raises the event's limit. */
  @Post(':id/upgrade-request')
  @HttpCode(200)
  @ClientRoute(SETTINGS)
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
  @ClientRoute(MANAGE)
  async issue(@Req() req: Request, @Param('id', ParseIntPipe) id: number, @Body(new YupValidationPipe(attendeeSchema)) body: yup.InferType<typeof attendeeSchema>) {
    const c = ctx(req);
    const e = await this.event(c.org.id, id);
    if (e.kind !== 'paid') throw new ApiError(409, { error: 'free_event', message: 'Codes are for paid events. People register for free events on the event page.' });
    try {
      const t = await this.db.$transaction(async (tx) => {
        if (e.capacity !== null && (await taken(tx, id)) >= e.capacity) throw new ApiError(409, { error: 'full', message: `The event is full (${e.capacity} places). Raise the capacity to add more.` });
        return tx.eventTicket.create({ data: { eventId: id, organizationId: c.org.id, name: body.name, email: body.email, phone: body.phone ?? null, code: await freeCode(tx, c.org.id), status: 'pending', source: 'business' } });
      });
      logger.info({ org: c.org.id, eventId: id, ticketId: t.id }, 'Event code issued');
      return ticketRow(t);
    } catch (err) {
      if (isUniqueClash(err)) throw alreadyRegistered();
      throw err;
    }
  }

  @Delete(':id/tickets/:tid')
  @ClientRoute(MANAGE)
  async deleteCode(@Req() req: Request, @Param('id', ParseIntPipe) id: number, @Param('tid', ParseIntPipe) tid: number) {
    const { count } = await this.db.eventTicket.deleteMany({ where: { id: tid, eventId: id, organizationId: ctx(req).org.id, status: 'pending' } });
    if (!count) throw new ApiError(409, { error: 'not_pending', message: 'Only a code that hasn’t been used yet can be deleted.' });
    this.live.emit({ eventId: id, type: 'code_deleted' });
    return { ok: true };
  }

  @Post(':id/tickets/:tid/revoke')
  @HttpCode(200)
  @ClientRoute(MANAGE)
  async revoke(@Req() req: Request, @Param('id', ParseIntPipe) id: number, @Param('tid', ParseIntPipe) tid: number, @Body(new YupValidationPipe(revokeSchema)) body: yup.InferType<typeof revokeSchema>) {
    const c = ctx(req);
    const e = await this.event(c.org.id, id);
    if (e.kind !== 'free') throw new ApiError(409, { error: 'paid_event', message: 'Registrations for paid events can’t be revoked here.' });
    const t = await this.db.eventTicket.findFirst({ where: { id: tid, eventId: id, status: 'confirmed' } });
    if (!t) throw new ApiError(404, { error: 'not_found', message: 'That registration is not active.' });
    const updated = await this.db.eventTicket.update({ where: { id: tid }, data: { status: 'revoked', revokedAt: new Date(), revokeReason: body.reason ?? null } });
    await this.mails.revoked(e, updated, body.reason ?? null);
    this.live.emit({ eventId: id, type: 'revoked', name: updated.name });
    logger.info({ org: c.org.id, eventId: id, ticketId: tid }, 'Event registration revoked');
    return ticketRow(updated);
  }

  /**
   * Check-in at this event only. Codes of other events or of appointments are refused. Another
   * day than the event's, a revoked registration or an unused paid code are reported; `force`
   * checks in anyway (not revoked ones, not other events').
   */
  @Post(':id/check-in')
  @HttpCode(200)
  @ClientRoute(MANAGE)
  async checkIn(@Req() req: Request, @Param('id', ParseIntPipe) id: number, @Body(new YupValidationPipe(checkInSchema)) body: yup.InferType<typeof checkInSchema>) {
    const c = ctx(req);
    await this.event(c.org.id, id);
    return this.checkIns.checkIn(c.org.id, id, body, { userId: c.user.id, by: c.user.name || c.user.email });
  }

  @Post(':id/tickets/:tid/check-in/undo')
  @HttpCode(200)
  @ClientRoute(MANAGE)
  async undoCheckIn(@Req() req: Request, @Param('id', ParseIntPipe) id: number, @Param('tid', ParseIntPipe) tid: number) {
    return this.checkIns.undo(ctx(req).org.id, id, tid);
  }
}

// ---- The public side ----

@Controller('public/bookings/:slug/events')
export class PublicEventsController {
  constructor(
    private readonly db: ClientsDb,
    private readonly mails: EventMails,
    private readonly live: EventLive,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  /** The business behind the link, if it takes registrations (active account and plan). */
  private async business(slug: string) {
    if (!SLUG_RE.test(slug)) throw new ApiError(404, { error: 'not_found', message: 'That page does not exist.' });
    const s = await this.db.bookingSettings.findUnique({ where: { slug } });
    if (!s) throw new ApiError(404, { error: 'not_found', message: 'That page does not exist.' });
    const ents = await loadEntitlements(this.db, s.organizationId);
    const sub = await this.db.subscription.findUnique({ where: { organizationId: s.organizationId }, select: { status: true } });
    const open = (await orgStatus(this.db, s.organizationId)) === 'active' && sub?.status === 'active' && ents.apps.includes('bookings');
    return { s, ents, open };
  }

  private async event(slug: string, eventSlug: string) {
    const b = await this.business(slug);
    const e = b.open ? await this.db.event.findFirst({ where: { organizationId: b.s.organizationId, slug: eventSlug.toLowerCase(), published: true } }) : null;
    if (!e) throw new ApiError(404, { error: 'not_found', message: 'This event is not available.' });
    return { ...b, e };
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
    const spotsLeft = e.capacity === null ? null : Math.max(0, e.capacity - used);
    const status = e.endsAt <= new Date() ? 'over' : spotsLeft === 0 && e.kind === 'free' ? 'full' : 'open';
    const row = eventRow(e, s.timeZone);
    return {
      ...this.pageOf(s, hasFeature(ents, 'bookings.full_branding')),
      status,
      event: { ...row, meetingUrl: undefined, hasLink: !!e.meetingUrl, spotsLeft },
    };
  }

  @Post(':event/register')
  @StrictRateLimit()
  async register(@Param('slug') slug: string, @Param('event') eventSlug: string, @Body(new YupValidationPipe(registerSchema)) body: yup.InferType<typeof registerSchema>) {
    const { e } = await this.event(slug, eventSlug);
    if (e.kind !== 'free') throw new ApiError(409, { error: 'paid_event', message: 'This is a paid event. Please enter the code you received from the organizer.' });
    if (e.endsAt <= new Date()) throw new ApiError(409, { error: 'over', message: 'This event is over.' });
    try {
      const t = await this.db.$transaction(async (tx) => {
        if (e.capacity !== null && (await taken(tx, e.id)) >= e.capacity) throw new ApiError(409, { error: 'full', message: 'Sorry, the event is full.' });
        return tx.eventTicket.create({
          data: { eventId: e.id, organizationId: e.organizationId, name: `${body.firstName} ${body.lastName}`, email: body.email, phone: body.phone, code: await freeCode(tx, e.organizationId), status: 'confirmed', confirmedAt: new Date() },
        });
      });
      await this.mails.confirmation(e, t);
      this.live.emit({ eventId: e.id, type: 'registered', name: t.name });
      logger.info({ eventId: e.id, ticketId: t.id }, 'Event registration');
      return this.confirmed(t, e);
    } catch (err) {
      if (isUniqueClash(err)) throw alreadyRegistered();
      throw err;
    }
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
      const updated = await this.db.eventTicket.update({ where: { id: t.id }, data: { status: 'confirmed', confirmedAt: new Date() } });
      await this.mails.confirmation(e, updated);
      this.live.emit({ eventId: e.id, type: 'registered', name: updated.name });
      logger.info({ eventId: e.id, ticketId: t.id }, 'Event code used');
      return { ...this.confirmed(updated, e), first: true };
    }
    // Already confirmed: show it again (and send the email again), so a lost email isn't a problem.
    await this.mails.confirmation(e, t);
    return { ...this.confirmed(t, e), first: false };
  }

  /** The registration behind a cancel link, if the token is right. */
  private async byToken(e: EventRow, token: unknown) {
    const m = typeof token === 'string' ? /^(\d+)\.([0-9a-f]{32})$/.exec(token) : null;
    const t = m ? await this.db.eventTicket.findFirst({ where: { id: Number(m[1]), eventId: e.id } }) : null;
    if (!t || !sameSecret(t.manageNonce, m![2])) throw new ApiError(404, { error: 'bad_link', message: 'This link isn’t valid. Please use the link in your latest email.' });
    return t;
  }

  @Get(':event/registration')
  @Header('Cache-Control', 'no-store')
  async registration(@Req() req: Request, @Param('slug') slug: string, @Param('event') eventSlug: string) {
    const { e } = await this.event(slug, eventSlug);
    const t = await this.byToken(e, req.headers['x-registration-token']);
    return { name: t.name, email: t.email, status: t.status, checkedIn: !!t.checkedInAt, canCancel: e.kind === 'free' && t.status === 'confirmed' && !t.checkedInAt && e.endsAt > new Date() };
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
    if (t.checkedInAt) throw new ApiError(409, { error: 'checked_in', message: 'You’ve already checked in at this event.' });
    if (e.endsAt <= new Date()) throw new ApiError(409, { error: 'over', message: 'This event is over.' });
    const updated = await this.db.eventTicket.update({ where: { id: t.id }, data: { status: 'cancelled', cancelledAt: new Date() } });
    await this.mails.cancelled(e, updated);
    this.live.emit({ eventId: e.id, type: 'cancelled', name: updated.name });
    logger.info({ eventId: e.id, ticketId: t.id }, 'Event registration cancelled by the attendee');
    return { ok: true, already: false };
  }

  /** What the attendee sees after registering: the QR code for onsite events, nothing to scan online. */
  private confirmed(t: TicketRow, e: { format: string }) {
    return {
      name: t.name,
      email: t.email,
      online: e.format === 'online',
      checkIn: e.format === 'online' ? null : { code: formatCheckInCode(t.code), url: checkInUrl(this.cfg.clients.bookingsUrl, t.code) },
      cancelToken: registrationToken(t),
    };
  }
}
