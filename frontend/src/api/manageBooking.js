import { http } from './client.js';

// The lead's private "manage my booking" API (backend/src/booking/manage-booking.controller.ts).
// The token comes from the page's URL fragment and is sent in a header, never in the URL.
const auth = (token, config) => ({ ...config, headers: { ...config?.headers, 'X-Booking-Token': token } });

// GET -> { firstName, booking: { startsAt, timeZone } | null, canChange, availability, slots, taken }
export const getManagedBooking = (token, config) => http.get('/booking/manage', auth(token, config));

// POST { meetingAt, timeZone? } -> { ok, booking: { startsAt, timeZone } }
export const rescheduleManagedBooking = (token, body, config) => http.post('/booking/manage/reschedule', body, auth(token, config));

// POST -> { ok }
export const cancelManagedBooking = (token, config) => http.post('/booking/manage/cancel', undefined, auth(token, config));
