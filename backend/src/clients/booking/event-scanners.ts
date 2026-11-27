// Attendance scanners and the live attendance feed.
//
// Onsite events (free or paid) have scanners: 2 per event (limit:events.scanners, every plan). A
// scanner is a person: first and last name and a role ("Attendance" by default). It has two
// 8-character codes, both unique across the system:
//   scanner code  its ID: in its link {SCANNER_URL}/{business}/{event}/{scannerCode}, or typed on
//                 the scanner site's sign-in page
//   access code   the secret: sign-in checks its SHA-256 hash; an encrypted copy (AES-256-GCM,
//                 key from BETTER_AUTH_SECRET) lets owners and admins see it on the Scanners tab
// The first device to sign in with both gets a session (a random token kept in that browser, so
// it stays signed in); nobody else can use that access code. The business can revoke the access
// code, make a new one, or delete the scanner, any time: the device is signed out (it re-checks
// its session every few seconds, and every scan checks it too).
//
// Sections: "Attendance" (always; checks attendees in) and claimables, things attendees can claim
// at the event (e.g. "Free Water", "Snack"), each with its own scanners: a claimable's scanner
// marks the item as claimed, once per attendee. Limits: limit:events.claimables per event (free
// plan 2, premium 15), limit:events.claimable_scanners per claimable (2, premium 5),
// limit:events.scanners for attendance (2). A scanner's role is its section's name.
//
//   GET    /api/client/bookings/events/:id/scanners             { sections: [attendance, ...claimables] }
//   POST   /api/client/bookings/events/:id/claimables           { name }
//   PATCH  /api/client/bookings/events/:id/claimables/:cid      { name }
//   DELETE /api/client/bookings/events/:id/claimables/:cid      with its scanners and claims
//   POST   /api/client/bookings/events/:id/claimables/:cid/claim   the business's own scanner page: { code } | { ticketId }
//   POST   /api/client/bookings/events/:id/claimables/:cid/undo    { ticketId }
//   POST   /api/client/bookings/events/:id/scanners             { email, firstName, lastName, role } -> { scanner, accessCode }  (codes emailed)
//   POST   /api/client/bookings/events/:id/scanners/:sid/code   a new access code (signs the device out; emailed)
//   POST   /api/client/bookings/events/:id/scanners/:sid/revoke no valid access code until a new one
//   DELETE /api/client/bookings/events/:id/scanners/:sid
//   GET    /api/client/bookings/events/:id/live                 server-sent events: check-ins, registrations
//   GET    /api/scanner/:scannerCode                            the scanner (company, event, person, role)
//   POST   /api/scanner/:scannerCode/sign-in   { accessCode } -> { token }   one device per access code
//   GET    /api/scanner/:scannerCode/session   (X-Scanner-Token)  still signed in? + attendance counts
//   POST   /api/scanner/:scannerCode/check-in  (X-Scanner-Token)  { code } | { ticketId }, force
//   POST   /api/scanner/:scannerCode/undo      (X-Scanner-Token)  { ticketId }
//   POST   /api/scanner/:scannerCode/sign-out  (X-Scanner-Token)  the device signs out: the same access
//                                               code can then sign in again (on one device)
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto';
import { Body, Controller, Delete, Get, Header, HttpCode, Inject, Injectable, type MessageEvent, Param, ParseIntPipe, Patch, Post, Req, Sse } from '@nestjs/common';
import type { Request } from 'express';
import { filter, interval, map, merge, type Observable } from 'rxjs';
import * as yup from 'yup';
import { MAILER } from '../../auth/auth.module';
import type { Mailer } from '../../auth/mailer';
import { ApiError } from '../../common/api-error';
import { StrictRateLimit } from '../../common/rate-limit';
import { YupValidationPipe } from '../../common/yup-validation.pipe';
import { APP_CONFIG, type AppConfig } from '../../config/config';
import { logger } from '../../logging/logger';
import { scannerAccessMail } from '../client-emails';
import { ClientsDb } from '../clients-db';
import { ClientRoute, orgStatus, type ClientContext } from '../client-context';
import { hasFeature, limitOf, loadEntitlements } from '../entitlements';
import { formatCheckInCode, newCheckInCode, parseCheckInCode } from './check-in';
import { EventCheckIns, EventLive, logTicket, zoneOf } from './events';
import { formatInZone, toLocal } from './time';
import { EVENT_ROUTES } from '../roles';

