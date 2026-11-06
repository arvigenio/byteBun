import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module';
import { LeadsController } from './leads.controller';
import { LeadsService } from './leads.service';

@Module({
  imports: [IntegrationsModule],
  controllers: [LeadsController],
  providers: [LeadsService],
})
export class LeadsModule {}
