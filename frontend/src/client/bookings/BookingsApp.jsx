import { NotFound } from '../pages/NotFound.jsx';
import { AccountPage } from './AccountPage.jsx';
import { BookingPageSettings } from './BookingPageSettings.jsx';
import { BookingsList } from './BookingsList.jsx';
import { PlanPage } from './PlanPage.jsx';
import { SchedulePage } from './SchedulePage.jsx';
import { ServicesPage } from './ServicesPage.jsx';
import { TeamPage } from './TeamPage.jsx';

// The Bookings app's pages. Same components in the standalone app (/app/*) and the portal
// (/bookings/*); `sub` is the path after that base.
export function BookingsApp({ sub }) {
  switch (sub) {
    case '/':
      return <BookingsList />;
    case '/services':
      return <ServicesPage />;
    case '/schedule':
      return <SchedulePage />;
    case '/page':
      return <BookingPageSettings />;
    case '/team':
      return <TeamPage />;
    case '/plan':
      return <PlanPage />;
    case '/account':
      return <AccountPage />;
    default:
      return <NotFound />;
  }
}

/** Can the signed-in member do this? (The API checks again.) */
export const can = (me, permission) => me?.business?.permissions?.includes(permission);
