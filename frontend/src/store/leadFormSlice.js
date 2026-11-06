import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import { createLead } from '../api/leads.js';
import { getSlots } from '../api/booking.js';

// State for the lead page (/get-started). Field values, steps, and per-field validation live in
// react-hook-form (hooks/useLeadFormController.js); this slice owns where the visitor came
// from, the open call times for the booking calendar, and the submit request lifecycle.
const initialState = {
  source: 'website', // which button sent them here, e.g. "hero", "final-cta"
  status: 'idle', // idle | sending | success | error
  formError: '',
  // Call times from GET /api/booking/slots (ISO strings, UTC); `taken` are already booked.
  slots: { status: 'idle', items: [], taken: [], availability: null, error: '' }, // status: idle | loading | ready | error
};

export const fetchSlots = createAsyncThunk(
  'leadForm/fetchSlots',
  async (_, { rejectWithValue, signal }) => {
    try {
      return await getSlots({ signal });
    } catch (err) {
      return rejectWithValue(err.message);
    }
  },
  // One request at a time (React StrictMode runs mount effects twice in development).
  { condition: (_, { getState }) => getState().leadForm.slots.status !== 'loading' },
);

export const submitLead = createAsyncThunk('leadForm/submit', async (values, { getState, rejectWithValue, signal }) => {
  try {
    return await createLead({ ...values, source: getState().leadForm.source }, { signal });
  } catch (err) {
    // Keep the rejected payload serializable (ApiError is a class instance).
    return rejectWithValue({ message: err.message, fields: err.fields ?? {} });
  }
});

const leadFormSlice = createSlice({
  name: 'leadForm',
  initialState,
  reducers: {
    // The lead page mounted: start fresh, remembering the source.
    started(state, action) {
      state.source = action.payload || 'website';
      state.status = 'idle';
      state.formError = '';
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(fetchSlots.pending, (state) => {
        state.slots.status = 'loading';
        state.slots.error = '';
      })
      .addCase(fetchSlots.fulfilled, (state, action) => {
        state.slots = { status: 'ready', items: action.payload.slots, taken: action.payload.taken ?? [], availability: action.payload.availability, error: '' };
      })
      .addCase(fetchSlots.rejected, (state, action) => {
        state.slots.status = 'error';
        state.slots.error = action.payload || 'Could not load times.';
      })
      .addCase(submitLead.pending, (state) => {
        state.status = 'sending';
        state.formError = '';
      })
      .addCase(submitLead.fulfilled, (state) => {
        state.status = 'success';
      })
      .addCase(submitLead.rejected, (state, action) => {
        state.status = 'error';
        // Errors that belong to a field are shown next to it (see useLeadFormController), not twice.
        const hasFieldErrors = Object.keys(action.payload?.fields ?? {}).length > 0;
        state.formError = hasFieldErrors ? '' : action.payload?.message || 'Something went wrong. Please try again.';
      });
  },
});

export const { started: leadFormStarted } = leadFormSlice.actions;
export const selectLeadForm = (state) => state.leadForm;
export default leadFormSlice.reducer;
