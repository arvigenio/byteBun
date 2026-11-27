import { createApi } from '@reduxjs/toolkit/query/react';
import { http } from '../api/client.js';

// Client management (backend/src/clients/admin/): RTK Query in the admin store. Every call needs a
// fully signed-in admin (401 otherwise: adminStore.js leaves the admin area).
const baseQuery = async ({ url, method = 'get', body, params }) => {
  try {
    const data = await (method === 'get' ? http.get(url, { params }) : method === 'delete' ? http.delete(url) : http[method](url, body ?? {}, body instanceof FormData ? { timeout: 120_000 } : undefined));
    return { data };
  } catch (err) {
    return { error: { status: err?.status ?? 0, message: err?.message ?? 'Something went wrong.', fields: err?.fields ?? {} } };
  }
};

export const clientsApi = createApi({
  reducerPath: 'adminClientsApi',
  baseQuery,
  tagTypes: ['Clients', 'Client', 'Events', 'HostedEvents', 'Affiliates', 'PlanPayments', 'PlanChannels'],
  endpoints: (b) => ({
    clients: b.query({ query: (params) => ({ url: '/admin/clients', params }), providesTags: ['Clients'] }),
    catalog: b.query({ query: () => ({ url: '/admin/clients/catalog' }) }),
    client: b.query({ query: (id) => ({ url: `/admin/clients/${encodeURIComponent(id)}` }), providesTags: (_r, _e, id) => [{ type: 'Client', id }] }),
    events: b.query({ query: (params) => ({ url: '/admin/clients/events', params }), providesTags: ['Events'] }),
    // The client's own events (seminars, webinars) and the vouchers for bigger ones.
    hostedEvents: b.query({ query: (id) => ({ url: `/admin/clients/${encodeURIComponent(id)}/hosted-events` }), providesTags: ['HostedEvents'] }),
    eventVouchers: b.query({ query: (id) => ({ url: `/admin/clients/${encodeURIComponent(id)}/event-vouchers` }), providesTags: ['HostedEvents'] }),
    createEventVoucher: b.mutation({ query: ({ id, ...body }) => ({ url: `/admin/clients/${encodeURIComponent(id)}/event-vouchers`, method: 'post', body }), invalidatesTags: ['HostedEvents', 'Events'] }),
    setEventLimit: b.mutation({ query: ({ id, eventId, ...body }) => ({ url: `/admin/clients/${encodeURIComponent(id)}/hosted-events/${eventId}/limit`, method: 'post', body }), invalidatesTags: ['HostedEvents', 'Events'] }),
    // Byte Bun's affiliates (backend clients/affiliates/): ranked, invited by email, commissions.
    affiliates: b.query({ query: (sort) => ({ url: '/admin/affiliates', params: { sort } }), providesTags: ['Affiliates'] }),
    affiliate: b.query({ query: (id) => ({ url: `/admin/affiliates/${id}` }), providesTags: ['Affiliates'] }),
    addAffiliate: b.mutation({ query: (body) => ({ url: '/admin/affiliates', method: 'post', body }), invalidatesTags: ['Affiliates'] }),
    updateAffiliate: b.mutation({ query: ({ id, ...body }) => ({ url: `/admin/affiliates/${id}`, method: 'patch', body }), invalidatesTags: ['Affiliates'] }),
    resendAffiliate: b.mutation({ query: (id) => ({ url: `/admin/affiliates/${id}/resend`, method: 'post' }), invalidatesTags: ['Affiliates'] }),
    deleteAffiliate: b.mutation({ query: (id) => ({ url: `/admin/affiliates/${id}`, method: 'delete' }), invalidatesTags: ['Affiliates'] }),
    payAffiliate: b.mutation({ query: ({ id, ...body }) => ({ url: `/admin/affiliates/${id}/payout`, method: 'post', body }), invalidatesTags: ['Affiliates'] }),
    // Plan payments to verify, and Byte Bun's payment channels shown on the Plan page.
    planPayments: b.query({ query: (status) => ({ url: '/admin/plan-payments', params: { status } }), providesTags: ['PlanPayments'] }),
    reviewPlanPayment: b.mutation({ query: ({ id, action, ...body }) => ({ url: `/admin/plan-payments/${id}/${action}`, method: 'post', body }), invalidatesTags: ['PlanPayments', 'Affiliates', 'Clients', 'Client', 'Events'] }),
    planChannels: b.query({ query: () => ({ url: '/admin/plan-payment-channels' }), providesTags: ['PlanChannels'] }),
    addPlanChannel: b.mutation({ query: (form) => ({ url: '/admin/plan-payment-channels', method: 'post', body: form }), invalidatesTags: ['PlanChannels'] }),
    updatePlanChannel: b.mutation({ query: ({ id, form }) => ({ url: `/admin/plan-payment-channels/${id}`, method: 'patch', body: form }), invalidatesTags: ['PlanChannels'] }),
    deletePlanChannel: b.mutation({ query: (id) => ({ url: `/admin/plan-payment-channels/${id}`, method: 'delete' }), invalidatesTags: ['PlanChannels'] }),
    clientAction: b.mutation({
      // action: plan | deactivate | reactivate | delete | restore
      query: ({ id, action, ...body }) => ({ url: `/admin/clients/${encodeURIComponent(id)}/${action}`, method: 'post', body }),
      invalidatesTags: (_r, _e, { id }) => ['Clients', 'Events', { type: 'Client', id }],
    }),
  }),
});

export const { useClientsQuery, useCatalogQuery, useClientQuery, useEventsQuery, useClientActionMutation, useHostedEventsQuery, useEventVouchersQuery, useCreateEventVoucherMutation, useSetEventLimitMutation } = clientsApi;
export const clientExportUrl = (id) => `/api/admin/clients/${encodeURIComponent(id)}/export.csv`;
export const {
  useAffiliatesQuery,
  useAffiliateQuery,
  useAddAffiliateMutation,
  useUpdateAffiliateMutation,
  useResendAffiliateMutation,
  useDeleteAffiliateMutation,
  usePayAffiliateMutation,
  usePlanPaymentsQuery,
  useReviewPlanPaymentMutation,
  usePlanChannelsQuery,
  useAddPlanChannelMutation,
  useUpdatePlanChannelMutation,
  useDeletePlanChannelMutation,
} = clientsApi;
export const planProofUrl = (id) => `/api/admin/plan-payments/${id}/proof`;