const ctx = (req: Request) => req.client as ClientContext;
const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');
const DEFAULT_ROLE = 'Attendance';

const personSchema = yup.object({
  email: yup.string().trim().lowercase().email('Please enter a valid email address.').max(254).required('Please enter their email address: the codes are sent there.'),
  /** The section: a claimable's id, or none for attendance. */
  claimableId: yup.number().integer().positive().nullable(),
  firstName: yup.string().trim().min(1, 'Please enter the first name.').max(60).required('Please enter the first name.'),
  lastName: yup.string().trim().min(1, 'Please enter the last name.').max(60).required('Please enter the last name.'),
  role: yup
    .string()
    .trim()
    .max(40)
    .nullable()
    .transform((v) => (v === '' ? null : v)),
});
const claimableSchema = yup.object({ name: yup.string().trim().min(2, 'Please name it, e.g. Free Water.').max(60).required('Please name it, e.g. Free Water.') });
const signInSchema = yup.object({ accessCode: yup.string().trim().max(40).required('Please enter the access code.') });
const scanSchema = yup.object({ code: yup.string().trim().max(300).nullable(), ticketId: yup.number().integer().positive().nullable(), force: yup.boolean().default(false) });
const undoSchema = yup.object({ ticketId: yup.number().integer().positive().required() });
type ClaimableRow = NonNullable<Awaited<ReturnType<ClientsDb['eventClaimable']['findFirst']>>>;

/** The access code encrypted for the Scanners tab: "iv.tag.data" (base64url). */
const accessKey = (secret: string) => createHash('sha256').update(`event-scanner-access-code:${secret}`).digest();
function sealCode(secret: string, code: string) {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', accessKey(secret), iv);
  const data = Buffer.concat([c.update(code, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), data].map((b) => b.toString('base64url')).join('.');
}
function openCode(secret: string, sealed: string | null) {
  if (!sealed) return null;
  try {
    const [iv, tag, data] = sealed.split('.').map((p) => Buffer.from(p, 'base64url'));
    const d = createDecipheriv('aes-256-gcm', accessKey(secret), iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(data), d.final()]).toString('utf8');
  } catch {
    return null; // another secret (rotated): the code must be made again to be seen
  }
}

type ScannerRow = NonNullable<Awaited<ReturnType<ClientsDb['eventScanner']['findFirst']>>>;
const status = (s: ScannerRow) => (!s.codeHash ? 'revoked' : s.redeemedAt ? 'in_use' : 'waiting');
const fullName = (s: { firstName: string; lastName: string }) => `${s.firstName} ${s.lastName}`.trim();

/** A scanner code nobody has, and an access code nobody has (both 8 characters). */
async function freshCodes(db: ClientsDb) {
  let scannerCode = newCheckInCode();
  while (await db.eventScanner.findUnique({ where: { scannerCode }, select: { id: true } })) scannerCode = newCheckInCode();
  return { scannerCode, accessCode: await freshAccessCode(db, scannerCode) };
}
async function freshAccessCode(db: ClientsDb, notThis?: string) {
  for (;;) {
    const code = newCheckInCode();
    if (code !== notThis && !(await db.eventScanner.findUnique({ where: { codeHash: sha256(code) }, select: { id: true } }))) return code;
  }
}

/**
 * A claim: the attendee (of this event, registered, and checked in at Attendance first) gets the
 * item once. A second scan says when it was claimed and by whom. Used by scanner devices and by
 * the business's own scanner page.
 */
