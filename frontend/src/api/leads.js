import { http } from './client.js';

// POST /api/leads -> { ok: true, id }. See backend/src/routes/leads.js.
export const createLead = (lead, config) => http.post('/leads', lead, config);
