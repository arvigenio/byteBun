import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/config';
import type { SavedLead } from '../leads/leads.service';
import { logger } from '../logging/logger';

// Extension point for n8n (and, through it, GoHighLevel). When N8N_WEBHOOK_URL is set, each
// saved lead is POSTed there as JSON:
//   { event: 'lead.created', lead: { id, firstName, lastName, email, ..., goals: [labels], features: [labels],
//     booking: { startsAt, timeZone } } }
// Failures are logged and never reach the visitor.
@Injectable()
export class LeadWebhookService {
  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig) {}

  notifyLeadCreated(lead: SavedLead): void {
    const url = this.cfg.integrations.n8nWebhookUrl;
    if (!url) return;

    fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ event: 'lead.created', lead }),
      signal: AbortSignal.timeout(5_000),
    })
      .then((res) => {
        if (!res.ok) logger.warn({ leadId: lead.id, status: res.status }, 'Lead webhook returned an error status');
      })
      .catch((err: unknown) => logger.warn({ leadId: lead.id, reason: err instanceof Error ? err.message : String(err) }, 'Lead webhook failed'));
  }
}