@Injectable()
export class EventClaims {
  constructor(
    private readonly db: ClientsDb,
    private readonly live: EventLive,
  ) {}

  async claim(orgId: string, eventId: number, k: ClaimableRow, body: { code?: string | null; ticketId?: number | null }, who: { scannerId: number | null; by: string }) {
    const code = body.code ? parseCheckInCode(body.code) : null;
    if (!body.ticketId && !code) throw new ApiError(400, { error: 'validation_failed', message: 'That is not a QR code from this event. Codes have 8 letters and numbers, like ABCD-EFGH.', fields: { code: 'Please check the code.' } });
    const t = await this.db.eventTicket.findFirst({ where: { organizationId: orgId, ...(body.ticketId ? { id: body.ticketId } : { code: code! }) }, include: { event: true } });
    if (!t) throw new ApiError(404, { error: 'not_found', message: 'No registration matches this code.' });
    if (t.eventId !== eventId) throw new ApiError(409, { error: 'not_this_event', message: `This code is for another event: “${t.event.title}”.` });
    const ticket = { id: t.id, name: t.name, email: t.email, code: t.code ? formatCheckInCode(t.code) : null, checkedInAt: t.checkedInAt, status: t.status };
    if (t.status !== 'confirmed') return { kind: 'claim', state: t.status === 'cancelled' ? 'cancelled' : 'revoked', item: k.name, ticket };
    // Attendance first: only checked-in attendees can claim.
    if (!t.checkedInAt) return { kind: 'claim', state: 'not_checked_in', item: k.name, ticket };
    try {
      const claim = await this.db.eventClaim.create({ data: { claimableId: k.id, ticketId: t.id, organizationId: orgId, scannerId: who.scannerId, claimedBy: who.by } });
      await logTicket(this.db, t, 'claimed', who.by, k.name);
      this.live.emit({ eventId, type: 'claimed', name: t.name, item: k.name, by: who.by });
      logger.info({ eventId, claimableId: k.id, ticketId: t.id }, 'Event item claimed');
      return { kind: 'claim', state: 'claimed', item: k.name, claimedAt: claim.claimedAt, ticket };
    } catch (err) {
      if ((err as { code?: string })?.code !== 'P2002') throw err;
      const before = await this.db.eventClaim.findUnique({ where: { claimableId_ticketId: { claimableId: k.id, ticketId: t.id } } });
      return { kind: 'claim', state: 'already', item: k.name, claimedAt: before?.claimedAt ?? null, claimedBy: before?.claimedBy ?? null, ticket };
    }
  }

  async undo(eventId: number, k: ClaimableRow, ticketId: number, by: string | null = null) {
    const { count } = await this.db.eventClaim.deleteMany({ where: { claimableId: k.id, ticketId } });
    const t = count ? await this.db.eventTicket.findUnique({ where: { id: ticketId }, select: { id: true, organizationId: true } }) : null;
    if (t) await logTicket(this.db, t, 'claim_undone', by, k.name);
    this.live.emit({ eventId, type: 'claim_undone', item: k.name });
    return { ok: true };
  }
}

// ---- The business's side ----

