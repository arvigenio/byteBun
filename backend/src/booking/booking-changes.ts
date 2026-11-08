// Rescheduling and cancelling a call: the same rules and side effects whether the lead does it
// (their private link, manage-booking.controller.ts) or an admin does (admin site):
//  - only an open slot from the availability rules; two people can't take the same slot (409)
//  - a call that already started can't be changed
//  - reschedule: new time, SEQUENCE + 1 (calendar apps update the event), reminder re-planned
//  - then: cache cleared + admins told live (AdminEvents), and the lead emailed (LeadEmailsService;
//    the admins are emailed too when the lead made the change)
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ApiError } from '../common/api-error';
import { PrismaService } from '../database/prisma.service';
import { type ChangeSource, LeadEmailsService, reminderAtFor } from '../leads/lead-emails';
import { logger } from '../logging/logger';
import { AdminEvents } from '../realtime/admin-events';
import { isBookableSlot } from './availability';

const slotTaken = () => new ApiError(409, { error: 'slot_taken', message: 'Sorry, that time was just booked. Please choose another time.', fields: { meetingAt: 'That time was just booked.' } });
const tooLate = () => new ApiError(409, { error: 'call_started', message: 'This call has already started or taken place, so it can no longer be changed.' });
const notAvailable = () =>
  new ApiError(400, { error: 'validation_failed', message: 'Please choose another time.', fields: { meetingAt: 'That time is not available. Please choose another time.' } });

const summary = (l: { id: number; firstName: string; lastName: string; businessName: string | null }) => ({
  id: l.id,
  firstName: l.firstName,
  lastName: l.lastName,
  businessName: l.businessName,
});

@Injectable()
export class BookingChangesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: AdminEvents,
    private readonly emails: LeadEmailsService,
  ) {}

  /** Moves the lead's call to `startsAt` (or books a new one if it was cancelled). */
  async reschedule(leadId: number, startsAt: Date, src: ChangeSource, timeZone?: string | null) {
    if (!isBookableSlot(startsAt)) throw notAvailable();
    const now = new Date();
    const lead = await this.prisma.lead.findUnique({ where: { id: leadId }, include: { booking: true } });
    if (!lead) throw new ApiError(404, { error: 'not_found', message: 'That lead does not exist.' });
    const previous = lead.booking;
    if (previous && previous.startsAt <= now) throw tooLate();
    if (previous && previous.startsAt.getTime() === startsAt.getTime()) {
      return { booking: previous, changed: false };
    }

    let booking;
    try {
      booking = previous
        ? await this.prisma.booking.update({
            where: { id: previous.id },
            data: {
              startsAt,
              ...(timeZone !== undefined && { timeZone }),
              sequence: { increment: 1 },
              reminderAt: reminderAtFor(startsAt, now),
              reminderSentAt: null,
            },
          })
        : await this.prisma.booking.create({
            data: { leadId, startsAt, timeZone: timeZone ?? null, reminderAt: reminderAtFor(startsAt, now), confirmationSentAt: now },
          });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') throw slotTaken();
      throw err;
    }

    logger.info({ leadId, bookingId: booking.id, by: src.by }, previous ? 'Call rescheduled' : 'Call booked again');
    this.events.bookingChanged({
      kind: previous ? 'rescheduled' : 'booked',
      by: src.by,
      actor: src.by === 'admin' ? (src.actor ?? null) : null,
      lead: summary(lead),
      bookingId: booking.id,
      startsAt: booking.startsAt.toISOString(),
      previousStartsAt: previous?.startsAt.toISOString() ?? null,
    });
    if (previous) this.emails.rescheduled(leadId, { startsAt: previous.startsAt, timeZone: previous.timeZone }, src);
    else this.emails.rebooked(leadId, src);
    return { booking, changed: true };
  }

  /** Cancels the lead's call. The lead stays; the slot opens again. */
  async cancel(leadId: number, src: ChangeSource) {
    const now = new Date();
    const row = await this.emails.load(leadId);
    if (!row) throw new ApiError(404, { error: 'not_found', message: 'That lead does not exist.' });
    const { booking, ...lead } = row;
    if (!booking) throw new ApiError(404, { error: 'no_booking', message: 'There is no call booked to cancel.' });
    if (booking.startsAt <= now) throw tooLate();

    const { count } = await this.prisma.booking.deleteMany({ where: { id: booking.id } });
    if (!count) throw new ApiError(404, { error: 'no_booking', message: 'There is no call booked to cancel.' });

    logger.info({ leadId, bookingId: booking.id, by: src.by }, 'Call cancelled');
    this.events.bookingChanged({
      kind: 'cancelled',
      by: src.by,
      actor: src.by === 'admin' ? (src.actor ?? null) : null,
      lead: summary(lead),
      bookingId: booking.id,
      startsAt: null,
      previousStartsAt: booking.startsAt.toISOString(),
    });
    this.emails.cancelled(lead, booking, src);
    return { ok: true };
  }
}
