import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import { createLead } from '../api/leads.js';

// UI state for the lead form dialog. Field values and per-field validation live in
// react-hook-form (see components/LeadForm.jsx); this slice owns whether the dialog is open,
// where it was opened from, and the submit request lifecycle.
const initialState = {
  isOpen: false,
  source: 'website', // which button opened the form, e.g. "hero", "final-cta"
  session: 0, // bumped on every open so the form remounts with empty fields
  status: 'idle', // idle | sending | success | error
  formError: '',
};

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
    opened(state, action) {
      if (state.isOpen) return;
      state.isOpen = true;
      state.source = action.payload || 'website';
      state.session += 1;
      state.status = 'idle';
      state.formError = '';
    },
    closed(state) {
      state.isOpen = false;
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(submitLead.pending, (state) => {
        state.status = 'sending';
        state.formError = '';
      })
      .addCase(submitLead.fulfilled, (state) => {
        state.status = 'success';
      })
      .addCase(submitLead.rejected, (state, action) => {
        state.status = 'error';
        state.formError = action.payload?.message || 'Something went wrong. Please try again.';
      });
  },
});

export const { opened: openLeadForm, closed: closeLeadForm } = leadFormSlice.actions;
export const selectLeadForm = (state) => state.leadForm;
export default leadFormSlice.reducer;