@Controller('client/bookings/events/:id')
export class EventScannersController {
  constructor(
    private readonly db: ClientsDb,
    private readonly live: EventLive,
    private readonly claims: EventClaims,
    @Inject(MAILER) private readonly mailer: Mailer,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  /** Emails the scanner their codes (the access code is only ever shown at this moment). */
  private async emailCodes(s: ScannerRow, e: { title: string; slug: string; startsAt: Date; timeZone: string | null }, accessCode: string, replaced: boolean) {
    if (!s.email) return;
    const settings = await this.db.bookingSettings.findUnique({ where: { organizationId: s.organizationId } });
    if (!settings) return;
    const ents = await loadEntitlements(this.db, s.organizationId);
    const f = formatInZone(e.startsAt, zoneOf(e, settings.timeZone));
    this.mailer.sendInBackground(
      scannerAccessMail(this.cfg, {
        brand: { businessName: settings.businessName, primaryColor: settings.primaryColor, poweredBy: !hasFeature(ents, 'bookings.full_branding'), replyTo: settings.contactEmail, phone: settings.phone },
        name: fullName(s),
        email: s.email,
        role: s.role,
        eventTitle: e.title,
        when: `${f.date}, ${f.time} (${f.zone})`,
        siteUrl: this.cfg.clients.scannerUrl,
        linkUrl: `${this.cfg.clients.scannerUrl}/${settings.slug}/${e.slug}/${s.scannerCode}`,
        scannerCode: formatCheckInCode(s.scannerCode),
        accessCode: formatCheckInCode(accessCode),
        replaced,
      }),
    );
  }

  private async event(orgId: string, id: number) {
    const e = await this.db.event.findFirst({ where: { id, organizationId: orgId } });
    if (!e) throw new ApiError(404, { error: 'not_found', message: 'That event does not exist.' });
    return e;
  }

  private async scanner(eventId: number, sid: number) {
    const s = await this.db.eventScanner.findFirst({ where: { id: sid, eventId } });
    if (!s) throw new ApiError(404, { error: 'not_found', message: 'That scanner does not exist.' });
    return s;
  }

  private async row(s: ScannerRow, eventSlug: string, orgId: string, claimables?: ClaimableRow[], showAccess = false) {
    const settings = await this.db.bookingSettings.findUnique({ where: { organizationId: orgId }, select: { slug: true } });
    return {
      id: s.id,
      claimableId: s.claimableId,
      section: s.claimableId ? (claimables?.find((k) => k.id === s.claimableId)?.name ?? s.role) : 'Attendance',
      firstName: s.firstName,
      lastName: s.lastName,
      name: fullName(s),
      email: s.email || null,
      role: s.role,
      scannerCode: formatCheckInCode(s.scannerCode),
      // Owners and admins see the access code; null when revoked (or made before codes were kept).
      accessCode: showAccess && s.codeHash ? (openCode(this.cfg.auth.secret, s.accessCodeEnc)?.replace(/^(.{4})(.{4})$/, '$1-$2') ?? null) : null,
      accessCodeHidden: !showAccess,
      url: `${this.cfg.clients.scannerUrl}/${settings?.slug}/${eventSlug}/${s.scannerCode}`,
      signInUrl: this.cfg.clients.scannerUrl,
      status: status(s),
      codeCreatedAt: s.codeCreatedAt,
      redeemedAt: s.redeemedAt,
      lastSeenAt: s.lastSeenAt,
      createdAt: s.createdAt,
    };
  }

  private async limits(orgId: string) {
    const ents = await loadEntitlements(this.db, orgId);
    return { attendance: limitOf(ents, 'events.scanners'), claimables: limitOf(ents, 'events.claimables'), perClaimable: limitOf(ents, 'events.claimable_scanners') };
  }

  private async claimable(eventId: number, cid: number) {
    const k = await this.db.eventClaimable.findFirst({ where: { id: cid, eventId } });
    if (!k) throw new ApiError(404, { error: 'not_found', message: 'That claimable does not exist.' });
    return k;
  }

  @Get('scanners')
  @ClientRoute(EVENT_ROUTES.view)
  async list(@Req() req: Request, @Param('id', ParseIntPipe) id: number) {
    const c = ctx(req);
    const e = await this.event(c.org.id, id);
    const [rows, claimables, claimCounts, limits] = await Promise.all([
      this.db.eventScanner.findMany({ where: { eventId: id }, orderBy: { createdAt: 'asc' } }),
      this.db.eventClaimable.findMany({ where: { eventId: id }, orderBy: [{ position: 'asc' }, { id: 'asc' }] }),
      this.db.eventClaim.groupBy({ by: ['claimableId'], where: { claimable: { eventId: id } }, _count: { _all: true } }),
      this.limits(c.org.id),
    ]);
    const scanners = await Promise.all(rows.map((s) => this.row(s, e.slug, c.org.id, claimables, c.permissions.includes('events.scanners'))));
    return {
      allowed: e.format !== 'online',
      claimableLimit: limits.claimables,
      sections: [
        { id: null, kind: 'attendance', name: 'Attendance', limit: limits.attendance, scanners: scanners.filter((s) => s.claimableId === null) },
        ...claimables.map((k) => ({
          id: k.id,
          kind: 'claimable',
          name: k.name,
          limit: limits.perClaimable,
          claimed: claimCounts.find((g) => g.claimableId === k.id)?._count._all ?? 0,
          scanners: scanners.filter((s) => s.claimableId === k.id),
        })),
      ],
    };
  }

  @Post('claimables')
  @ClientRoute(EVENT_ROUTES.scanners)
  async addClaimable(@Req() req: Request, @Param('id', ParseIntPipe) id: number, @Body(new YupValidationPipe(claimableSchema)) body: yup.InferType<typeof claimableSchema>) {
    const c = ctx(req);
    const e = await this.event(c.org.id, id);
    if (e.format === 'online') throw new ApiError(409, { error: 'online_event', message: 'Online events have no scanning: attendees just join with the link.' });
    const { claimables } = await this.limits(c.org.id);
    const count = await this.db.eventClaimable.count({ where: { eventId: id } });
    if (claimables !== null && count >= claimables) {
      throw new ApiError(403, { error: 'claimable_limit', message: `Your plan includes ${claimables} claimables per event. Delete one to add another, or upgrade your plan.` });
    }
    const k = await this.db.eventClaimable.create({ data: { eventId: id, organizationId: c.org.id, name: body.name, position: count } });
    this.live.emit({ eventId: id, type: 'scanner' });
    return { id: k.id, name: k.name };
  }

  @Patch('claimables/:cid')
  @ClientRoute(EVENT_ROUTES.scanners)
  async renameClaimable(@Req() req: Request, @Param('id', ParseIntPipe) id: number, @Param('cid', ParseIntPipe) cid: number, @Body(new YupValidationPipe(claimableSchema)) body: yup.InferType<typeof claimableSchema>) {
    await this.event(ctx(req).org.id, id);
    await this.claimable(id, cid);
    const k = await this.db.eventClaimable.update({ where: { id: cid }, data: { name: body.name } });
    // A scanner's role is its section's name.
    await this.db.eventScanner.updateMany({ where: { claimableId: cid }, data: { role: k.name.slice(0, 40) } });
    return { id: k.id, name: k.name };
  }

  /** The business's own scanner page, scanning for a claimable. */
  @Post('claimables/:cid/claim')
  @HttpCode(200)
  @ClientRoute(EVENT_ROUTES.attendees)
  async claimHere(@Req() req: Request, @Param('id', ParseIntPipe) id: number, @Param('cid', ParseIntPipe) cid: number, @Body(new YupValidationPipe(scanSchema)) body: yup.InferType<typeof scanSchema>) {
    const c = ctx(req);
    await this.event(c.org.id, id);
    const k = await this.claimable(id, cid);
    return this.claims.claim(c.org.id, id, k, body, { scannerId: null, by: `${c.user.name || c.user.email} (${k.name})` });
  }

  @Post('claimables/:cid/undo')
  @HttpCode(200)
  @ClientRoute(EVENT_ROUTES.attendees)
  async unclaimHere(@Req() req: Request, @Param('id', ParseIntPipe) id: number, @Param('cid', ParseIntPipe) cid: number, @Body(new YupValidationPipe(undoSchema)) body: yup.InferType<typeof undoSchema>) {
    await this.event(ctx(req).org.id, id);
    return this.claims.undo(id, await this.claimable(id, cid), body.ticketId, ctx(req).user.name || ctx(req).user.email);
  }

  @Delete('claimables/:cid')
  @ClientRoute(EVENT_ROUTES.scanners)
  async deleteClaimable(@Req() req: Request, @Param('id', ParseIntPipe) id: number, @Param('cid', ParseIntPipe) cid: number) {
    await this.event(ctx(req).org.id, id);
    await this.claimable(id, cid);
    // Its scanners (signed out) and claims go with it.
    await this.db.eventClaimable.delete({ where: { id: cid } });
    this.live.emit({ eventId: id, type: 'scanner' });
    return { ok: true };
  }

  @Post('scanners')
  @ClientRoute(EVENT_ROUTES.scanners)
  async create(@Req() req: Request, @Param('id', ParseIntPipe) id: number, @Body(new YupValidationPipe(personSchema)) body: yup.InferType<typeof personSchema>) {
    const c = ctx(req);
    const e = await this.event(c.org.id, id);
    if (e.format === 'online') throw new ApiError(409, { error: 'online_event', message: 'Online events have no scanning: attendees just join with the link.' });
    const k = body.claimableId ? await this.claimable(id, body.claimableId) : null;
    const limits = await this.limits(c.org.id);
    const limit = k ? limits.perClaimable : limits.attendance;
    if (limit !== null && (await this.db.eventScanner.count({ where: { eventId: id, claimableId: k ? k.id : null } })) >= limit) {
      throw new ApiError(403, { error: 'scanner_limit', message: k ? `“${k.name}” can have ${limit} scanners. Delete one to add another.` : `An event can have ${limit} attendance scanners. Delete one to add another.` });
    }
    const { scannerCode, accessCode } = await freshCodes(this.db);
    const s = await this.db.eventScanner.create({
      data: { eventId: id, organizationId: c.org.id, publicId: randomUUID(), scannerCode, email: body.email, firstName: body.firstName, lastName: body.lastName, claimableId: k?.id ?? null, role: (k?.name ?? body.role ?? DEFAULT_ROLE).slice(0, 40), codeHash: sha256(accessCode), accessCodeEnc: sealCode(this.cfg.auth.secret, accessCode), codeCreatedAt: new Date() },
    });
    await this.emailCodes(s, e, accessCode, false);
    logger.info({ org: c.org.id, eventId: id, scannerId: s.id }, 'Event scanner created');
    return { scanner: await this.row(s, e.slug, c.org.id), accessCode: formatCheckInCode(accessCode) };
  }

  /** A new access code: the old one stops working and the device using it is signed out. */
  @Post('scanners/:sid/code')
  @HttpCode(200)
  @ClientRoute(EVENT_ROUTES.scanners)
  async newCode(@Req() req: Request, @Param('id', ParseIntPipe) id: number, @Param('sid', ParseIntPipe) sid: number) {
    const c = ctx(req);
    const e = await this.event(c.org.id, id);
    const old = await this.scanner(id, sid);
    const accessCode = await freshAccessCode(this.db, old.scannerCode);
    const s = await this.db.eventScanner.update({ where: { id: sid }, data: { codeHash: sha256(accessCode), accessCodeEnc: sealCode(this.cfg.auth.secret, accessCode), codeCreatedAt: new Date(), redeemedAt: null, sessionHash: null } });
    await this.emailCodes(s, e, accessCode, true);
    this.live.emit({ eventId: id, type: 'scanner' });
    return { scanner: await this.row(s, e.slug, c.org.id), accessCode: formatCheckInCode(accessCode) };
  }

  @Post('scanners/:sid/revoke')
  @HttpCode(200)
  @ClientRoute(EVENT_ROUTES.scanners)
  async revoke(@Req() req: Request, @Param('id', ParseIntPipe) id: number, @Param('sid', ParseIntPipe) sid: number) {
    const c = ctx(req);
    const e = await this.event(c.org.id, id);
    await this.scanner(id, sid);
    const s = await this.db.eventScanner.update({ where: { id: sid }, data: { codeHash: null, accessCodeEnc: null, redeemedAt: null, sessionHash: null } });
    this.live.emit({ eventId: id, type: 'scanner' });
    return { scanner: await this.row(s, e.slug, c.org.id) };
  }

  @Delete('scanners/:sid')
  @ClientRoute(EVENT_ROUTES.scanners)
  async remove(@Req() req: Request, @Param('id', ParseIntPipe) id: number, @Param('sid', ParseIntPipe) sid: number) {
    await this.event(ctx(req).org.id, id);
    await this.scanner(id, sid);
    await this.db.eventScanner.delete({ where: { id: sid } });
    this.live.emit({ eventId: id, type: 'scanner' });
    return { ok: true };
  }

  /** The event page listens here: a message per check-in, registration, cancellation... (plus a ping). */
  @Sse('live')
  @Header('X-Accel-Buffering', 'no')
  @Header('Cache-Control', 'no-cache')
  @ClientRoute(EVENT_ROUTES.view)
  async feed(@Req() req: Request, @Param('id', ParseIntPipe) id: number): Promise<Observable<MessageEvent>> {
    await this.event(ctx(req).org.id, id);
    return merge(
      this.live.feed.pipe(
        filter((m) => m.eventId === id),
        map((m) => ({ type: 'change', data: m }) as MessageEvent),
      ),
      interval(25_000).pipe(map(() => ({ type: 'ping', data: '' }) as MessageEvent)),
    );
  }
}

// ---- The scanner device (no sign-in account: scanner code + access code) ----

@Controller('scanner/:scannerCode')
export class ScannerController {
  constructor(
    private readonly db: ClientsDb,
    private readonly checkIns: EventCheckIns,
    private readonly live: EventLive,
    private readonly claims: EventClaims,
  ) {}

