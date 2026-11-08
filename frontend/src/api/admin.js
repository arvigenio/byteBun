import { http } from './client.js';

// The admin API (backend/src/admin/). Every call needs a fully signed-in admin, else 401.
export const getMe = (config) => http.get('/admin/me', config);

export const listLeads = (params, config) => http.get('/admin/leads', { ...config, params });
export const getLead = (id, config) => http.get(`/admin/leads/${id}`, config);
export const getLeadOptions = (config) => http.get('/admin/leads/options', config);
// Partial update: only the fields given change. -> the updated lead
export const updateLead = (id, fields) => http.patch(`/admin/leads/${id}`, fields);
/** A plain GET download (the browser sends the session cookie). */
export const leadsExportUrl = ({ q = '', status = '' } = {}) => `/api/admin/leads/export.csv?${new URLSearchParams({ q, status })}`;

export const listBookings = (when, config) => http.get('/admin/bookings', { ...config, params: { when } });
/** Calendar: every booking from <= startsAt < to (ISO strings, at most 62 days). */
export const listBookingsBetween = (from, to, config) => http.get('/admin/bookings', { ...config, params: { from, to } });
/** Open call times (same rules as the public form), for the reschedule picker. */
export const getBookingSlots = (config) => http.get('/admin/bookings/slots', config);
// The lead and the other admins are emailed. `note` (optional) is shown to the lead.
export const rescheduleBooking = (id, { startsAt, note }) => http.post(`/admin/bookings/${id}/reschedule`, { startsAt, note });
export const cancelBooking = (id, note) => http.post(`/admin/bookings/${id}/cancel`, { note });

export const getSecurity = (config) => http.get('/admin/security', config);
export const revokeSession = (id) => http.post(`/admin/security/sessions/${encodeURIComponent(id)}/revoke`, {});
export const revokeOtherSessions = () => http.post('/admin/security/sessions/revoke-others', {});
export const regenerateBackupCodes = (code) => http.post('/admin/security/backup-codes', { code });
