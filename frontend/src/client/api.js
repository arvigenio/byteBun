import { createApi } from '@reduxjs/toolkit/query/react';
import { createHttpClient } from '../lib/http/index.js';

// Every client API call (backend/src/clients/). RTK Query caches, dedupes and refetches; tags
// keep lists fresh after changes.
const http = createHttpClient({ baseURL: '/api' });

// Better Auth (client sign-in). Its errors are { message, code }.
const AUTH_MESSAGES = {
  INVALID_OTP: 'That code is not right. Check the email and try again.',
  OTP_EXPIRED: 'That code has expired. Request a new one.',
  TOO_MANY_ATTEMPTS: 'Too many wrong codes. Request a new code.',
};
export const authHttp = createHttpClient({ baseURL: '/api/accounts/auth', getErrorMessage: (d) => AUTH_MESSAGES[d?.code] ?? d?.message });

/** The API's error, flattened: { status, error, message, fields, conflicts }. */
export const toError = (err) => {
  const body = err?.cause?.response?.data ?? {};
  return { status: err?.status ?? 0, error: body.error ?? err?.code ?? 'error', message: err?.message ?? 'Something went wrong.', fields: err?.fields ?? {}, conflicts: body.conflicts };
};

const baseQuery = async ({ url, method = 'get', body, params, headers }) => {
  try {
    const data = await (method === 'get' || method === 'delete' ? http[method](url, { params, headers }) : http[method](url, body ?? {}, { params, headers }));
    return { data };
  } catch (err) {
    return { error: toError(err) };
  }
};

