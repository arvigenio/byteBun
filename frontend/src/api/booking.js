import { http } from './client.js';

// GET /api/booking/slots -> { availability, slots: [ISO 8601 UTC, ...] }.
// See backend/src/booking/ (booking.controller.ts, availability.ts).
export const getSlots = (config) => http.get('/booking/slots', config);
