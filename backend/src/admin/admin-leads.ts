// Admin views of leads and booked calls (read, edit, export, calendar, book, move, free a slot).
// Every route here is under /api/admin, so AdminSessionGuard protects it.
import { Body, Controller, Delete, Get, Header, HttpCode, Injectable, Param, ParseIntPipe, Patch, Post, Query, Req, Res } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import * as yup from 'yup';
import { ApiError } from '../common/api-error';
import { YupValidationPipe } from '../common/yup-validation.pipe';
import { BookingChangesService } from '../booking/booking-changes';
import { BookingService } from '../booking/booking.service';
import { PrismaService } from '../database/prisma.service';
import type { ChangeSource } from '../leads/lead-emails';
import { type AdminBookingInput, adminBookingSchema } from '../leads/lead.schema';
import { LeadsService } from '../leads/leads.service';
import { AdminEvents } from '../realtime/admin-events';
import { MemoryCache } from '../realtime/memory-cache';
import { CHANNELS, describeOrigin, ORIGINS } from '../leads/attribution';
import { FEATURE_KEYS, FEATURES, featureLabel, GOAL_KEYS, GOALS, goalLabel, OTHER_GOAL } from '../leads/lead-options';

const CACHE_TTL_MS = 30_000;
/** The "Came from" filter: a channel or an origin (src/leads/attribution.ts); "unknown" = not recorded. */
const LEAD_FROM = [...CHANNELS, ...ORIGINS, 'unknown'] as const;

export const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'won', 'lost', 'spam'] as const;

const listQuerySchema = yup.object({
  q: yup.string().trim().max(100).default(''),
  status: yup.string().oneOf(['', ...LEAD_STATUSES]).default(''),
  // Where the booking came from: a channel (web_form, chatbot) or an origin (social, search, ...).
  from: yup.string().oneOf(['', ...LEAD_FROM]).default(''),
  page: yup.number().integer().min(1).max(10_000).default(1),
  pageSize: yup.number().integer().min(1).max(100).default(25),
});
type ListQuery = yup.InferType<typeof listQuerySchema>;

const emptyToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);
const notBlank = (label: string, max: number) =>
  yup
    .string()
    .trim()
    .test('not-blank', `Please enter ${label}.`, (v) => v === undefined || v.length > 0)
    .max(max, `This is too long (${max} characters max).`);

// PATCH /api/admin/leads/:id. Every field is optional: only the fields sent are changed.
// Same limits and messages as the public form (src/leads/lead.schema.ts).
// Mirrored by frontend/src/lib/adminSchemas.js (leadEditSchema).
const updateSchema = yup.object({
  firstName: notBlank('a first name', 50),
  lastName: notBlank('a last name', 50),
  email: yup.string().trim().lowercase().max(254, 'Email is too long.').email('Please enter a valid email address, like name@example.com.'),
  phone: yup
    .string()
    .transform(emptyToNull)
    .nullable()
    .trim()
    .max(40, 'Phone number is too long.')
    .matches(/^[0-9+()\-.\s]{6,40}$/, { message: 'Please enter a valid phone number, or leave it empty.', excludeEmptyString: true }),
  businessName: yup.string().transform(emptyToNull).nullable().trim().max(160, 'Business name is too long (160 characters max).'),
  // May be empty: calls booked by an admin often start without a type or goals.
  businessType: yup.string().trim().max(80, 'This is too long (80 characters max).'),
  goals: yup.array(yup.string().required().oneOf(GOAL_KEYS, 'Please choose from the listed goals.')).default(undefined),
  goalsOther: yup
    .string()
    .transform(emptyToNull)
    .nullable()
    .trim()
    .max(200, 'This is too long (200 characters max).')
    .when('goals', { is: (g?: string[]) => g?.includes(OTHER_GOAL), then: (s) => s.required('Please describe the "Other" goal.') }),
  features: yup.array(yup.string().required().oneOf(FEATURE_KEYS, 'Please choose from the listed features.')).default(undefined),
  message: yup.string().transform(emptyToNull).nullable().trim().max(2000, 'Message is too long (2,000 characters max).'),
  status: yup.string().oneOf([...LEAD_STATUSES], 'Choose a valid status.'),
});
type LeadUpdate = yup.InferType<typeof updateSchema>;

