// The lead's private "manage my booking" API, used by the public /manage-booking page. The page
// sends the token from its URL fragment in the X-Booking-Token header (see manage-link.ts).
//
//   GET  /api/booking/manage             -> { firstName, booking: {startsAt, timeZone} | null, canChange, slots }
//   POST /api/booking/manage/reschedule  { meetingAt, timeZone? } -> { ok, booking }
//   POST /api/booking/manage/cancel      -> { ok }
//
// A wrong, tampered or revoked token answers 404 without saying why. Changes are rate limited
// like the lead form, and every change emails the lead and both admins.
import { Body, Controller, Get, Header, HttpCode, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import * as yup from 'yup';
import { ApiError } from '../common/api-error';
import { StrictRateLimit } from '../common/rate-limit';
import { YupValidationPipe } from '../common/yup-validation.pipe';
import { PrismaService } from '../database/prisma.service';
import { BookingChangesService } from './booking-changes';
import { BookingService } from './booking.service';
import { ManageLinks } from './manage-link';

const isTimeZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

const rescheduleSchema = yup.object({
  meetingAt: yup.date().typeError('Please choose a time for your call.').required('Please choose a time for your call.'),
  timeZone: yup
    .string()
    .trim()
    .max(64)
    .nullable()
    .test('time-zone', 'Invalid time zone.', (v) => !v || isTimeZone(v)),
});

const invalidLink = () => new ApiError(404, { error: 'invalid_link', message: 'This link is not valid any more. Please use the link in your latest email from us, or reply to it.' });

@Controller('booking/manage')
export class ManageBookingController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly links: ManageLinks,
    private readonly changes: BookingChangesService,
    private readonly booking: BookingService,
  ) {}

  private async lead(req: Request) {
    const parsed = this.links.parse(req.headers['x-booking-token']);
    if (!parsed) throw invalidLink();
    const lead = await this.prisma.lead.findUnique({
      where: { id: parsed.leadId },
      select: { id: true, firstName: true, manageNonce: true, booking: { select: { startsAt: true, timeZone: true } } },
    });
    if (!lead || !this.links.verify(lead.id, parsed.signature, lead.manageNonce)) throw invalidLink();
    return lead;
  }

  @Get()
  @Header('Cache-Control', 'no-store')
  @Header('X-Robots-Tag', 'noindex, nofollow')
  async view(@Req() req: Request) {
    const lead = await this.lead(req);
    const booking = lead.booking;
    return {
      firstName: lead.firstName,
      booking,
      // A call that already started can't be changed; with no call, a new one can be booked.
      canChange: !booking || booking.startsAt > new Date(),
      ...(await this.booking.listSlots()),
    };
  }

  @Post('reschedule')
  @HttpCode(200)
  @StrictRateLimit()
  async reschedule(@Req() req: Request, @Body(new YupValidationPipe(rescheduleSchema)) body: yup.InferType<typeof rescheduleSchema>) {
    const lead = await this.lead(req);
    const { booking } = await this.changes.reschedule(lead.id, body.meetingAt, { by: 'lead' }, body.timeZone || undefined);
    return { ok: true, booking: { startsAt: booking.startsAt, timeZone: booking.timeZone } };
  }

  @Post('cancel')
  @HttpCode(200)
  @StrictRateLimit()
  async cancel(@Req() req: Request) {
    const lead = await this.lead(req);
    return this.changes.cancel(lead.id, { by: 'lead' });
  }
}
