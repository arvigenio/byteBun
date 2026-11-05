import { http } from './client.js';

// GET /api/health -> { status: 'ok', database: 'reachable' }, or ApiError with status 503.
export const getHealth = (config) => http.get('/health', config);
