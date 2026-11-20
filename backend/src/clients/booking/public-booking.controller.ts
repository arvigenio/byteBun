// Public booking pages (bookings.bytebuntech.com/{slug}) and the customer's manage link. No login.
// Only public details leave here: meeting links, gate codes and private instructions are sent
// in the confirmation email only.
//
//   GET  /api/public/bookings/:slug                                    the page
//   GET  /api/public/bookings/:slug/availability?serviceId&from&to     days + slots
//   POST /api/public/bookings/:slug/book                               -> { ok, booking }
//
//   (header X-Booking-Token: the token from the link's #t=...)
//   GET  /api/public/manage-booking
//   GET  /api/public/manage-booking/availability?from&to
//   POST /api/public/manage-booking/reschedule  { startsAt | date }
//   POST /api/public/manage-booking/cancel
//
// Spam protection: per-IP rate limits on every write (and the api limit on reads), plus a hidden
// honeypot field.
import { Body, Controller, Get, Header, HttpCode, Inject, Param, ParseIntPipe, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import type * as yup from 'yup';
import { ApiError } from '../../common/api-error';
import { StrictRateLimit } from '../../common/rate-limit';
import { YupValidationPipe } from '../../common/yup-validation.pipe';
import { ClientsDb } from '../clients-db';
import { orgStatus } from '../client-context';
import { hasFeature, limitOf, loadEntitlements } from '../entitlements';
import { BookingEngine, errors, loadRules, monthlyUsage, occupiedBetween } from './booking-engine';
import { MANAGE_TOKENS } from './notifications';
import type { ManageTokens } from './manage-token';
import { rangeAvailability } from './schedule';
import { bookSchema, rescheduleSchema } from './schemas';
import { addDays, dateFromDb, isDate, todayIn } from './time';

const invalidLink = () => new ApiError(404, { error: 'invalid_link', message: 'This link is not valid any more. Please use the link in your latest email.' });

@Controller('public')
export class PublicBookingController {
  constructor(
    private readonly db: ClientsDb,
    private readonly engine: BookingEngine,
    @Inject(MANAGE_TOKENS) private readonly tokens: ManageTokens,
  ) {}

  /** The business behind a slug, and whether it takes online bookings right now. */
  private async business(slug: string) {
    if (!/^[a-z0-9-]{3,60}$/.test(slug)) throw errors.notFound();
    const settings = await this.db.bookingSettings.findUnique({ where: { slug } });
    if (!settings) throw errors.notFound();
    const loaded = await loadRules(this.db, settings.organizationId);
    const ents = await loadEntitlements(this.db, settings.organizationId);
    const sub = await this.db.subscription.findUnique({ where: { organizationId: settings.organizationId }, select: { status: true } });
    let status: 'open' | 'unavailable' | 'month_full' = 'open';
    if ((await orgStatus(this.db, settings.organizationId)) !== 'active' || sub?.status !== 'active' || !ents.apps.includes('bookings')) status = 'unavailable';
    else {
      const cap = limitOf(ents, 'bookings.monthly');
      if (cap !== null && (await monthlyUsage(this.db, settings.organizationId, settings.timeZone)) >= cap) status = 'month_full';
    }
    return { settings, rules: loaded!.rules, ents, status };
  }

  @Get('bookings/:slug')
  @Header('Cache-Control', 'no-store')
  async page(@Param('slug') slug: string) {
    const { settings: s, ents, status } = await this.business(slug);
    const full = hasFeature(ents, 'bookings.full_branding');
    const services =
      status === 'unavailable'
        ? []
        : await this.db.service.findMany({
            where: { organizationId: s.organizationId, active: true },
            orderBy: [{ position: 'asc' }, { id: 'asc' }],
            select: { id: true, name: true, description: true, durationMinutes: true, locationType: true, address: true },
          });
    return {
      status,
      business: {
        name: s.businessName,
        slug: s.slug,
        timeZone: s.timeZone,
        mode: s.mode,
        instructions: s.pageInstructions,
        phone: s.phone,
        windowDays: s.windowDays,
      },
      branding: {
        primaryColor: s.primaryColor,
        accentColor: full ? s.accentColor : null,
        backgroundColor: full ? s.backgroundColor : null,
        theme: full ? s.theme : 'light',
        font: full ? s.font : 'system',
        buttonStyle: full ? s.buttonStyle : 'rounded',
        poweredBy: !full,
      },
      services,
    };
  }

  @Get('bookings/:slug/availability')
  @Header('Cache-Control', 'no-store')
  async availability(@Param('slug') slug: string, @Query('serviceId', ParseIntPipe) serviceId: number, @Query('from') from?: string, @Query('to') to?: string) {
    const { settings, rules, status } = await this.business(slug);
    if (status === 'unavailable') throw errors.closedForBooking();
    const service = await this.db.service.findFirst({ where: { id: serviceId, organizationId: settings.organizationId, active: true } });
    if (!service) throw errors.serviceGone();
    const start = isDate(from) ? from : todayIn(rules.timeZone);
    const end = isDate(to) && to >= start ? (to > addDays(start, 41) ? addDays(start, 41) : to) : addDays(start, 30);
    const occupied = await occupiedBetween(this.db, settings.organizationId, start, end);
    const days = status === 'month_full' ? [] : rangeAvailability(rules, service, start, end, occupied);
    return { timeZone: rules.timeZone, mode: rules.mode, status, days };
  }

  @Post('bookings/:slug/book')
  @HttpCode(201)
  @StrictRateLimit()
  async book(@Param('slug') slug: string, @Body(new YupValidationPipe(bookSchema)) body: yup.InferType<typeof bookSchema>) {
    const { settings, status } = await this.business(slug);
    if (status === 'unavailable') throw errors.closedForBooking();
    if (status === 'month_full') throw errors.monthly();
    // Honeypot filled: pretend it worked, store nothing.
    if (body.website) return { ok: true, booking: null };
    const b = await this.engine.create({
      organizationId: settings.organizationId,
      serviceId: body.serviceId,
      startsAt: body.startsAt ?? undefined,
      date: body.date ?? undefined,
      customer: { name: body.name, email: body.email, phone: body.phone },
      note: body.note,
      source: 'public',
    });
    return { ok: true, booking: { id: b.id, startsAt: b.startsAt, date: dateFromDb(b.localDate), dateOnly: b.dateOnly } };
  }

  // ---- The customer's manage link ----

  private async fromToken(req: Request) {
    const parsed = this.tokens.parse(req.headers['x-booking-token']);
    if (!parsed) throw invalidLink();
    const b = await this.db.booking.findUnique({ where: { id: parsed.id }, include: { service: true, customer: true } });
    if (!b || !this.tokens.verify(b.id, parsed.signature, b.manageNonce)) throw invalidLink();
    const settings = await this.db.bookingSettings.findUniqueOrThrow({ where: { organizationId: b.organizationId } });
    const active = (await orgStatus(this.db, b.organizationId)) === 'active';
    const now = Date.now();
    const over = (b.dateOnly ? b.endsAt.getTime() : b.startsAt.getTime()) <= now;
    const cutoff = settings.changeCutoffHours && !b.dateOnly ? b.startsAt.getTime() - settings.changeCutoffHours * 3_600_000 : null;
    // Links stop working after the appointment or once it is cancelled.
    if (b.status !== 'confirmed' || over) {
      return { b, settings, state: b.status === 'cancelled' ? ('cancelled' as const) : ('over' as const) };
    }
    if (!active) return { b, settings, state: 'unavailable' as const };
    if (cutoff !== null && now >= cutoff) return { b, settings, state: 'cutoff' as const };
    return { b, settings, state: 'changeable' as const };
  }

  @Get('manage-booking')
  @Header('Cache-Control', 'no-store')
  @Header('X-Robots-Tag', 'noindex, nofollow')
  async manage(@Req() req: Request) {
    const { b, settings: s, state } = await this.fromToken(req);
    const ents = await loadEntitlements(this.db, b.organizationId);
    return {
      state,
      business: { name: s.businessName, slug: s.slug, phone: s.phone, timeZone: s.timeZone, mode: s.mode, changeCutoffHours: s.changeCutoffHours },
      branding: { primaryColor: s.primaryColor, poweredBy: !hasFeature(ents, 'bookings.full_branding') },
      booking: {
        status: b.status,
        startsAt: b.startsAt,
        endsAt: b.endsAt,
        date: dateFromDb(b.localDate),
        dateOnly: b.dateOnly,
        service: { id: b.service.id, name: b.service.name, durationMinutes: b.service.durationMinutes, locationType: b.service.locationType, address: b.service.address },
        customerName: b.customer.name,
      },
    };
  }

  private async changeable(req: Request) {
    const r = await this.fromToken(req);
    if (r.state === 'cutoff') {
      throw new ApiError(409, { error: 'cutoff', message: r.settings.phone ? `It's too close to the appointment to change it online. Please call ${r.settings.phone}.` : "It's too close to the appointment to change it online. Please call the business." });
    }
    if (r.state !== 'changeable') throw invalidLink();
    return r;
  }

  @Get('manage-booking/availability')
  @Header('Cache-Control', 'no-store')
  async manageAvailability(@Req() req: Request, @Query('from') from?: string, @Query('to') to?: string) {
    const { b } = await this.changeable(req);
    const loaded = await loadRules(this.db, b.organizationId);
    const rules = loaded!.rules;
    const start = isDate(from) ? from : todayIn(rules.timeZone);
    const end = isDate(to) && to >= start ? (to > addDays(start, 41) ? addDays(start, 41) : to) : addDays(start, 30);
    // Its own place doesn't count against it.
    const occupied = await occupiedBetween(this.db, b.organizationId, start, end, b.id);
    return { timeZone: rules.timeZone, mode: rules.mode, days: rangeAvailability(rules, b.service, start, end, occupied) };
  }

  @Post('manage-booking/reschedule')
  @HttpCode(200)
  @StrictRateLimit()
  async reschedule(@Req() req: Request, @Body(new YupValidationPipe(rescheduleSchema)) body: yup.InferType<typeof rescheduleSchema>) {
    const { b } = await this.changeable(req);
    const r = await this.engine.reschedule(b.organizationId, b.id, { startsAt: body.startsAt ?? undefined, date: body.date ?? undefined }, 'customer');
    return { ok: true, changed: r.changed, booking: { startsAt: r.booking.startsAt, date: dateFromDb(r.booking.localDate) } };
  }

  @Post('manage-booking/cancel')
  @HttpCode(200)
  @StrictRateLimit()
  async cancel(@Req() req: Request) {
    const { b } = await this.changeable(req);
    return this.engine.cancel(b.organizationId, b.id, { by: 'customer' });
  }
}
