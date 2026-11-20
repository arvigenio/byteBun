// Creating, moving and cancelling bookings. The capacity check and the write happen in ONE
// transaction that first takes a per-business lock (pg_advisory_xact_lock), so two people can
// never take the last place at the same time, and daily/monthly limits can't be overrun.
//
// Every change also queues its emails (customer + owner alerts) in the same transaction
// (booking.notifications), so a booking is never saved without its confirmation, or vice versa.
import { Injectable } from '@nestjs/common';
import { ApiError } from '../../common/api-error';
import { logger } from '../../logging/logger';
import { ClientsDb, type ClientsTx } from '../clients-db';
import { limitOf, loadEntitlements } from '../entitlements';
import { newNonce } from './manage-token';
import { BookingNotifications } from './notifications';
import { checkBookable, type Occupied, type ScheduleRules } from './schedule';
import { addDays, dateFromDb, dateToDb, fromLocal, todayIn } from './time';

type Db = ClientsDb | ClientsTx;

export const errors = {
  notFound: () => new ApiError(404, { error: 'not_found', message: 'That booking page does not exist.' }),
  unavailable: () =>
    new ApiError(400, { error: 'unavailable', message: 'That time is not available. Please choose another one.', fields: { startsAt: 'Please choose another time.' } }),
  full: () => new ApiError(409, { error: 'slot_taken', message: 'Sorry, that time was just booked. Please choose another one.', fields: { startsAt: 'That time was just booked.' } }),
  monthly: () => new ApiError(409, { error: 'monthly_limit', message: 'No more online bookings are available this month.' }),
  closedForBooking: () => new ApiError(403, { error: 'booking_unavailable', message: 'Online booking is currently unavailable.' }),
  serviceGone: () => new ApiError(400, { error: 'validation_failed', message: 'Please choose a service.', fields: { serviceId: 'That service is no longer available.' } }),
};

export async function loadRules(db: Db, organizationId: string): Promise<{ rules: ScheduleRules; settings: NonNullable<Awaited<ReturnType<Db['bookingSettings']['findUnique']>>> } | null> {
  const [settings, hours, breaks, blocked] = await Promise.all([
    db.bookingSettings.findUnique({ where: { organizationId } }),
    db.weeklyHours.findMany({ where: { organizationId } }),
    db.breakPeriod.findMany({ where: { organizationId } }),
    db.blockedDate.findMany({ where: { organizationId, endDate: { gte: dateToDb(addDays(new Date().toISOString().slice(0, 10), -2)) } } }),
  ]);
  if (!settings) return null;
  return {
    settings,
    rules: {
      timeZone: settings.timeZone,
      mode: settings.mode === 'date' ? 'date' : 'slots',
      intervalMinutes: settings.intervalMinutes,
      bookersPerSlot: settings.bookersPerSlot,
      maxPerDay: settings.maxPerDay,
      minNoticeMinutes: settings.minNoticeMinutes,
      windowDays: settings.windowDays,
      hours: new Map(hours.map((h) => [h.weekday, { startMinute: h.startMinute, endMinute: h.endMinute }])),
      breaks: breaks.map((b) => ({ weekday: b.weekday, startMinute: b.startMinute, endMinute: b.endMinute })),
      blocked: blocked.map((b) => ({ startDate: dateFromDb(b.startDate), endDate: dateFromDb(b.endDate) })),
    },
  };
}

/** Confirmed bookings on local dates from..to (capacity only counts confirmed ones). */
export async function occupiedBetween(db: Db, organizationId: string, from: string, to: string, excludeId?: number): Promise<Occupied[]> {
  const rows = await db.booking.findMany({
    where: { organizationId, status: 'confirmed', localDate: { gte: dateToDb(addDays(from, -1)), lte: dateToDb(addDays(to, 1)) }, ...(excludeId ? { id: { not: excludeId } } : {}) },
    select: { id: true, localDate: true, startsAt: true, blockedUntil: true },
  });
  return rows.map((r) => ({ id: r.id, localDate: dateFromDb(r.localDate), startsAt: r.startsAt, blockedUntil: r.blockedUntil }));
}

/** Bookings created this calendar month (business time), cancelled ones included. */
export async function monthlyUsage(db: Db, organizationId: string, timeZone: string, now = new Date()) {
  const monthStart = fromLocal(`${todayIn(timeZone, now).slice(0, 7)}-01`, 0, timeZone);
  return db.booking.count({ where: { organizationId, createdAt: { gte: monthStart } } });
}

