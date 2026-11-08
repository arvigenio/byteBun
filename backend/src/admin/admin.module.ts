import { Module } from '@nestjs/common';
import { BookingModule } from '../booking/booking.module';
import { AdminBookingsController, AdminLeadsController, AdminLeadsService } from './admin-leads';
import { AdminSecurityController } from './admin-security';

// Everything under /api/admin. AdminSessionGuard (registered globally in app.module.ts) requires
// a fully signed-in admin for every one of these routes.
@Module({
  imports: [BookingModule],
  controllers: [AdminLeadsController, AdminBookingsController, AdminSecurityController],
  providers: [AdminLeadsService],
})
export class AdminModule {}
