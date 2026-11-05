import { createHttpClient } from '../lib/http/index.js';

// The Byte Bun backend. In development Vite proxies /api to the api container;
// in production the same server serves the site and /api.
// Its error body is { message, fields } (backend/src/middleware/validate.js), which matches the
// library defaults.
export const http = createHttpClient({ baseURL: '/api' });