export const api = createApi({
  reducerPath: 'api',
  baseQuery,
  tagTypes: ['Profile', 'Me', 'Overview', 'Settings', 'Blocked', 'Services', 'Bookings', 'Team', 'Events'],
  endpoints: (b) => ({
    config: b.query({ query: () => ({ url: '/client/config' }) }),
    me: b.query({ query: () => ({ url: '/client/me' }), providesTags: ['Me'] }),
    onboarding: b.mutation({ query: (body) => ({ url: '/client/onboarding', method: 'post', body }), invalidatesTags: ['Me'] }),
    setActiveBusiness: b.mutation({ query: (organizationId) => ({ url: '/client/active-business', method: 'post', body: { organizationId } }), invalidatesTags: () => ['Me', 'Overview', 'Settings', 'Blocked', 'Services', 'Bookings', 'Team', 'Events'] }),
    profile: b.query({ query: () => ({ url: '/client/profile' }), providesTags: ['Profile'] }),
    updateProfile: b.mutation({ query: (body) => ({ url: '/client/profile', method: 'patch', body }), invalidatesTags: ['Me', 'Profile'] }),
    updateBusinessName: b.mutation({ query: (name) => ({ url: '/client/business', method: 'patch', body: { name } }), invalidatesTags: ['Me', 'Profile', 'Settings', 'Overview'] }),

    team: b.query({ query: () => ({ url: '/client/team' }), providesTags: ['Team'] }),
    invite: b.mutation({ query: (body) => ({ url: '/client/team/invitations', method: 'post', body }), invalidatesTags: ['Team'] }),
    cancelInvite: b.mutation({ query: (id) => ({ url: `/client/team/invitations/${encodeURIComponent(id)}`, method: 'delete' }), invalidatesTags: ['Team'] }),
    setRole: b.mutation({ query: ({ id, role }) => ({ url: `/client/team/members/${encodeURIComponent(id)}`, method: 'patch', body: { role } }), invalidatesTags: ['Team'] }),
    removeMember: b.mutation({ query: (id) => ({ url: `/client/team/members/${encodeURIComponent(id)}`, method: 'delete' }), invalidatesTags: ['Team'] }),
    invitation: b.query({ query: (id) => ({ url: `/client/invitations/${encodeURIComponent(id)}` }) }),
    acceptInvitation: b.mutation({ query: (id) => ({ url: `/client/invitations/${encodeURIComponent(id)}/accept`, method: 'post' }), invalidatesTags: ['Me'] }),

    overview: b.query({ query: () => ({ url: '/client/bookings/overview' }), providesTags: ['Overview'] }),
    settings: b.query({ query: () => ({ url: '/client/bookings/settings' }), providesTags: ['Settings'] }),
    saveSettings: b.mutation({ query: (body) => ({ url: '/client/bookings/settings', method: 'put', body }), invalidatesTags: ['Settings', 'Overview', 'Me'] }),
    saveHours: b.mutation({ query: (body) => ({ url: '/client/bookings/hours', method: 'put', body }), invalidatesTags: ['Settings'] }),
    blocked: b.query({ query: () => ({ url: '/client/bookings/blocked-dates' }), providesTags: ['Blocked'] }),
    block: b.mutation({ query: (body) => ({ url: '/client/bookings/blocked-dates', method: 'post', body }), invalidatesTags: ['Blocked', 'Bookings', 'Overview'] }),
    unblock: b.mutation({ query: (id) => ({ url: `/client/bookings/blocked-dates/${id}`, method: 'delete' }), invalidatesTags: ['Blocked'] }),
    services: b.query({ query: () => ({ url: '/client/bookings/services' }), providesTags: ['Services'] }),
    createService: b.mutation({ query: (body) => ({ url: '/client/bookings/services', method: 'post', body }), invalidatesTags: ['Services', 'Overview'] }),
    updateService: b.mutation({ query: ({ id, ...body }) => ({ url: `/client/bookings/services/${id}`, method: 'patch', body }), invalidatesTags: ['Services', 'Overview'] }),
    deleteService: b.mutation({ query: (id) => ({ url: `/client/bookings/services/${id}`, method: 'delete' }), invalidatesTags: ['Services', 'Overview'] }),
    dashboard: b.query({ query: (days) => ({ url: '/client/bookings/dashboard', params: { days } }), providesTags: ['Bookings'] }),
    bookings: b.query({ query: (params) => ({ url: '/client/bookings/items', params }), providesTags: ['Bookings'] }),
    addBooking: b.mutation({ query: (body) => ({ url: '/client/bookings/items', method: 'post', body }), invalidatesTags: ['Bookings', 'Overview'] }),
    cancelBooking: b.mutation({ query: ({ id, ...body }) => ({ url: `/client/bookings/items/${id}/cancel`, method: 'post', body }), invalidatesTags: ['Bookings', 'Overview'] }),
    markNoShow: b.mutation({ query: ({ id, noShow }) => ({ url: `/client/bookings/items/${id}/no-show`, method: 'post', body: { noShow } }), invalidatesTags: ['Bookings'] }),
    rescheduleBooking: b.mutation({ query: ({ id, ...body }) => ({ url: `/client/bookings/items/${id}/reschedule`, method: 'post', body }), invalidatesTags: ['Bookings', 'Overview'] }),
    // Attendance: { code } (typed or scanned) or { id }, force -> { state, checkedIn, booking, today }
    checkIn: b.mutation({ query: (body) => ({ url: '/client/bookings/check-in', method: 'post', body }), invalidatesTags: ['Bookings'] }),
    undoCheckIn: b.mutation({ query: (id) => ({ url: `/client/bookings/items/${id}/check-in/undo`, method: 'post', body: {} }), invalidatesTags: ['Bookings'] }),
    adminAvailability: b.query({ query: (params) => ({ url: '/client/bookings/availability', params }), keepUnusedDataFor: 0, providesTags: ['Bookings'] }),

    // Address suggestions and the dropped pin's address (places.controller.ts)
    placesSuggest: b.query({ query: ({ q, at, tz }) => ({ url: '/client/places/suggest', params: { q, ...(at ? { at } : {}), ...(tz ? { tz } : {}) } }), keepUnusedDataFor: 30 }),
    placesReverse: b.query({ query: ({ lat, lng }) => ({ url: '/client/places/reverse', params: { lat, lng } }), keepUnusedDataFor: 30 }),

    // Events (booking/events.ts)
    events: b.query({ query: () => ({ url: '/client/bookings/events' }), providesTags: ['Events'] }),
    event: b.query({ query: (id) => ({ url: `/client/bookings/events/${id}` }), providesTags: ['Events'] }),
    createEvent: b.mutation({ query: (body) => ({ url: '/client/bookings/events', method: 'post', body }), invalidatesTags: ['Events'] }),
    updateEvent: b.mutation({ query: ({ id, ...body }) => ({ url: `/client/bookings/events/${id}`, method: 'patch', body }), invalidatesTags: ['Events'] }),
    // Deleting an event: a 6-digit code is emailed first, then the delete needs it.
    requestEventDelete: b.mutation({ query: (id) => ({ url: `/client/bookings/events/${id}/delete-code`, method: 'post', body: {} }) }),
    deleteEvent: b.mutation({ query: ({ id, code, notifyAttendees }) => ({ url: `/client/bookings/events/${id}/delete`, method: 'post', body: { code, notifyAttendees } }), invalidatesTags: ['Events'] }),
    checkVoucher: b.mutation({ query: (code) => ({ url: '/client/bookings/events/vouchers/check', method: 'post', body: { code } }) }),
    issueEventCode: b.mutation({ query: ({ id, ...body }) => ({ url: `/client/bookings/events/${id}/tickets`, method: 'post', body }), invalidatesTags: ['Events'] }),
    deleteEventCode: b.mutation({ query: ({ id, ticketId }) => ({ url: `/client/bookings/events/${id}/tickets/${ticketId}`, method: 'delete' }), invalidatesTags: ['Events'] }),
    revokeEventTicket: b.mutation({ query: ({ id, ticketId, reason }) => ({ url: `/client/bookings/events/${id}/tickets/${ticketId}/revoke`, method: 'post', body: { reason } }), invalidatesTags: ['Events'] }),
    eventCheckIn: b.mutation({ query: ({ id, ...body }) => ({ url: `/client/bookings/events/${id}/check-in`, method: 'post', body }), invalidatesTags: ['Events'] }),
    undoEventCheckIn: b.mutation({ query: ({ id, ticketId }) => ({ url: `/client/bookings/events/${id}/tickets/${ticketId}/check-in/undo`, method: 'post', body: {} }), invalidatesTags: ['Events'] }),
    eventScanners: b.query({ query: (id) => ({ url: `/client/bookings/events/${id}/scanners` }), providesTags: ['Events'] }),
    createEventScanner: b.mutation({ query: ({ id, ...body }) => ({ url: `/client/bookings/events/${id}/scanners`, method: 'post', body }), invalidatesTags: ['Events'] }),
    newScannerCode: b.mutation({ query: ({ id, scannerId }) => ({ url: `/client/bookings/events/${id}/scanners/${scannerId}/code`, method: 'post', body: {} }), invalidatesTags: ['Events'] }),
    revokeScannerCode: b.mutation({ query: ({ id, scannerId }) => ({ url: `/client/bookings/events/${id}/scanners/${scannerId}/revoke`, method: 'post', body: {} }), invalidatesTags: ['Events'] }),
    addClaimable: b.mutation({ query: ({ id, name }) => ({ url: `/client/bookings/events/${id}/claimables`, method: 'post', body: { name } }), invalidatesTags: ['Events'] }),
    renameClaimable: b.mutation({ query: ({ id, claimableId, name }) => ({ url: `/client/bookings/events/${id}/claimables/${claimableId}`, method: 'patch', body: { name } }), invalidatesTags: ['Events'] }),
    claimHere: b.mutation({ query: ({ id, claimableId, ...body }) => ({ url: `/client/bookings/events/${id}/claimables/${claimableId}/claim`, method: 'post', body }), invalidatesTags: ['Events'] }),
    unclaimHere: b.mutation({ query: ({ id, claimableId, ticketId }) => ({ url: `/client/bookings/events/${id}/claimables/${claimableId}/undo`, method: 'post', body: { ticketId } }), invalidatesTags: ['Events'] }),
    deleteClaimable: b.mutation({ query: ({ id, claimableId }) => ({ url: `/client/bookings/events/${id}/claimables/${claimableId}`, method: 'delete' }), invalidatesTags: ['Events'] }),
    deleteEventScanner: b.mutation({ query: ({ id, scannerId }) => ({ url: `/client/bookings/events/${id}/scanners/${scannerId}`, method: 'delete' }), invalidatesTags: ['Events'] }),
    requestEventUpgrade: b.mutation({ query: ({ id, ...body }) => ({ url: `/client/bookings/events/${id}/upgrade-request`, method: 'post', body }) }),

    // Public (no login)
    publicEvents: b.query({ query: (slug) => ({ url: `/public/bookings/${encodeURIComponent(slug)}/events` }) }),
    publicEvent: b.query({ query: ({ slug, event }) => ({ url: `/public/bookings/${encodeURIComponent(slug)}/events/${encodeURIComponent(event)}` }) }),
    registerEvent: b.mutation({ query: ({ slug, event, ...body }) => ({ url: `/public/bookings/${encodeURIComponent(slug)}/events/${encodeURIComponent(event)}/register`, method: 'post', body }) }),
    eventRegistration: b.query({ query: ({ slug, event, token }) => ({ url: `/public/bookings/${encodeURIComponent(slug)}/events/${encodeURIComponent(event)}/registration`, headers: { 'X-Registration-Token': token } }), keepUnusedDataFor: 0 }),
    cancelEventRegistration: b.mutation({ query: ({ slug, event, token }) => ({ url: `/public/bookings/${encodeURIComponent(slug)}/events/${encodeURIComponent(event)}/cancel`, method: 'post', body: { token } }) }),
    // An attendance scanner device (scanner host): scanner code + access code, then a session token
    scannerPage: b.query({ query: (scannerCode) => ({ url: `/scanner/${encodeURIComponent(scannerCode)}` }) }),
    scannerSignIn: b.mutation({ query: ({ scannerCode, accessCode }) => ({ url: `/scanner/${encodeURIComponent(scannerCode)}/sign-in`, method: 'post', body: { accessCode } }) }),
    scannerSession: b.query({ query: ({ scannerCode, token }) => ({ url: `/scanner/${encodeURIComponent(scannerCode)}/session`, headers: { 'X-Scanner-Token': token } }), keepUnusedDataFor: 0 }),
    scannerCheckIn: b.mutation({ query: ({ scannerCode, token, ...body }) => ({ url: `/scanner/${encodeURIComponent(scannerCode)}/check-in`, method: 'post', body, headers: { 'X-Scanner-Token': token } }) }),
    scannerSignOut: b.mutation({ query: ({ scannerCode, token }) => ({ url: `/scanner/${encodeURIComponent(scannerCode)}/sign-out`, method: 'post', body: {}, headers: { 'X-Scanner-Token': token } }) }),
    scannerUndo: b.mutation({ query: ({ scannerCode, token, ticketId }) => ({ url: `/scanner/${encodeURIComponent(scannerCode)}/undo`, method: 'post', body: { ticketId }, headers: { 'X-Scanner-Token': token } }) }),
    claimEvent: b.mutation({ query: ({ slug, event, code }) => ({ url: `/public/bookings/${encodeURIComponent(slug)}/events/${encodeURIComponent(event)}/claim`, method: 'post', body: { code } }) }),
    publicPage: b.query({ query: (slug) => ({ url: `/public/bookings/${encodeURIComponent(slug)}` }) }),
    publicAvailability: b.query({ query: ({ slug, ...params }) => ({ url: `/public/bookings/${encodeURIComponent(slug)}/availability`, params }), keepUnusedDataFor: 0 }),
    book: b.mutation({ query: ({ slug, ...body }) => ({ url: `/public/bookings/${encodeURIComponent(slug)}/book`, method: 'post', body }) }),
    manage: b.query({ query: (token) => ({ url: '/public/manage-booking', headers: { 'X-Booking-Token': token } }) }),
    manageAvailability: b.query({ query: ({ token, ...params }) => ({ url: '/public/manage-booking/availability', params, headers: { 'X-Booking-Token': token } }), keepUnusedDataFor: 0 }),
    manageReschedule: b.mutation({ query: ({ token, ...body }) => ({ url: '/public/manage-booking/reschedule', method: 'post', body, headers: { 'X-Booking-Token': token } }) }),
    manageCancel: b.mutation({ query: (token) => ({ url: '/public/manage-booking/cancel', method: 'post', headers: { 'X-Booking-Token': token } }) }),
  }),
});

