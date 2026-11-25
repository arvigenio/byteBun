import { createApi } from '@reduxjs/toolkit/query/react';
import { http } from '../api/client.js';

// Client management (backend/src/clients/admin/): RTK Query in the admin store. Every call needs a
// fully signed-in admin (401 otherwise: adminStore.js leaves the admin area).
const baseQuery = async ({ url, method = 'get', body, params }) => {
  try {
    const data = await (method === 'get' ? http.get(url, { params }) : http.post(url, body ?? {}));
    return { data };
  } catch (err) {
    return { error: { status: err?.status ?? 0, message: err?.message ?? 'Something went wrong.', fields: err?.fields ?? {} } };
  }
};

export const clientsApi = createApi({
  reducerPath: 'adminClientsApi',
  baseQuery,
  tagTypes: ['Clients', 'Client', 'Events', 'HostedEvents'],
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
    clientAction: b.mutation({
      // action: plan | deactivate | reactivate | delete | restore
      query: ({ id, action, ...body }) => ({ url: `/admin/clients/${encodeURIComponent(id)}/${action}`, method: 'post', body }),
      invalidatesTags: (_r, _e, { id }) => ['Clients', 'Events', { type: 'Client', id }],
    }),
  }),
});

export const { useClientsQuery, useCatalogQuery, useClientQuery, useEventsQuery, useClientActionMutation, useHostedEventsQuery, useEventVouchersQuery, useCreateEventVoucherMutation, useSetEventLimitMutation } = clientsApi;
export const clientExportUrl = (id) => `/api/admin/clients/${encodeURIComponent(id)}/export.csv`;
