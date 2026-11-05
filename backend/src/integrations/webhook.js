// Extension point for n8n (and, through it, GoHighLevel). When N8N_WEBHOOK_URL is set,
// each saved lead is POSTed there as JSON. Failures are logged and never reach the visitor.
import { config } from '../config.js';
import { logger } from '../logger.js';

export function notifyLeadWebhook(lead) {
  const url = config.integrations.n8nWebhookUrl;
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
    .catch((err) => logger.warn({ leadId: lead.id, reason: err.message }, 'Lead webhook failed'));
}
