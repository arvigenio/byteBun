import { Module } from '@nestjs/common';
import { LeadWebhookService } from './lead-webhook.service';

// Outgoing integrations (n8n today; payments, chatbot, etc. later).
@Module({
  providers: [LeadWebhookService],
  exports: [LeadWebhookService],
})
export class IntegrationsModule {}
