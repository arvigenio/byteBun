import { Module } from '@nestjs/common';
import { BookingController } from './booking.controller';
import { BookingService } from './booking.service';
import { ManageBookingController } from './manage-booking.controller';

@Module({
  controllers: [BookingController, ManageBookingController],
  providers: [BookingService],
  exports: [BookingService],
})
export class BookingModule {}
