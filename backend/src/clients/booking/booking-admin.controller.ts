// The business's Bookings app (owner, admin, staff). Every route: signed in, active business,
// plan includes Bookings, and the role's permission (client-context.ts).
//
//   GET    /api/client/bookings/overview
//   GET    /api/client/bookings/settings                 settings + hours + breaks
//   PUT    /api/client/bookings/settings                 -> { settings, outsideHours }
//   PUT    /api/client/bookings/hours  { hours, breaks } -> { outsideHours }
//   GET    /api/client/bookings/blocked-dates           time off (whole days or time windows, all or one service)
//   POST   /api/client/bookings/blocked-dates           409 { conflicts } unless existing=keep|cancel
//   DELETE /api/client/bookings/blocked-dates/:id
//   GET    /api/client/bookings/services   POST   PATCH /:id   DELETE /:id
//   GET    /api/client/bookings/dashboard?days=7|30|90|365   past, today and future: counts, per day, per service
//   GET    /api/client/bookings/items?view=upcoming|past|cancelled|all&from&to
//   POST   /api/client/bookings/items                    a booking added by the business
//   POST   /api/client/bookings/items/:id/cancel  { reason, notify }
//   POST   /api/client/bookings/items/:id/reschedule  { startsAt | date }
//   POST   /api/client/bookings/items/:id/no-show  { noShow }
//   POST   /api/client/bookings/check-in  { code } | { id }, force   attendance (QR scan or typed code)
//   POST   /api/client/bookings/items/:id/check-in/undo
//   GET    /api/client/bookings/availability?serviceId&from&to
//   GET    /api/client/bookings/export.csv                 every booking (owners, admins)
import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseIntPipe, Patch, Post, Put, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import type * as yup from 'yup';
import { ApiError } from '../../common/api-error';
import { YupValidationPipe } from '../../common/yup-validation.pipe';
import { APP_CONFIG, type AppConfig } from '../../config/config';
import { logger } from '../../logging/logger';
import { cleanInstructions, richInstructions } from '../client-emails';
import { ClientsDb } from '../clients-db';
import { ClientRoute, type ClientContext } from '../client-context';
import { hasFeature, limitOf } from '../entitlements';
import { BookingEngine, loadRules, monthlyUsage, occupiedBetween } from './booking-engine';
import { formatCheckInCode, parseCheckInCode } from './check-in';
import { csvFor } from './csv';
import { BookingNotifications } from './notifications';
import { parseReminders, planProblem } from './reminders';
import { fitsHours, rangeAvailability } from './schedule';
import { blockedDateSchema, bookSchema, cancelSchema, checkInSchema, hoursSchema, noShowSchema, rescheduleSchema, serviceSchema, servicePatchSchema, settingsSchema } from './schemas';
import { addDays, dateFromDb, dateToDb, isDate, todayIn, toLocal } from './time';

const ctx = (req: Request) => req.client as ClientContext;
const VIEW = { app: 'bookings', permission: 'bookings.view' } as const;
const MANAGE = { app: 'bookings', permission: 'bookings.manage' } as const;
const SETTINGS = { app: 'bookings', permission: 'bookings.settings' } as const;
/** Paid-only branding fields (free: logo, name, instructions, primary color). */
const FULL_BRANDING_FIELDS = ['accentColor', 'backgroundColor', 'theme', 'font', 'buttonStyle'] as const;

/** Time off as the app shows it. */
function timeOffRow(r: { id: number; startDate: Date; endDate: Date; startMinute: number | null; endMinute: number | null; reason: string | null; service: { id: number; name: string } | null }) {
  return { id: r.id, startDate: dateFromDb(r.startDate), endDate: dateFromDb(r.endDate), startMinute: r.startMinute, endMinute: r.endMinute, service: r.service, reason: r.reason };
}