  private async load(raw: string) {
    const scannerCode = parseCheckInCode(raw);
    const s = scannerCode ? await this.db.eventScanner.findUnique({ where: { scannerCode }, include: { event: true, claimable: true } }) : null;
    if (!s || (await orgStatus(this.db, s.organizationId)) !== 'active') {
      throw new ApiError(404, { error: 'scanner_gone', message: 'This scanner doesn’t exist any more. Ask the organizer for a new one.' });
    }
    return s;
  }

  /** The device's session: the scanner, its access code and the token must all still be valid. */
  private async session(req: Request, raw: string) {
    const s = await this.load(raw);
    const token = req.headers['x-scanner-token'];
    if (typeof token !== 'string' || !token || !s.codeHash || !s.sessionHash || s.sessionHash !== sha256(token)) {
      throw new ApiError(401, {
        error: s.codeHash ? 'scanner_signed_out' : 'access_revoked',
        message: s.codeHash ? 'This device was signed out of the scanner.' : 'Your access was revoked by the organizer.',
      });
    }
    await this.db.eventScanner.update({ where: { id: s.id }, data: { lastSeenAt: new Date() } });
    return s;
  }

  @Get()
  @Header('Cache-Control', 'no-store')
  async page(@Param('scannerCode') scannerCode: string) {
    const s = await this.load(scannerCode);
    const settings = await this.db.bookingSettings.findUnique({ where: { organizationId: s.organizationId } });
    const ents = await loadEntitlements(this.db, s.organizationId);
    const tz = zoneOf(s.event, settings?.timeZone ?? 'UTC');
    return {
      scanner: { scannerCode: formatCheckInCode(s.scannerCode), name: fullName(s), firstName: s.firstName, role: s.claimable?.name ?? s.role, status: status(s) },
      section: s.claimable ? { kind: 'claimable', id: s.claimable.id, name: s.claimable.name } : { kind: 'attendance', id: null, name: 'Attendance' },
      company: { name: settings?.businessName ?? '', slug: settings?.slug ?? '', timeZone: tz },
      branding: { primaryColor: settings?.primaryColor ?? '#2563EB', poweredBy: !hasFeature(ents, 'bookings.full_branding') },
      event: { slug: s.event.slug, title: s.event.title, date: toLocal(s.event.startsAt, tz).date, startsAt: s.event.startsAt, endsAt: s.event.endsAt, format: s.event.format, address: s.event.address },
    };
  }

