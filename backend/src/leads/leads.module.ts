import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';

@Module({
  imports: [IntegrationsModule],
  controllers: [LeadsController],
  providers: [LeadsService],
  exports: [LeadsService], // the admin Bookings page books calls too (admin/admin-leads.ts)
})
export class LeadsModule {}
