import { configureStore } from '@reduxjs/toolkit';
import leadForm from './leadFormSlice.js';
import manageBooking from './manageBookingSlice.js';
import chat from './chatSlice.js';

export const store = configureStore({
  reducer: { leadForm, manageBooking, chat },
});
