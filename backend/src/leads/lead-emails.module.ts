import { Global, Module } from '@nestjs/common';
import { BookingChangesService } from '../booking/booking-changes';
import { ManageLinks } from '../booking/manage-link';
import { LeadEmailsService } from './lead-emails';

// Lead emails (confirmation, reminders, changes), the lead's private manage link, and the shared
// reschedule/cancel logic. Global: used by the public lead form, the manage page, and the admin site.
@Global()
@Module({
  providers: [ManageLinks, LeadEmailsService, BookingChangesService],
  exports: [ManageLinks, LeadEmailsService, BookingChangesService],
})
export class LeadEmailsModule {}
