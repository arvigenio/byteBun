import { configureStore } from '@reduxjs/toolkit';
import leadForm from './leadFormSlice.js';
import manageBooking from './manageBookingSlice.js';

export const store = configureStore({
  reducer: { leadForm, manageBooking },
});
