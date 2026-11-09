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

// Prospecting (backend/src/prospects/). Search results live on the server for 30 min; admins can
// save any of them, in groups (saved-prospects.controller.ts).
export const getProspectMeta = (config) => http.get('/admin/prospects/meta', config);
// Searching can take up to a minute with the free map data, so a longer timeout here.
export const searchProspects = ({ industry, location, refresh = false }, config) =>
  http.post('/admin/prospects/search', { industry, location, refresh }, { timeout: 150_000, ...config });
export const getProspectResults = (searchId, config) => http.get(`/admin/prospects/searches/${searchId}`, config);
export const recheckProspectWebsite = (searchId, itemId) => http.post(`/admin/prospects/searches/${searchId}/items/${itemId}/check-website`, {}, { timeout: 30_000 });
export const listProspectGroups = (config) => http.get('/admin/prospects/groups', config);
export const createProspectGroup = (name) => http.post('/admin/prospects/groups', { name });
export const renameProspectGroup = (id, name) => http.patch(`/admin/prospects/groups/${id}`, { name });
export const deleteProspectGroup = (id) => http.delete(`/admin/prospects/groups/${id}`);
/** group: 'all', 'none' (no group) or a group id. */
export const listSavedProspects = (group, config) => http.get('/admin/prospects/saved', { ...config, params: { group } });
/** groupId: a group, null for none, or undefined to keep the group of already saved ones. */
export const saveProspects = ({ searchId, itemIds, groupId }) => http.post('/admin/prospects/saved', { searchId, itemIds, groupId });
/** Partial: { groupId?, note? } */
export const updateSavedProspect = (id, fields) => http.patch(`/admin/prospects/saved/${id}`, fields);
export const removeSavedProspect = (id) => http.delete(`/admin/prospects/saved/${id}`);
