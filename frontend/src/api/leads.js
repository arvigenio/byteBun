import { http } from './client.js';

// POST /api/leads -> { ok: true, id }. See backend/src/leads/leads.controller.ts.
export const createLead = (lead, config) => http.post('/leads', lead, config);
