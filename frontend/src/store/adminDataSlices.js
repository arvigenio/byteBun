import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import * as adminApi from '../api/admin.js';

// Data for the admin pages: leads, bookings, and the Security page.
// A 401 from any of these means the session ended (expired or signed out elsewhere); the
// admin app then leaves the admin area (see hooks/admin/useAdminGuard.js).
const fail = (err) => ({ message: err.message, status: err.status, fields: err.fields ?? {} });
const thunk = (type, fn, options) =>
  createAsyncThunk(
    type,
    async (arg, api) => {
      try {
        return await fn(arg, api);
      } catch (err) {
        return api.rejectWithValue(fail(err));
      }
    },
    options,
  );

// ---- leads ----
export const fetchLeads = thunk('adminLeads/fetch', (query, { signal }) => adminApi.listLeads(query, { signal }));
export const fetchLead = thunk('adminLeads/fetchOne', (id, { signal }) => adminApi.getLead(id, { signal }));
/** Partial update: `fields` holds only what changed (e.g. { status } or the whole edit form). */
export const updateLead = thunk('adminLeads/update', ({ id, fields }) => adminApi.updateLead(id, fields));
// Goal/feature/status choices for the edit form; loaded once.
export const fetchLeadOptions = thunk('adminLeads/options', (_, { signal }) => adminApi.getLeadOptions({ signal }), {
  condition: (_, { getState }) => !getState().adminLeads.options,
});

const leads = createSlice({
  name: 'adminLeads',
  initialState: {
    query: { q: '', status: '', from: '', page: 1 },
    items: [],
    total: 0,
    pageSize: 25,
    // Where the matching leads came from (GET /api/admin/leads -> sources).
    sources: null,
    status: 'idle',
    error: '',
    // The lead drawer (opened from Leads or Bookings): the lead, and what it shows:
    // view | edit | reschedule | cancel
    selected: null,
    selectedLoading: false,
    drawerMode: 'view',
    options: null,
  },
  reducers: {
    queryChanged(state, { payload }) {
      state.query = { ...state.query, ...payload };
    },
    leadClosed(state) {
      state.selected = null;
      state.drawerMode = 'view';
    },
    drawerModeChanged(state, { payload }) {
      state.drawerMode = payload;
    },
    editStarted(state) {
      state.drawerMode = 'edit';
    },
    editCancelled(state) {
      state.drawerMode = 'view';
    },
  },
  extraReducers: (b) =>
    b
      .addCase(fetchLeads.pending, (s, { meta }) => {
        s.status = 'loading';
        s.error = '';
        s.query = { ...s.query, ...meta.arg };
      })
      .addCase(fetchLeads.fulfilled, (s, { payload }) => {
        s.status = 'ready';
        s.items = payload.items;
        s.total = payload.total;
        s.pageSize = payload.pageSize;
        s.sources = payload.sources ?? null;
      })
      .addCase(fetchLeads.rejected, (s, { payload, meta }) => {
        if (meta.aborted) return;
        s.status = 'error';
        s.error = payload?.message ?? '';
      })
      .addCase(fetchLead.pending, (s, { meta }) => {
        s.selectedLoading = true;
        // Another lead: start on its details. The same lead (a live refresh): keep the mode.
        if (s.selected?.id !== meta.arg) {
          s.selected = null;
          s.drawerMode = 'view';
        }
      })
      .addCase(fetchLead.fulfilled, (s, { payload }) => {
        s.selectedLoading = false;
        s.selected = payload;
      })
      .addCase(fetchLead.rejected, (s) => {
        s.selectedLoading = false;
      })
      .addCase(fetchLeadOptions.fulfilled, (s, { payload }) => {
        s.options = payload;
      })
      .addCase(updateLead.fulfilled, (s, { payload }) => {
        s.selected = payload;
        s.drawerMode = 'view';
        const i = s.items.findIndex((l) => l.id === payload.id);
        if (i >= 0) s.items[i] = payload;
      }),
});

