import { configureStore, isRejected } from '@reduxjs/toolkit';
import adminAuth from './adminAuthSlice.js';
import { adminBookings, adminLeads, adminSecurity } from './adminDataSlices.js';
import adminProspects from './adminProspectsSlice.js';
import adminSavedProspects from './adminSavedProspectsSlice.js';

// Any admin API call answered 401 = the session ended (expired, or signed out from the Security
// page on another device). Leave the admin area: reloading it would only show a 404.
const leaveOnSignedOut = () => (next) => (action) => {
  const result = next(action);
  if (isRejected(action) && action.payload?.status === 401 && /^admin(Leads|Bookings|Security|Prospects)\//.test(action.type)) {
    window.location.replace('/');
  }
  return result;
};

// The admin app's own store (admin.html). Kept apart from the public site's store, so none of
// the admin code ends up in the public bundle.
export const adminStore = configureStore({
  reducer: { adminAuth, adminLeads, adminBookings, adminSecurity, adminProspects, adminSavedProspects },
  middleware: (getDefault) => getDefault().concat(leaveOnSignedOut),
});