  /** The first device to sign in with the access code keeps the scanner; nobody else can. */
  @Post('sign-in')
  @HttpCode(200)
  @StrictRateLimit()
  async signIn(@Param('scannerCode') scannerCode: string, @Body(new YupValidationPipe(signInSchema)) body: yup.InferType<typeof signInSchema>) {
    const s = await this.load(scannerCode);
    const code = parseCheckInCode(body.accessCode);
    if (!s.codeHash) throw new ApiError(403, { error: 'access_revoked', message: 'This scanner’s access was revoked. Ask the organizer for a new access code.' });
    if (!code || sha256(code) !== s.codeHash) throw new ApiError(400, { error: 'bad_code', message: 'That access code isn’t right. Please check it with the organizer.', fields: { accessCode: 'Wrong access code.' } });
    const token = randomBytes(32).toString('base64url');
    const { count } = await this.db.eventScanner.updateMany({ where: { id: s.id, codeHash: s.codeHash, redeemedAt: null }, data: { redeemedAt: new Date(), sessionHash: sha256(token), lastSeenAt: new Date() } });
    if (!count) throw new ApiError(409, { error: 'code_in_use', message: 'This access code is already being used on another device. Ask the organizer for a new one if that’s a mistake.' });
    logger.info({ eventId: s.eventId, scannerId: s.id }, 'Attendance scanner signed in on a device');
    return { token, scannerCode: s.scannerCode };
  }