const MAX_RANGE_DAYS = 62;
const bookingsQuerySchema = yup.object({
  when: yup.string().oneOf(['upcoming', 'past']).default('upcoming'),
  // Calendar view: every booking with from <= startsAt < to (overrides `when`).
  from: yup.date().typeError('Invalid date.'),
  to: yup
    .date()
    .typeError('Invalid date.')
    .when('from', ([from], s) =>
      from
        ? s
            .required('Give both from and to.')
            .min(from, 'to must be after from.')
            .test('range', `At most ${MAX_RANGE_DAYS} days at a time.`, (to) => !to || to.getTime() - from.getTime() <= MAX_RANGE_DAYS * 86_400_000)
        : s,
    ),
});
type BookingsQuery = yup.InferType<typeof bookingsQuerySchema>;

const parseKeys = (json: string | null): string[] => {
  try {
    const v: unknown = JSON.parse(json ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
};

const leadInclude = { booking: { select: { id: true, startsAt: true, timeZone: true } } } satisfies Prisma.LeadInclude;
type LeadRow = Prisma.LeadGetPayload<{ include: typeof leadInclude }>;

function present(lead: LeadRow) {
  const { goals, goalsOther, features, ...rest } = lead;
  const goalKeys = parseKeys(goals);
  const featureKeys = parseKeys(features);
  return {
    ...rest,
    // Readable labels (lists, CSV) ...
    goals: goalKeys.map((k) => (k === OTHER_GOAL && goalsOther ? `Other: ${goalsOther}` : goalLabel(k))),
    features: featureKeys.map(featureLabel),
    // ... and the raw values, for the edit form.
    goalKeys,
    featureKeys,
    goalsOther,
  };
}

// Spreadsheet apps run cells that start with = + - @ as formulas; prefix them so they stay text.
const csvCell = (v: unknown) => {
  let s = v == null ? '' : v instanceof Date ? v.toISOString() : Array.isArray(v) ? v.join('; ') : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

@Injectable()
export class AdminLeadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: MemoryCache,
    private readonly events: AdminEvents,
    private readonly changes: BookingChangesService,
  ) {}

  private where({ q, status, from }: Pick<ListQuery, 'q' | 'status' | 'from'>): Prisma.LeadWhereInput {
    const where: Prisma.LeadWhereInput = {};
    if (status) where.status = status;
    if (from === 'unknown') where.origin = null;
    else if ((CHANNELS as readonly string[]).includes(from)) where.channel = from;
    else if (from) where.origin = from;
    if (q) {
      where.OR = ['firstName', 'lastName', 'email', 'businessName', 'phone'].map((field) => ({
        [field]: { contains: q, mode: 'insensitive' },
      }));
    }
    return where;
  }

  // Reads are cached for a short time and dropped on every change (realtime/admin-events.ts),
  // so a second admin, or a refresh, never sees stale data.
  list(query: ListQuery) {
    return this.cache.getOrSet('leads', `list:${JSON.stringify(query)}`, CACHE_TTL_MS, () => this.loadList(query));
  }

  private async loadList(query: ListQuery) {
    const where = this.where(query);
    const [total, rows, sources] = await Promise.all([
      this.prisma.lead.count({ where }),
      this.prisma.lead.findMany({
        where,
        include: leadInclude,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.sources(query),
    ]);
    return { items: rows.map(present), total, page: query.page, pageSize: query.pageSize, statuses: LEAD_STATUSES, sources };
  }

  /**
   * Where the leads matching the search and status came from (the "Came from" filter is left out,
   * so the numbers stay put while it changes): per channel, per origin, and per platform or site.
   */
  private async sources(query: Pick<ListQuery, 'q' | 'status'>) {
    const where = this.where({ ...query, from: '' });
    const [channels, origins] = await Promise.all([
      this.prisma.lead.groupBy({ by: ['channel'], where, _count: { _all: true } }),
      this.prisma.lead.groupBy({ by: ['origin', 'originDetail'], where, _count: { _all: true } }),
    ]);
    const byOrigin: Record<string, { count: number; details: { name: string; count: number }[] }> = {};
    for (const o of origins) {
      const key = o.origin ?? 'unknown';
      const entry = (byOrigin[key] ??= { count: 0, details: [] });
      entry.count += o._count._all;
      if (o.originDetail) entry.details.push({ name: o.originDetail, count: o._count._all });
    }
    for (const e of Object.values(byOrigin)) e.details.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
    return {
      channels: Object.fromEntries(channels.map((c) => [c.channel, c._count._all])),
      origins: byOrigin,
    };
  }

  get(id: number) {
    return this.cache.getOrSet('leads', `id:${id}`, CACHE_TTL_MS, async () => {
      const lead = await this.prisma.lead.findUnique({ where: { id }, include: leadInclude });
      if (!lead) throw new ApiError(404, { error: 'not_found', message: 'That lead does not exist.' });
      return present(lead);
    });
  }

  /** Changes only the fields given. The booked call itself is changed on the Bookings page. */
  async update(id: number, input: LeadUpdate) {
    const data: Prisma.LeadUpdateInput = {};
    for (const key of ['firstName', 'lastName', 'email', 'phone', 'businessName', 'businessType', 'message', 'status'] as const) {
      if (input[key] !== undefined) (data as Record<string, unknown>)[key] = input[key];
    }
    if (input.goals !== undefined) {
      data.goals = JSON.stringify([...new Set(input.goals)]);
      data.goalsOther = input.goals.includes(OTHER_GOAL) ? (input.goalsOther ?? null) : null;
    } else if (input.goalsOther !== undefined) {
      data.goalsOther = input.goalsOther;
    }
    if (input.features !== undefined) data.features = JSON.stringify([...new Set(input.features)]);
    if (!Object.keys(data).length) return this.get(id);

    try {
      const lead = await this.prisma.lead.update({ where: { id }, data, include: leadInclude });
      this.events.leadUpdated({ id: lead.id, firstName: lead.firstName, lastName: lead.lastName, businessName: lead.businessName });
      return present(lead);
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        throw new ApiError(404, { error: 'not_found', message: 'That lead does not exist.' });
      }
      throw err;
    }
  }

  async exportCsv(query: Pick<ListQuery, 'q' | 'status' | 'from'>): Promise<string> {
    const rows = await this.prisma.lead.findMany({ where: this.where(query), include: leadInclude, orderBy: { createdAt: 'desc' }, take: 50_000 });
    const header = ['id', 'created_at', 'status', 'first_name', 'last_name', 'email', 'phone', 'business_name', 'business_type', 'goals', 'features', 'message', 'came_from', 'channel', 'origin', 'origin_detail', 'utm_source', 'utm_medium', 'utm_campaign', 'referrer', 'landing_page', 'form_opened_from', 'call_starts_at', 'call_time_zone'];
    const lines = rows.map(present).map((l) =>
      [l.id, l.createdAt, l.status, l.firstName, l.lastName, l.email, l.phone, l.businessName, l.businessType, l.goals, l.features, l.message, describeOrigin(l), l.channel, l.origin, l.originDetail, l.utmSource, l.utmMedium, l.utmCampaign, l.referrerHost, l.landingPath, l.source, l.booking?.startsAt, l.booking?.timeZone]
        .map(csvCell)
        .join(','),
    );
    return `﻿${[header.join(','), ...lines].join('\r\n')}\r\n`; // BOM so Excel reads UTF-8
  }

  bookings(query: BookingsQuery) {
    const key = JSON.stringify({ when: query.when, from: query.from?.toISOString(), to: query.to?.toISOString() });
    // "upcoming"/"past" depend on the current time, so they are cached for less.
    return this.cache.getOrSet('bookings', key, query.from ? CACHE_TTL_MS : 10_000, () => this.loadBookings(query));
  }

  private async loadBookings({ when, from, to }: BookingsQuery) {
    const now = new Date();
    const range = from && to;
    const rows = await this.prisma.booking.findMany({
      where: range ? { startsAt: { gte: from, lt: to } } : when === 'upcoming' ? { startsAt: { gte: now } } : { startsAt: { lt: now } },
      orderBy: { startsAt: range || when === 'upcoming' ? 'asc' : 'desc' },
      take: 500,
      include: { lead: { select: { id: true, firstName: true, lastName: true, email: true, phone: true, businessName: true, status: true } } },
    });
    return { items: rows };
  }

  private async leadIdOf(bookingId: number): Promise<number> {
    const b = await this.prisma.booking.findUnique({ where: { id: bookingId }, select: { leadId: true } });
    if (!b) throw new ApiError(404, { error: 'not_found', message: 'That booking does not exist any more (it may have just been cancelled).' });
    return b.leadId;
  }

  /** Moves a call (admin). The lead and the other admins are emailed; everyone's calendar updates live. */
  async reschedule(bookingId: number, startsAt: Date, src: ChangeSource) {
    const { booking } = await this.changes.reschedule(await this.leadIdOf(bookingId), startsAt, src);
    return { ok: true, booking: { id: booking.id, startsAt: booking.startsAt, timeZone: booking.timeZone } };
  }

  /** Cancels a call (admin): frees its slot, keeps the lead. The lead and the other admins are emailed. */
  async cancel(bookingId: number, src: ChangeSource) {
    return this.changes.cancel(await this.leadIdOf(bookingId), src);
  }
}

const noteSchema = yup.string().transform(emptyToNull).nullable().trim().max(1000, 'The note is too long (1,000 characters max).');
const rescheduleSchema = yup.object({
  startsAt: yup.date().typeError('Choose a new time.').required('Choose a new time.'),
  note: noteSchema,
});
const cancelSchema = yup.object({ note: noteSchema });

const actor = (req: Request): NonNullable<ChangeSource['actor']> => ({ name: req.admin!.user.name || req.admin!.user.email, email: req.admin!.user.email });

@Controller('admin/leads')
export class AdminLeadsController {
  constructor(private readonly leads: AdminLeadsService) {}

  // GET /api/admin/leads?q=&status=&from=&page=&pageSize=
  //   -> { items, total, page, pageSize, statuses, sources: { channels: { web_form: n, chatbot: n },
  //        origins: { social: { count, details: [{ name: 'Facebook', count }] }, ... } } }
  @Get()
  @Header('Cache-Control', 'no-store')
  list(@Query(new YupValidationPipe(listQuerySchema)) query: ListQuery) {
    return this.leads.list(query);
  }

  // GET /api/admin/leads/export.csv?q=&status=&from=
  @Get('export.csv')
  async export(@Query(new YupValidationPipe(listQuerySchema)) query: ListQuery, @Res() res: Response) {
    const csv = await this.leads.exportCsv(query);
    res
      .status(200)
      .set({
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="bytebun-leads-${new Date().toISOString().slice(0, 10)}.csv"`,
        'Cache-Control': 'no-store',
      })
      .send(csv);
  }

  // GET /api/admin/leads/options -> the choices for the edit form (same keys as the public form)
  @Get('options')
  @Header('Cache-Control', 'no-store')
  options() {
    return { statuses: LEAD_STATUSES, goals: GOALS, features: FEATURES, otherGoal: OTHER_GOAL };
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  get(@Param('id', ParseIntPipe) id: number) {
    return this.leads.get(id);
  }

  // PATCH /api/admin/leads/:id { any of: firstName, lastName, email, phone, businessName,
  //   businessType, goals, goalsOther, features, message, status } -> the updated lead
  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body(new YupValidationPipe(updateSchema)) body: LeadUpdate) {
    return this.leads.update(id, body);
  }
}

@Controller('admin/bookings')
export class AdminBookingsController {
  constructor(
    private readonly leads: AdminLeadsService,
    private readonly booking: BookingService,
    private readonly newLeads: LeadsService,
  ) {}

  // GET /api/admin/bookings/slots -> the open call times, for the reschedule picker
  @Get('slots')
  @Header('Cache-Control', 'no-store')
  slots() {
    return this.booking.listSlots();
  }

  // GET /api/admin/bookings?when=upcoming|past
  // GET /api/admin/bookings?from=ISO&to=ISO   (calendar: up to 62 days)
  @Get()
  @Header('Cache-Control', 'no-store')
  list(@Query(new YupValidationPipe(bookingsQuerySchema)) query: BookingsQuery) {
    return this.leads.bookings(query);
  }

  // POST /api/admin/bookings { firstName, lastName, email, phone?, businessName?, businessType?,
  //   origin?, goals?, goalsOther?, features?, message?, startsAt, timeZone? } -> 201 { lead, booking }
  // Books an open slot for someone who reached the team another way (a call, a message). They get
  // the usual confirmation and reminder emails; the other admins are emailed and told live.
  @Post()
  create(@Body(new YupValidationPipe(adminBookingSchema)) body: AdminBookingInput, @Req() req: Request) {
    return this.newLeads.bookByAdmin(body, actor(req));
  }

  // POST /api/admin/bookings/:id/reschedule { startsAt, note? } -> { ok, booking }
  // The note (optional) is shown to the lead in their email.
  @Post(':id/reschedule')
  @HttpCode(200)
  reschedule(@Param('id', ParseIntPipe) id: number, @Body(new YupValidationPipe(rescheduleSchema)) body: yup.InferType<typeof rescheduleSchema>, @Req() req: Request) {
    return this.leads.reschedule(id, body.startsAt, { by: 'admin', actor: actor(req), note: body.note });
  }

  // POST /api/admin/bookings/:id/cancel { note? } -> { ok }
  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@Param('id', ParseIntPipe) id: number, @Body(new YupValidationPipe(cancelSchema)) body: yup.InferType<typeof cancelSchema>, @Req() req: Request) {
    return this.leads.cancel(id, { by: 'admin', actor: actor(req), note: body.note });
  }

  // DELETE /api/admin/bookings/:id: same as cancel, without a note.
  @Delete(':id')
  @HttpCode(200)
  remove(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    return this.leads.cancel(id, { by: 'admin', actor: actor(req) });
  }
}