const lock = (tx: ClientsTx, organizationId: string) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`booking:${organizationId}`}))`;

export interface NewBooking {
  organizationId: string;
  serviceId: number;
  startsAt?: Date;
  date?: string;
  customer: { name: string; email: string; phone?: string | null };
  note?: string | null;
  source: 'public' | 'business';
}

@Injectable()
export class BookingEngine {
  constructor(
    private readonly db: ClientsDb,
    private readonly notifications: BookingNotifications,
  ) {}

  async create(input: NewBooking) {
    const result = await this.db.$transaction(async (tx) => {
      await lock(tx, input.organizationId);
      const loaded = await loadRules(tx, input.organizationId);
      if (!loaded) throw errors.notFound();
      const { rules } = loaded;
      const service = await tx.service.findFirst({ where: { id: input.serviceId, organizationId: input.organizationId, active: true } });
      if (!service) throw errors.serviceGone();

      // Free plan: a monthly cap (cancelled bookings count). Bookings the business adds itself count too.
      const ents = await loadEntitlements(tx, input.organizationId);
      const cap = limitOf(ents, 'bookings.monthly');
      const used = await monthlyUsage(tx, input.organizationId, rules.timeZone);
      if (cap !== null && used >= cap) throw errors.monthly();

      const date = input.date ?? (input.startsAt ? new Date(input.startsAt).toISOString().slice(0, 10) : undefined);
      if (!date) throw errors.unavailable();
      const occupied = await occupiedBetween(tx, input.organizationId, addDays(date, -1), addDays(date, 1));
      const check = checkBookable(rules, service, { startsAt: input.startsAt, date: input.date }, occupied);
      if (!check.ok) throw check.reason === 'full' ? errors.full() : errors.unavailable();

      const email = input.customer.email.trim().toLowerCase();
      const customer = await tx.customer.upsert({
        where: { organizationId_email: { organizationId: input.organizationId, email } },
        create: { organizationId: input.organizationId, email, name: input.customer.name, phone: input.customer.phone || null },
        update: { name: input.customer.name, ...(input.customer.phone ? { phone: input.customer.phone } : {}) },
      });
      const booking = await tx.booking.create({
        data: {
          organizationId: input.organizationId,
          serviceId: service.id,
          customerId: customer.id,
          localDate: dateToDb(check.localDate),
          startsAt: check.startsAt,
          endsAt: check.endsAt,
          blockedUntil: check.blockedUntil,
          dateOnly: rules.mode === 'date',
          manageNonce: newNonce(),
          note: input.note || null,
          source: input.source,
        },
      });
      await this.notifications.queueBookingEvent(tx, booking.id, 'new');
      const usedNow = used + 1;
      if (cap !== null && (usedNow === Math.ceil(cap * 0.8) || usedNow === cap)) await this.notifications.queueLimitWarning(tx, input.organizationId, usedNow, cap);
      return booking;
    });
    logger.info({ org: input.organizationId, bookingId: result.id, source: input.source }, 'Client booking created');
    this.notifications.kick();
    return result;
  }

  async reschedule(organizationId: string, bookingId: number, want: { startsAt?: Date; date?: string }, by: 'customer' | 'business') {
    const result = await this.db.$transaction(async (tx) => {
      await lock(tx, organizationId);
      const booking = await tx.booking.findFirst({ where: { id: bookingId, organizationId }, include: { service: true } });
      if (!booking || booking.status !== 'confirmed') throw new ApiError(404, { error: 'not_found', message: 'That booking is not active any more.' });
      if (booking.startsAt <= new Date() && !booking.dateOnly) throw new ApiError(409, { error: 'started', message: 'This appointment has already started, so it can no longer be changed.' });
      const loaded = await loadRules(tx, organizationId);
      if (!loaded) throw errors.notFound();
      const date = want.date ?? (want.startsAt ? want.startsAt.toISOString().slice(0, 10) : undefined);
      if (!date) throw errors.unavailable();
      const occupied = await occupiedBetween(tx, organizationId, addDays(date, -1), addDays(date, 1), booking.id);
      const check = checkBookable(loaded.rules, booking.service, want, occupied);
      if (!check.ok) throw check.reason === 'full' ? errors.full() : errors.unavailable();
      if (check.startsAt.getTime() === booking.startsAt.getTime() && dateFromDb(booking.localDate) === check.localDate) return { booking, changed: false };

      const previous = { startsAt: booking.startsAt, localDate: dateFromDb(booking.localDate), dateOnly: booking.dateOnly };
      const updated = await tx.booking.update({
        where: { id: booking.id },
        data: { localDate: dateToDb(check.localDate), startsAt: check.startsAt, endsAt: check.endsAt, blockedUntil: check.blockedUntil, sequence: { increment: 1 } },
      });
      // Old reminders go; the new time gets its own.
      await this.notifications.cancelPending(tx, booking.id);
      await this.notifications.queueBookingEvent(tx, booking.id, 'rescheduled', { by, previous: this.notifications.whenLabel(previous, loaded.rules.timeZone) });
      return { booking: updated, changed: true };
    });
    if (result.changed) {
      logger.info({ org: organizationId, bookingId, by }, 'Client booking rescheduled');
      this.notifications.kick();
    }
    return result;
  }

  async cancel(organizationId: string, bookingId: number, opts: { by: 'customer' | 'business' | 'system'; reason?: string | null; notifyCustomer?: boolean }) {
    await this.db.$transaction(async (tx) => {
      const booking = await tx.booking.findFirst({ where: { id: bookingId, organizationId } });
      if (!booking || booking.status !== 'confirmed') throw new ApiError(404, { error: 'not_found', message: 'That booking is not active any more.' });
      await tx.booking.update({ where: { id: booking.id }, data: { status: 'cancelled', cancelledAt: new Date(), cancelledBy: opts.by, cancelReason: opts.reason || null } });
      await this.notifications.cancelPending(tx, booking.id);
      await this.notifications.queueBookingEvent(tx, booking.id, 'cancelled', { by: opts.by, reason: opts.reason ?? null, notifyCustomer: opts.notifyCustomer !== false });
    });
    logger.info({ org: organizationId, bookingId, by: opts.by }, 'Client booking cancelled');
    this.notifications.kick();
    return { ok: true };
  }
}