  /** The person signs out on purpose: the session ends and the access code is free again. */
  @Post('sign-out')
  @HttpCode(200)
  async signOut(@Req() req: Request, @Param('scannerCode') scannerCode: string) {
    const s = await this.session(req, scannerCode);
    await this.db.eventScanner.update({ where: { id: s.id }, data: { redeemedAt: null, sessionHash: null } });
    this.live.emit({ eventId: s.eventId, type: 'scanner' });
    logger.info({ eventId: s.eventId, scannerId: s.id }, 'Event scanner signed out');
    return { ok: true };
  }

  @Get('session')
  @Header('Cache-Control', 'no-store')
  async current(@Req() req: Request, @Param('scannerCode') scannerCode: string) {
    const s = await this.session(req, scannerCode);
    const [confirmed, checkedIn, claimed] = await Promise.all([
      this.db.eventTicket.count({ where: { eventId: s.eventId, status: 'confirmed' } }),
      this.db.eventTicket.count({ where: { eventId: s.eventId, checkedInAt: { not: null } } }),
      s.claimableId ? this.db.eventClaim.count({ where: { claimableId: s.claimableId } }) : Promise.resolve(0),
    ]);
    return { ok: true, confirmed, checkedIn, claimed };
  }

  @Post('check-in')
  @HttpCode(200)
  async checkIn(@Req() req: Request, @Param('scannerCode') scannerCode: string, @Body(new YupValidationPipe(scanSchema)) body: yup.InferType<typeof scanSchema>) {
    const s = await this.session(req, scannerCode);
    if (s.claimable) return this.claims.claim(s.organizationId, s.eventId, s.claimable, body, { scannerId: s.id, by: `${fullName(s)} (${s.claimable.name})` });
    return this.checkIns.checkIn(s.organizationId, s.eventId, body, { userId: `scanner:${s.id}`, by: `${fullName(s)} (${s.role})` });
  }

  @Post('undo')
  @HttpCode(200)
  async undo(@Req() req: Request, @Param('scannerCode') scannerCode: string, @Body(new YupValidationPipe(undoSchema)) body: yup.InferType<typeof undoSchema>) {
    const s = await this.session(req, scannerCode);
    if (s.claimable) return this.claims.undo(s.eventId, s.claimable, body.ticketId, `${fullName(s)} (${s.claimable.name})`);
    return this.checkIns.undo(s.organizationId, s.eventId, body.ticketId, `${fullName(s)} (${s.role})`);
  }

}