// ---- bookings ----
export const fetchBookings = thunk('adminBookings/fetch', (when, { signal }) => adminApi.listBookings(when, { signal }));
/** Admin cancels a call: the lead and the other admins are emailed (with the optional note). */
export const cancelBookingAdmin = thunk('adminBookings/cancel', async ({ bookingId, leadId, note }, { dispatch }) => {
  await adminApi.cancelBooking(bookingId, note || undefined);
  if (leadId) dispatch(fetchLead(leadId));
  return bookingId;
});
export const removeBooking = (bookingId) => cancelBookingAdmin({ bookingId });
/** Admin moves a call to another open time; same emails as cancelling. */
export const rescheduleBookingAdmin = thunk('adminBookings/reschedule', async ({ bookingId, leadId, startsAt, note }, { dispatch }) => {
  const res = await adminApi.rescheduleBooking(bookingId, { startsAt, note: note || undefined });
  if (leadId) dispatch(fetchLead(leadId));
  return res;
});
/**
 * Admin books an open slot for someone (Bookings page). The lists, calendar and open times reload
 * right away, without waiting for the live update.
 */
export const createBookingAdmin = thunk('adminBookings/create', async (fields, { dispatch }) => {
  const res = await adminApi.createBooking(fields);
  dispatch(refreshAfterEvent({ lead: res.lead }));
  return res;
});
/** Open call times for the reschedule and new-booking pickers. */
export const fetchBookingSlots = thunk('adminBookings/slots', (_, { signal }) => adminApi.getBookingSlots({ signal }));

/** Calendar month: { month: 'YYYY-MM', from, to } (from/to = the first and last day shown in the grid). */
export const fetchCalendar = thunk('adminBookings/calendar', ({ from, to }, { signal }) => adminApi.listBookingsBetween(from, to, { signal }));

// Keeps names in booking lists in step after a lead is edited.
const syncLead = (list, lead) => {
  for (const b of list) if (b.lead?.id === lead.id) Object.assign(b.lead, { firstName: lead.firstName, lastName: lead.lastName, email: lead.email, phone: lead.phone, businessName: lead.businessName, status: lead.status });
};

const thisMonth = () => new Date().toISOString().slice(0, 7);

const bookings = createSlice({
  name: 'adminBookings',
  initialState: {
    view: 'calendar', // 'calendar' | 'list'
    when: 'upcoming',
    items: [],
    status: 'idle',
    error: '',
    calendar: { month: thisMonth(), range: null, items: [], status: 'idle', error: '' },
    slots: { status: 'idle', items: [], taken: [], error: '' },
  },
  reducers: {
    viewChanged(s, { payload }) {
      s.view = payload;
    },
    monthChanged(s, { payload }) {
      s.calendar.month = payload;
    },
  },
  extraReducers: (b) =>
    b
      .addCase(fetchBookingSlots.pending, (s) => {
        s.slots.status = 'loading';
        s.slots.error = '';
      })
      .addCase(fetchBookingSlots.fulfilled, (s, { payload }) => {
        s.slots = { status: 'ready', items: payload.slots, taken: payload.taken, error: '' };
      })
      .addCase(fetchBookingSlots.rejected, (s, { payload, meta }) => {
        if (meta.aborted) return;
        s.slots.status = 'error';
        s.slots.error = payload?.message ?? '';
      })
      .addCase(fetchCalendar.pending, (s, { meta }) => {
        s.calendar.range = meta.arg;
        s.calendar.status = s.calendar.items.length ? 'refreshing' : 'loading';
        s.calendar.error = '';
      })
      .addCase(fetchCalendar.fulfilled, (s, { payload }) => {
        s.calendar.status = 'ready';
        s.calendar.items = payload.items;
      })
      .addCase(fetchCalendar.rejected, (s, { payload, meta }) => {
        if (meta.aborted) return;
        s.calendar.status = 'error';
        s.calendar.error = payload?.message ?? '';
      })
      .addCase(updateLead.fulfilled, (s, { payload }) => {
        syncLead(s.items, payload);
        syncLead(s.calendar.items, payload);
      })
      .addCase(fetchBookings.pending, (s, { meta }) => {
        s.status = 'loading';
        s.error = '';
        s.when = meta.arg;
      })
      .addCase(fetchBookings.fulfilled, (s, { payload }) => {
        s.status = 'ready';
        s.items = payload.items;
      })
      .addCase(fetchBookings.rejected, (s, { payload, meta }) => {
        if (meta.aborted) return;
        s.status = 'error';
        s.error = payload?.message ?? '';
      })
      .addCase(cancelBookingAdmin.fulfilled, (s, { payload }) => {
        s.items = s.items.filter((x) => x.id !== payload);
        s.calendar.items = s.calendar.items.filter((x) => x.id !== payload);
      }),
});

