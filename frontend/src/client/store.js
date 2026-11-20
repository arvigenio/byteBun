import { configureStore } from '@reduxjs/toolkit';
import { api } from './api.js';

// The client app's own store (client.html), apart from the public site's and the admin's.
// Server data lives in RTK Query's cache (api.js); UI state stays in components.
export const clientStore = configureStore({
  reducer: { [api.reducerPath]: api.reducer },
  middleware: (getDefault) => getDefault().concat(api.middleware),
});
