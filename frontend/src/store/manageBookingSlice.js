import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import { cancelManagedBooking, getManagedBooking, rescheduleManagedBooking } from '../api/manageBooking.js';

// State for the lead's private /manage-booking page: their call, and rescheduling or
// cancelling it. The open times for the calendar come from the lead form's slots
// (leadFormSlice.fetchSlots, the same public list BookingCalendar refreshes).
const initialState = {
  token: '',
  status: 'idle', // idle | loading | ready | invalid | error
  error: '',
  firstName: '',
  booking: null, // { startsAt, timeZone } | null (no call booked, e.g. cancelled)
  canChange: false,
  mode: 'view', // view | reschedule | confirmCancel
  action: 'idle', // idle | sending
  actionError: '',
  done: null, // null | 'rescheduled' | 'cancelled' | 'booked': the change just made, for the banner
};

// Plain, serializable error payloads (ApiError is a class instance).
// `error` is the server's code: invalid_link, slot_taken, call_started, no_booking, ...
const reject = (err) => ({ status: err.status ?? 0, error: err.cause?.response?.data?.error ?? '', message: err.message, fields: err.fields ?? {} });

export const loadManagedBooking = createAsyncThunk(
  'manageBooking/load',
  async (_, { getState, rejectWithValue, signal }) => {
    try {
      return await getManagedBooking(getState().manageBooking.token, { signal });
    } catch (err) {
      return rejectWithValue(reject(err));
    }
  },
  { condition: (_, { getState }) => getState().manageBooking.status !== 'loading' },
);

export const rescheduleCall = createAsyncThunk(
  'manageBooking/reschedule',
  async (values, { getState, rejectWithValue, signal }) => {
    try {
      return await rescheduleManagedBooking(getState().manageBooking.token, values, { signal });
    } catch (err) {
      return rejectWithValue(reject(err));
    }
  },
  // One change at a time: a double click must not send two requests.
  { condition: (_, { getState }) => getState().manageBooking.action !== 'sending' },
);

export const cancelCall = createAsyncThunk(
  'manageBooking/cancel',
  async (_, { getState, rejectWithValue, signal }) => {
    try {
      return await cancelManagedBooking(getState().manageBooking.token, { signal });
    } catch (err) {
      return rejectWithValue(reject(err));
    }
  },
  { condition: (_, { getState }) => getState().manageBooking.action !== 'sending' },
);

// A wrong, tampered or revoked link answers 404 invalid_link (see manage-booking.controller.ts).
const isInvalidLink = (payload) => payload?.error === 'invalid_link';

const manageBookingSlice = createSlice({
  name: 'manageBooking',
  initialState,
  reducers: {
    // The page mounted with the token from its URL ('' when there is none).
    started(state, action) {
      Object.assign(state, initialState, { token: action.payload, status: action.payload ? 'idle' : 'invalid' });
    },
    modeChanged(state, action) {
      state.mode = action.payload;
      state.actionError = '';
      if (action.payload !== 'view') state.done = null;
    },
  },
  extraReducers: (builder) => {
    const changeFailed = (state, action) => {
      state.action = 'idle';
      if (isInvalidLink(action.payload)) {
        state.status = 'invalid';
        return;
      }
      // Errors that belong to the time field are shown next to the calendar, not twice.
      const hasFieldErrors = Object.keys(action.payload?.fields ?? {}).length > 0;
      state.actionError = hasFieldErrors ? '' : action.payload?.message || 'Something went wrong. Please try again.';
    };

    builder
      .addCase(loadManagedBooking.pending, (state) => {
        state.status = 'loading';
        state.error = '';
      })
      .addCase(loadManagedBooking.fulfilled, (state, action) => {
        const { firstName, booking, canChange } = action.payload;
        Object.assign(state, { status: 'ready', firstName, booking, canChange, actionError: '' });
        if (!canChange) state.mode = 'view';
      })
      .addCase(loadManagedBooking.rejected, (state, action) => {
        state.status = isInvalidLink(action.payload) ? 'invalid' : 'error';
        state.error = action.payload?.message || 'Something went wrong. Please try again.';
      })
      .addCase(rescheduleCall.pending, (state) => {
        state.action = 'sending';
        state.actionError = '';
      })
      .addCase(rescheduleCall.fulfilled, (state, action) => {
        state.done = state.booking ? 'rescheduled' : 'booked';
        Object.assign(state, { action: 'idle', mode: 'view', booking: action.payload.booking, canChange: true });
      })
      .addCase(rescheduleCall.rejected, changeFailed)
      .addCase(cancelCall.pending, (state) => {
        state.action = 'sending';
        state.actionError = '';
      })
      .addCase(cancelCall.fulfilled, (state) => {
        Object.assign(state, { action: 'idle', mode: 'view', booking: null, canChange: true, done: 'cancelled' });
      })
      .addCase(cancelCall.rejected, changeFailed);
  },
});

export const { started: manageBookingStarted, modeChanged: manageModeChanged } = manageBookingSlice.actions;
export const selectManageBooking = (state) => state.manageBooking;
export default manageBookingSlice.reducer;