// ---- security ----
export const fetchSecurity = thunk('adminSecurity/fetch', (_, { signal }) => adminApi.getSecurity({ signal }));
export const signOutSession = thunk('adminSecurity/revoke', (id) => adminApi.revokeSession(id));
export const signOutOtherSessions = thunk('adminSecurity/revokeOthers', () => adminApi.revokeOtherSessions());
export const newBackupCodes = thunk('adminSecurity/regenerate', (code) => adminApi.regenerateBackupCodes(code));

const security = createSlice({
  name: 'adminSecurity',
  initialState: { data: null, status: 'idle', error: '', newCodes: [], notice: '' },
  reducers: {
    newCodesDismissed(s) {
      s.newCodes = [];
    },
  },
  extraReducers: (b) =>
    b
      .addCase(fetchSecurity.pending, (s) => {
        s.status = s.data ? 'refreshing' : 'loading';
        s.error = '';
      })
      .addCase(fetchSecurity.fulfilled, (s, { payload }) => {
        s.status = 'ready';
        s.data = payload;
      })
      .addCase(fetchSecurity.rejected, (s, { payload, meta }) => {
        if (meta.aborted) return;
        s.status = 'error';
        s.error = payload?.message ?? '';
      })
      .addCase(signOutOtherSessions.fulfilled, (s, { payload }) => {
        s.notice = payload.signedOut ? `Signed out ${payload.signedOut} other device${payload.signedOut === 1 ? '' : 's'}.` : 'No other devices were signed in.';
      })
      .addCase(signOutSession.fulfilled, (s) => {
        s.notice = 'That device is signed out.';
      })
      .addCase(newBackupCodes.fulfilled, (s, { payload }) => {
        s.newCodes = payload.backupCodes;
        if (s.data) s.data.backupCodesRemaining = payload.backupCodes.length;
      }),
});

export const { queryChanged, leadClosed, editStarted, editCancelled, drawerModeChanged } = leads.actions;
export const { viewChanged, monthChanged } = bookings.actions;
export const { newCodesDismissed } = security.actions;
export const adminLeads = leads.reducer;
export const adminBookings = bookings.reducer;
export const adminSecurity = security.reducer;

/**
 * A live event arrived (another admin, or a lead, changed something): reload what is on screen.
 * The lead being edited in the drawer is left alone, so nobody loses what they are typing.
 */
export const refreshAfterEvent = (event) => (dispatch, getState) => {
  const { adminLeads, adminBookings } = getState();
  if (adminLeads.status !== 'idle') dispatch(fetchLeads(adminLeads.query));
  if (adminBookings.calendar.range) dispatch(fetchCalendar(adminBookings.calendar.range));
  if (adminBookings.status !== 'idle') dispatch(fetchBookings(adminBookings.when));
  if (adminBookings.slots.status !== 'idle') dispatch(fetchBookingSlots());
  const open = adminLeads.selected;
  if (open && event?.lead?.id === open.id && adminLeads.drawerMode === 'view') dispatch(fetchLead(open.id));
};

/** Opens the lead drawer, optionally straight on a mode (e.g. 'cancel' from the bookings list). */
export const openLead = (id, mode = 'view') => async (dispatch) => {
  await dispatch(fetchLead(id));
  if (mode !== 'view') dispatch(leads.actions.drawerModeChanged(mode));
};