export const {
  useConfigQuery,
  useMeQuery,
  useOnboardingMutation,
  useSetActiveBusinessMutation,
  useProfileQuery,
  useUpdateProfileMutation,
  useUpdateBusinessNameMutation,
  useTeamQuery,
  useInviteMutation,
  useCancelInviteMutation,
  useSetRoleMutation,
  useRemoveMemberMutation,
  useInvitationQuery,
  useAcceptInvitationMutation,
  useOverviewQuery,
  useSettingsQuery,
  useSaveSettingsMutation,
  useSaveHoursMutation,
  useBlockedQuery,
  useBlockMutation,
  useUnblockMutation,
  useServicesQuery,
  useCreateServiceMutation,
  useUpdateServiceMutation,
  useDeleteServiceMutation,
  useBookingsQuery,
  useDashboardQuery,
  useAddBookingMutation,
  useCancelBookingMutation,
  useRescheduleBookingMutation,
  useMarkNoShowMutation,
  useCheckInMutation,
  useUndoCheckInMutation,
  useAdminAvailabilityQuery,
  useEventsQuery,
  useLazyPlacesSuggestQuery,
  useLazyPlacesReverseQuery,
  useEventQuery,
  useCreateEventMutation,
  useUpdateEventMutation,
  useDeleteEventMutation,
  useRequestEventDeleteMutation,
  useCheckVoucherMutation,
  useIssueEventCodeMutation,
  useDeleteEventCodeMutation,
  useRevokeEventTicketMutation,
  useEventCheckInMutation,
  useUndoEventCheckInMutation,
  useRequestEventUpgradeMutation,
  useEventScannersQuery,
  useCreateEventScannerMutation,
  useNewScannerCodeMutation,
  useRevokeScannerCodeMutation,
  useDeleteEventScannerMutation,
  useAddClaimableMutation,
  useRenameClaimableMutation,
  useDeleteClaimableMutation,
  useClaimHereMutation,
  useUnclaimHereMutation,
  useEventRegistrationQuery,
  useCancelEventRegistrationMutation,
  useScannerPageQuery,
  useScannerSignInMutation,
  useScannerSessionQuery,
  useScannerCheckInMutation,
  useScannerUndoMutation,
  useScannerSignOutMutation,
  usePublicEventsQuery,
  usePublicEventQuery,
  useRegisterEventMutation,
  useClaimEventMutation,
  usePublicPageQuery,
  usePublicAvailabilityQuery,
  useBookMutation,
  useManageQuery,
  useManageAvailabilityQuery,
  useManageRescheduleMutation,
  useManageCancelMutation,
} = api;
