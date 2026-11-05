import { configureStore } from '@reduxjs/toolkit';
import leadForm from './leadFormSlice.js';

export const store = configureStore({
  reducer: { leadForm },
});
