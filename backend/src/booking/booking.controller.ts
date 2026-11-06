import { Controller, Get, Header } from '@nestjs/common';
import { BookingService } from './booking.service';

@Controller('booking')
export class BookingController {
  constructor(private readonly booking: BookingService) {}

  // GET /api/booking/slots -> { availability, slots: [ISO 8601 UTC, ...], taken: [ISO, ...] }
  // No personal data.
  @Get('slots')
  @Header('Cache-Control', 'no-store')
  slots() {
    return this.booking.listSlots();
  }
}