export function bookingRow(b: {
  id: number;
  status: string;
  startsAt: Date;
  endsAt: Date;
  localDate: Date;
  dateOnly: boolean;
  note: string | null;
  source: string;
  createdAt: Date;
  cancelledAt: Date | null;
  cancelledBy: string | null;
  cancelReason: string | null;
  noShowAt?: Date | null;
  checkInCode?: string;
  checkedInAt?: Date | null;
  service: { id: number; name: string };
  customer: { name: string; email: string; phone: string | null };
}) {
  return {
    id: b.id,
    status: b.status,
    startsAt: b.startsAt,
    endsAt: b.endsAt,
    date: dateFromDb(b.localDate),
    dateOnly: b.dateOnly,
    note: b.note,
    source: b.source,
    createdAt: b.createdAt,
    cancelledAt: b.cancelledAt,
    cancelledBy: b.cancelledBy,
    cancelReason: b.cancelReason,
    noShowAt: b.noShowAt ?? null,
    checkInCode: b.checkInCode ? formatCheckInCode(b.checkInCode) : null,
    checkedInAt: b.checkedInAt ?? null,
    service: { id: b.service.id, name: b.service.name },
    customer: b.customer,
  };
}

@Controller('client/bookings')
export class BookingAdminController {
  constructor(
    private readonly db: ClientsDb,
    private readonly engine: BookingEngine,
    private readonly notifications: BookingNotifications,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  private async rules(orgId: string) {
    const loaded = await loadRules(this.db, orgId);
    if (!loaded) throw new ApiError(404, { error: 'not_set_up', message: 'Bookings is not set up for this business yet.' });
    return loaded;
  }

  /** Confirmed upcoming bookings that no longer fit the hours / blocked dates. */
  private async outsideHours(orgId: string) {
    const { rules } = await this.rules(orgId);
    const upcoming = await this.db.booking.findMany({
      where: { organizationId: orgId, status: 'confirmed', endsAt: { gt: new Date() } },
      include: { service: { select: { id: true, name: true } }, customer: { select: { name: true, email: true, phone: true } } },
      orderBy: { startsAt: 'asc' },
      take: 500,
    });
    return upcoming.filter((b) => !fitsHours(rules, { localDate: dateFromDb(b.localDate), startsAt: b.startsAt, endsAt: b.endsAt, dateOnly: b.dateOnly, serviceId: b.serviceId })).map(bookingRow);
  }

  /**
   * The dashboard: bookings from `days` ago to `days` ahead (by appointment date, in the
   * business's time zone). Each booking is one of: attended (checked in), unattended (over, not
   * checked in; no-shows are a part of these), upcoming (not over yet), cancelled.
   */
  @Get('dashboard')
  @ClientRoute(VIEW)
  async dashboard(@Req() req: Request, @Query('days') daysRaw?: string) {
    const c = ctx(req);
    const days = [7, 30, 90, 365].includes(Number(daysRaw)) ? Number(daysRaw) : 30;
    const { rules } = await this.rules(c.org.id);
    const today = todayIn(rules.timeZone);
    const from = addDays(today, -days);
    const to = addDays(today, days);
    const now = new Date();
    const rows = await this.db.booking.findMany({
      where: { organizationId: c.org.id, localDate: { gte: dateToDb(from), lte: dateToDb(to) } },
      select: { id: true, localDate: true, startsAt: true, endsAt: true, dateOnly: true, status: true, checkedInAt: true, noShowAt: true, source: true, serviceId: true, service: { select: { id: true, name: true } }, customer: { select: { name: true } } },
      orderBy: { startsAt: 'asc' },
    });
    type Kind = 'attended' | 'unattended' | 'upcoming' | 'cancelled';
    const kindOf = (b: (typeof rows)[number]): Kind => (b.status === 'cancelled' ? 'cancelled' : b.checkedInAt ? 'attended' : b.endsAt <= now ? 'unattended' : 'upcoming');
    const empty = () => ({ attended: 0, unattended: 0, upcoming: 0, cancelled: 0 });

    // Per day, the whole window (empty days too).
    const byDay = new Map<string, ReturnType<typeof empty>>();
    for (let d = from; d <= to; d = addDays(d, 1)) byDay.set(d, empty());
    const past = { ...empty(), noShows: 0, booked: 0 };
    const future = { booked: 0, upcoming: 0, cancelled: 0 };
    const todayCounts = { ...empty(), booked: 0 };
    const services = new Map<number, { id: number; name: string; booked: number } & ReturnType<typeof empty>>();
    const sources = { public: 0, business: 0 };
    for (const b of rows) {
      const date = dateFromDb(b.localDate);
      const k = kindOf(b);
      byDay.get(date)![k] += 1;
      if (date < today) {
        past[k] += 1;
        past.booked += 1;
        if (b.noShowAt) past.noShows += 1;
      } else if (date === today) {
        todayCounts[k] += 1;
        todayCounts.booked += 1;
      } else {
        future.booked += 1;
        if (k === 'cancelled') future.cancelled += 1;
        else future.upcoming += 1;
      }
      const s = services.get(b.service.id) ?? { id: b.service.id, name: b.service.name, booked: 0, ...empty() };
      s.booked += 1;
      s[k] += 1;
      services.set(b.service.id, s);
      if (b.status !== 'cancelled') sources[b.source === 'business' ? 'business' : 'public'] += 1;
    }
    const decided = past.attended + past.unattended + todayCounts.attended + todayCounts.unattended;
    return {
      days,
      today,
      from,
      to,
      timeZone: rules.timeZone,
      past,
      todayCounts,
      future,
      attendanceRate: decided ? Math.round(((past.attended + todayCounts.attended) / decided) * 100) : null,
      perDay: [...byDay].map(([date, v]) => ({ date, ...v })),
      services: [...services.values()].sort((a, b) => b.booked - a.booked),
      sources,
      todayList: rows
        .filter((b) => dateFromDb(b.localDate) === today)
        .map((b) => ({ id: b.id, startsAt: b.startsAt, dateOnly: b.dateOnly, customer: b.customer.name, service: b.service.name, kind: kindOf(b) })),
    };
  }

  @Get('overview')
  @ClientRoute(VIEW)
  async overview(@Req() req: Request) {
    const c = ctx(req);
    const { settings } = await this.rules(c.org.id);
    const now = new Date();
    const [used, upcoming, today, services] = await Promise.all([
      monthlyUsage(this.db, c.org.id, settings.timeZone),
      this.db.booking.count({ where: { organizationId: c.org.id, status: 'confirmed', endsAt: { gt: now } } }),
      this.db.booking.count({ where: { organizationId: c.org.id, status: 'confirmed', localDate: dateToDb(todayIn(settings.timeZone)) } }),
      this.db.service.count({ where: { organizationId: c.org.id, active: true } }),
    ]);
    return {
      businessName: settings.businessName,
      timeZone: settings.timeZone,
      publicUrl: `${this.cfg.clients.bookingsUrl}/${settings.slug}`,
      usage: { used, limit: limitOf(c.entitlements, 'bookings.monthly') },
      upcoming,
      today,
      services,
      retentionDays: limitOf(c.entitlements, 'bookings.retention_days'),
    };
  }

  // ---- Settings ----

  @Get('settings')
  @ClientRoute(VIEW)
  async getSettings(@Req() req: Request) {
    const c = ctx(req);
    const { settings } = await this.rules(c.org.id);
    const [hours, breaks] = await Promise.all([
      this.db.weeklyHours.findMany({ where: { organizationId: c.org.id }, orderBy: { weekday: 'asc' } }),
      this.db.breakPeriod.findMany({ where: { organizationId: c.org.id }, orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }] }),
    ]);
    const { organizationId: _o, createdAt: _c, ...rest } = settings;
    return {
      settings: rest,
      hours: hours.map(({ weekday, startMinute, endMinute }) => ({ weekday, startMinute, endMinute })),
      breaks: breaks.map(({ weekday, startMinute, endMinute }) => ({ weekday, startMinute, endMinute })),
      publicUrl: `${this.cfg.clients.bookingsUrl}/${settings.slug}`,
      fullBranding: hasFeature(c.entitlements, 'bookings.full_branding'),
      customReminders: hasFeature(c.entitlements, 'bookings.custom_reminders'),
      whatsapp: hasFeature(c.entitlements, 'bookings.whatsapp'),
      whatsappAlerts: hasFeature(c.entitlements, 'bookings.whatsapp_alerts'),
    };
  }

  @Put('settings')
  @ClientRoute(SETTINGS)
  async putSettings(@Req() req: Request, @Body(new YupValidationPipe(settingsSchema)) body: yup.InferType<typeof settingsSchema>) {
    const c = ctx(req);
    const data: Record<string, unknown> = { ...body };
    if (!hasFeature(c.entitlements, 'bookings.full_branding')) for (const f of FULL_BRANDING_FIELDS) delete data[f];
    if ('privateInstructions' in data) data.privateInstructions = cleanInstructions(body.privateInstructions);
    if ('pageInstructions' in data) data.pageInstructions = richInstructions(body.pageInstructions);
    if (body.reminders) {
      const rules = parseReminders(body.reminders);
      const problem = planProblem(rules, c.entitlements);
      if (problem) throw new ApiError(403, { error: 'not_in_plan', message: problem, fields: { reminders: problem } });
      data.reminders = rules;
    }
    if (body.ownerAlerts && Object.values(body.ownerAlerts).some((v) => v?.includes('whatsapp')) && !hasFeature(c.entitlements, 'bookings.whatsapp_alerts')) {
      throw new ApiError(403, { error: 'not_in_plan', message: 'WhatsApp alerts are on paid plans.' });
    }
    if (body.slug) {
      const taken = await this.db.bookingSettings.findFirst({ where: { slug: body.slug, organizationId: { not: c.org.id } } });
      const orgTaken = await this.db.organization.findFirst({ where: { slug: body.slug, id: { not: c.org.id } } });
      if (taken || orgTaken) throw new ApiError(409, { error: 'validation_failed', message: 'That booking link is taken.', fields: { slug: 'That link is taken. Please choose another.' } });
    }
    await this.db.$transaction(async (tx) => {
      await tx.bookingSettings.update({ where: { organizationId: c.org.id }, data });
      if (body.slug || body.businessName) await tx.organization.update({ where: { id: c.org.id }, data: { ...(body.slug && { slug: body.slug }), ...(body.businessName && { name: body.businessName }) } });
    });
    // New rules apply to new bookings only; tell the owner about existing ones that no longer fit.
    return { ...(await this.getSettings(req)), outsideHours: await this.outsideHours(c.org.id) };
  }

  @Put('hours')
  @ClientRoute(SETTINGS)
  async putHours(@Req() req: Request, @Body(new YupValidationPipe(hoursSchema)) body: yup.InferType<typeof hoursSchema>) {
    const c = ctx(req);
    for (const b of body.breaks ?? []) {
      const day = body.hours.find((h) => h.weekday === b.weekday);
      if (!day || b.startMinute < day.startMinute || b.endMinute > day.endMinute) {
        throw new ApiError(400, { error: 'validation_failed', message: 'Each break must be inside that day’s hours.', fields: { breaks: 'Each break must be inside that day’s hours.' } });
      }
    }
    await this.db.$transaction([
      this.db.weeklyHours.deleteMany({ where: { organizationId: c.org.id } }),
      this.db.breakPeriod.deleteMany({ where: { organizationId: c.org.id } }),
      this.db.weeklyHours.createMany({ data: body.hours.map((h) => ({ organizationId: c.org.id, weekday: h.weekday, startMinute: h.startMinute, endMinute: h.endMinute })) }),
      this.db.breakPeriod.createMany({ data: (body.breaks ?? []).map((h) => ({ organizationId: c.org.id, weekday: h.weekday, startMinute: h.startMinute, endMinute: h.endMinute })) }),
    ]);
    return { ok: true, outsideHours: await this.outsideHours(c.org.id) };
  }

  // ---- Blocked dates ----

  @Get('blocked-dates')
  @ClientRoute(VIEW)
  async blocked(@Req() req: Request) {
    const rows = await this.db.blockedDate.findMany({
      where: { organizationId: ctx(req).org.id, endDate: { gte: dateToDb(addDays(new Date().toISOString().slice(0, 10), -1)) } },
      include: { service: { select: { id: true, name: true } } },
      orderBy: [{ startDate: 'asc' }, { startMinute: 'asc' }],
    });
    return rows.map(timeOffRow);
  }

  @Post('blocked-dates')
  @ClientRoute(SETTINGS)
  async block(@Req() req: Request, @Body(new YupValidationPipe(blockedDateSchema)) body: yup.InferType<typeof blockedDateSchema>) {
    const c = ctx(req);
    const startDate = body.startDate;
    const endDate = body.endDate && body.endDate >= startDate ? body.endDate : startDate;
    if (addDays(startDate, 366) < endDate) throw new ApiError(400, { error: 'validation_failed', message: 'Block at most one year at a time.', fields: { endDate: 'At most one year.' } });
    const window = body.startMinute != null && body.endMinute != null ? { startMinute: body.startMinute, endMinute: body.endMinute } : null;
    const serviceId = body.serviceId ?? null;
    if (serviceId && !(await this.db.service.findFirst({ where: { id: serviceId, organizationId: c.org.id }, select: { id: true } }))) {
      throw new ApiError(400, { error: 'validation_failed', message: 'Please choose a service.', fields: { serviceId: 'That service does not exist.' } });
    }
    const { rules } = await this.rules(c.org.id);
    if (window && rules.mode === 'date') {
      throw new ApiError(400, { error: 'validation_failed', message: 'Customers book by day only, so time off is whole days.', fields: { startMinute: 'Whole days only in date-only mode.' } });
    }
    const onDates = await this.db.booking.findMany({
      where: { organizationId: c.org.id, status: 'confirmed', localDate: { gte: dateToDb(startDate), lte: dateToDb(endDate) }, ...(serviceId ? { serviceId } : {}) },
      include: { service: { select: { id: true, name: true } }, customer: { select: { name: true, email: true, phone: true } } },
      orderBy: { startsAt: 'asc' },
    });
    // A time window only conflicts with timed bookings that overlap it (date-only bookings hold no time).
    const conflicts = window
      ? onDates.filter((b) => {
          if (b.dateOnly) return false;
          const start = toLocal(b.startsAt, rules.timeZone).minute;
          const end = start + Math.round((b.endsAt.getTime() - b.startsAt.getTime()) / 60_000);
          return start < window.endMinute && end > window.startMinute;
        })
      : onDates;
    if (conflicts.length && body.existing === 'ask') {
      throw new ApiError(409, { error: 'has_bookings', message: `${conflicts.length} booking(s) already fall on these dates. Keep them, or cancel them and tell the customers?`, conflicts: conflicts.map(bookingRow) });
    }
    const row = await this.db.blockedDate.create({
      data: { organizationId: c.org.id, startDate: dateToDb(startDate), endDate: dateToDb(endDate), startMinute: window?.startMinute ?? null, endMinute: window?.endMinute ?? null, serviceId, reason: body.reason ?? null },
      include: { service: { select: { id: true, name: true } } },
    });
    if (conflicts.length && body.existing === 'cancel') {
      const fallback = window ? 'The business is not available at this time.' : 'The business is closed on this date.';
      for (const b of conflicts) await this.engine.cancel(c.org.id, b.id, { by: 'business', reason: body.reason || fallback, notifyCustomer: true });
    }
    return { ...timeOffRow(row), cancelled: body.existing === 'cancel' ? conflicts.length : 0 };
  }

  @Delete('blocked-dates/:id')
  @ClientRoute(SETTINGS)
  async unblock(@Req() req: Request, @Param('id', ParseIntPipe) id: number) {
    const { count } = await this.db.blockedDate.deleteMany({ where: { id, organizationId: ctx(req).org.id } });
    if (!count) throw new ApiError(404, { error: 'not_found', message: 'That blocked date does not exist.' });
    return { ok: true };
  }

  // ---- Services ----

  @Get('services')
  @ClientRoute(VIEW)
  async services(@Req() req: Request) {
    const c = ctx(req);
    const rows = await this.db.service.findMany({ where: { organizationId: c.org.id }, orderBy: [{ active: 'desc' }, { position: 'asc' }, { id: 'asc' }] });
    return { services: rows, limit: limitOf(c.entitlements, 'bookings.services') };
  }

  private async assertServiceRoom(c: ClientContext, excludeId?: number) {
    const limit = limitOf(c.entitlements, 'bookings.services');
    if (limit === null) return;
    const active = await this.db.service.count({ where: { organizationId: c.org.id, active: true, ...(excludeId ? { id: { not: excludeId } } : {}) } });
    if (active >= limit) throw new ApiError(403, { error: 'not_in_plan', message: `The free plan includes ${limit} active services. Upgrade for unlimited services.` });
  }

  @Post('services')
  @HttpCode(201)
  @ClientRoute(SETTINGS)
  async createService(@Req() req: Request, @Body(new YupValidationPipe(serviceSchema)) body: yup.InferType<typeof serviceSchema>) {
    const c = ctx(req);
    if (body.active !== false) await this.assertServiceRoom(c);
    const position = body.position ?? (await this.db.service.count({ where: { organizationId: c.org.id } }));
    return this.db.service.create({ data: { ...body, position, instructions: cleanInstructions(body.instructions), organizationId: c.org.id } });
  }

  @Patch('services/:id')
  @ClientRoute(SETTINGS)
  async updateService(@Req() req: Request, @Param('id', ParseIntPipe) id: number, @Body(new YupValidationPipe(servicePatchSchema)) body: yup.InferType<typeof servicePatchSchema>) {
    const c = ctx(req);
    const svc = await this.db.service.findFirst({ where: { id, organizationId: c.org.id } });
    if (!svc) throw new ApiError(404, { error: 'not_found', message: 'That service does not exist.' });
    if (body.active === true && !svc.active) await this.assertServiceRoom(c, id);
    const data: Record<string, unknown> = { ...body };
    if ('instructions' in body) data.instructions = cleanInstructions(body.instructions);
    return this.db.service.update({ where: { id }, data });
  }

  /** Services with bookings are archived (hidden), not deleted, so past bookings keep their service. */
  @Delete('services/:id')
  @ClientRoute(SETTINGS)
  async deleteService(@Req() req: Request, @Param('id', ParseIntPipe) id: number) {
    const c = ctx(req);
    const svc = await this.db.service.findFirst({ where: { id, organizationId: c.org.id } });
    if (!svc) throw new ApiError(404, { error: 'not_found', message: 'That service does not exist.' });
    const used = await this.db.booking.count({ where: { serviceId: id } });
    if (used) {
      await this.db.service.update({ where: { id }, data: { active: false } });
      return { ok: true, archived: true };
    }
    await this.db.service.delete({ where: { id } });
    return { ok: true, archived: false };
  }

  // ---- Bookings ----

  @Get('items')
  @ClientRoute(VIEW)
  async list(@Req() req: Request, @Query('view') view = 'upcoming', @Query('from') from?: string, @Query('to') to?: string) {
    const c = ctx(req);
    const now = new Date();
    const where: Record<string, unknown> = { organizationId: c.org.id };
    if (view === 'upcoming') Object.assign(where, { status: 'confirmed', endsAt: { gt: now } });
    else if (view === 'past') Object.assign(where, { status: 'confirmed', endsAt: { lte: now } });
    else if (view === 'cancelled') Object.assign(where, { status: 'cancelled' });
    // Over, and nobody checked the customer in.
    else if (view === 'unattended') Object.assign(where, { status: 'confirmed', endsAt: { lte: now }, checkedInAt: null });
    if (isDate(from) || isDate(to)) where.localDate = { ...(isDate(from) && { gte: dateToDb(from) }), ...(isDate(to) && { lte: dateToDb(to) }) };
    const rows = await this.db.booking.findMany({
      where,
      include: { service: { select: { id: true, name: true } }, customer: { select: { name: true, email: true, phone: true } } },
      orderBy: { startsAt: view === 'upcoming' ? 'asc' : 'desc' },
      take: 300,
    });
    return rows.map(bookingRow);
  }

  /** Every booking as CSV (owners and admins), e.g. before free-plan deletion. */
  @Get('export.csv')
  @ClientRoute(SETTINGS)
  async exportCsv(@Req() req: Request, @Res() res: Response) {
    const { filename, csv } = await csvFor(this.db, ctx(req).org.id);
    res.status(200).set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename}"`, 'Cache-Control': 'no-store' }).send(csv);
  }

  @Post('items')
  @HttpCode(201)
  @ClientRoute(MANAGE)
  async add(@Req() req: Request, @Body(new YupValidationPipe(bookSchema)) body: yup.InferType<typeof bookSchema>) {
    const b = await this.engine.create({
      organizationId: ctx(req).org.id,
      serviceId: body.serviceId,
      startsAt: body.startsAt ?? undefined,
      date: body.date ?? undefined,
      customer: { name: body.name, email: body.email, phone: body.phone },
      note: body.note,
      source: 'business',
    });
    return { id: b.id };
  }

  @Post('items/:id/cancel')
  @HttpCode(200)
  @ClientRoute(MANAGE)
  cancel(@Req() req: Request, @Param('id', ParseIntPipe) id: number, @Body(new YupValidationPipe(cancelSchema)) body: yup.InferType<typeof cancelSchema>) {
    return this.engine.cancel(ctx(req).org.id, id, { by: 'business', reason: body.reason, notifyCustomer: body.notify });
  }

  /** Mark (or unmark) a past booking as a no-show; the customer gets a follow-up if enabled. */
  /**
   * Attendance. Checks the customer in when the booking is today and not over. Otherwise it says
   * why (another day, over, cancelled, already checked in) and checks in only with `force`; the
   * Check-in page then offers to move the booking or book it again for today.
   */
  @Post('check-in')
  @HttpCode(200)
  @ClientRoute(MANAGE)
  async checkIn(@Req() req: Request, @Body(new YupValidationPipe(checkInSchema)) body: yup.InferType<typeof checkInSchema>) {
    const c = ctx(req);
    const code = body.code ? parseCheckInCode(body.code) : null;
    if (!body.id && !code) throw new ApiError(400, { error: 'validation_failed', message: 'That is not a check-in code. Codes have 8 letters and numbers, like ABCD-EFGH.', fields: { code: 'Please check the code.' } });
    const b = await this.db.booking.findFirst({
      where: { organizationId: c.org.id, ...(body.id ? { id: body.id } : { checkInCode: code! }) },
      include: { service: { select: { id: true, name: true } }, customer: { select: { name: true, email: true, phone: true } } },
    });
    if (!b) {
      // Event registrations are checked in on their event's own scanner.
      const ticket = code ? await this.db.eventTicket.findFirst({ where: { organizationId: c.org.id, code }, include: { event: { select: { id: true, title: true } } } }) : null;
      if (ticket) throw new ApiError(409, { error: 'event_code', message: `This code is a registration for the event “${ticket.event.title}”. Check it in on that event’s scanner.`, event: ticket.event });
      throw new ApiError(404, { error: 'not_found', message: 'No booking matches this code.' });
    }
    const { rules } = await this.rules(c.org.id);
    const today = todayIn(rules.timeZone);
    const now = new Date();
    const date = dateFromDb(b.localDate);
    const over = date < today || (date === today && !b.dateOnly && b.endsAt <= now);
    const state = b.status === 'cancelled' ? 'cancelled' : b.checkedInAt ? 'already' : date > today ? 'other_day' : over ? 'expired' : 'ok';
    let row = b;
    if (state === 'ok' || (body.force && (state === 'other_day' || state === 'expired'))) {
      row = await this.db.booking.update({
        where: { id: b.id },
        data: { checkedInAt: now, checkedInBy: c.user.id, noShowAt: null },
        include: { service: { select: { id: true, name: true } }, customer: { select: { name: true, email: true, phone: true } } },
      });
      logger.info({ org: c.org.id, bookingId: b.id, state }, 'Client booking checked in');
    }
    return { state, checkedIn: !!row.checkedInAt && row.checkedInAt.getTime() === now.getTime(), today, booking: bookingRow(row) };
  }

  @Post('items/:id/check-in/undo')
  @HttpCode(200)
  @ClientRoute(MANAGE)
  async undoCheckIn(@Req() req: Request, @Param('id', ParseIntPipe) id: number) {
    const { count } = await this.db.booking.updateMany({ where: { id, organizationId: ctx(req).org.id }, data: { checkedInAt: null, checkedInBy: null } });
    if (!count) throw new ApiError(404, { error: 'not_found', message: 'That booking does not exist.' });
    return { ok: true };
  }

  @Post('items/:id/no-show')
  @HttpCode(200)
  @ClientRoute(MANAGE)
  async noShow(@Req() req: Request, @Param('id', ParseIntPipe) id: number, @Body(new YupValidationPipe(noShowSchema)) body: yup.InferType<typeof noShowSchema>) {
    const c = ctx(req);
    const b = await this.db.booking.findFirst({ where: { id, organizationId: c.org.id } });
    if (!b || b.status !== 'confirmed') throw new ApiError(404, { error: 'not_found', message: 'That booking does not exist.' });
    if (b.startsAt > new Date()) throw new ApiError(409, { error: 'not_started', message: 'A booking can be marked as a no-show once it has started.' });
    const settings = await this.db.bookingSettings.findUniqueOrThrow({ where: { organizationId: c.org.id } });
    await this.db.$transaction(async (tx) => {
      await tx.booking.update({ where: { id }, data: { noShowAt: body.noShow ? new Date() : null } });
      if (body.noShow && !b.noShowAt && settings.noShowFollowUp) await this.notifications.queueNoShow(tx, id);
    });
    this.notifications.kick();
    return { ok: true };
  }

  @Post('items/:id/reschedule')
  @HttpCode(200)
  @ClientRoute(MANAGE)
  async reschedule(@Req() req: Request, @Param('id', ParseIntPipe) id: number, @Body(new YupValidationPipe(rescheduleSchema)) body: yup.InferType<typeof rescheduleSchema>) {
    const r = await this.engine.reschedule(ctx(req).org.id, id, { startsAt: body.startsAt ?? undefined, date: body.date ?? undefined }, 'business');
    return { ok: true, changed: r.changed };
  }

  @Get('availability')
  @ClientRoute(VIEW)
  async availability(@Req() req: Request, @Query('serviceId', ParseIntPipe) serviceId: number, @Query('from') from?: string, @Query('to') to?: string, @Query('exclude') exclude?: string) {
    const c = ctx(req);
    const { rules } = await this.rules(c.org.id);
    const service = await this.db.service.findFirst({ where: { id: serviceId, organizationId: c.org.id } });
    if (!service) throw new ApiError(404, { error: 'not_found', message: 'That service does not exist.' });
    const start = isDate(from) ? from : todayIn(rules.timeZone);
    const end = isDate(to) && to >= start ? to : addDays(start, 30);
    const occupied = await occupiedBetween(this.db, c.org.id, start, end, exclude ? Number(exclude) || undefined : undefined);
    return { timeZone: rules.timeZone, mode: rules.mode, days: rangeAvailability(rules, service, start, end, occupied) };
  }
}
