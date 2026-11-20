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
  tagTypes: ['Profile', 'Me', 'Overview', 'Settings', 'Blocked', 'Services', 'Bookings', 'Team'],
  endpoints: (b) => ({
    config: b.query({ query: () => ({ url: '/client/config' }) }),
    me: b.query({ query: () => ({ url: '/client/me' }), providesTags: ['Me'] }),
    onboarding: b.mutation({ query: (body) => ({ url: '/client/onboarding', method: 'post', body }), invalidatesTags: ['Me'] }),
    setActiveBusiness: b.mutation({ query: (organizationId) => ({ url: '/client/active-business', method: 'post', body: { organizationId } }), invalidatesTags: () => ['Me', 'Overview', 'Settings', 'Blocked', 'Services', 'Bookings', 'Team'] }),
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
    bookings: b.query({ query: (params) => ({ url: '/client/bookings/items', params }), providesTags: ['Bookings'] }),
    addBooking: b.mutation({ query: (body) => ({ url: '/client/bookings/items', method: 'post', body }), invalidatesTags: ['Bookings', 'Overview'] }),
    cancelBooking: b.mutation({ query: ({ id, ...body }) => ({ url: `/client/bookings/items/${id}/cancel`, method: 'post', body }), invalidatesTags: ['Bookings', 'Overview'] }),
    markNoShow: b.mutation({ query: ({ id, noShow }) => ({ url: `/client/bookings/items/${id}/no-show`, method: 'post', body: { noShow } }), invalidatesTags: ['Bookings'] }),
    rescheduleBooking: b.mutation({ query: ({ id, ...body }) => ({ url: `/client/bookings/items/${id}/reschedule`, method: 'post', body }), invalidatesTags: ['Bookings', 'Overview'] }),
    adminAvailability: b.query({ query: (params) => ({ url: '/client/bookings/availability', params }), keepUnusedDataFor: 0, providesTags: ['Bookings'] }),

    // Public (no login)
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
  useAddBookingMutation,
  useCancelBookingMutation,
  useRescheduleBookingMutation,
  useMarkNoShowMutation,
  useAdminAvailabilityQuery,
  usePublicPageQuery,
  usePublicAvailabilityQuery,
  useBookMutation,
  useManageQuery,
  useManageAvailabilityQuery,
  useManageRescheduleMutation,
  useManageCancelMutation,
} = api;
