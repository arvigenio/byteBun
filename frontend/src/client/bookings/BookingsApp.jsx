import { bookingsBase } from '../lib/surface.js';
import { NotFound } from '../pages/NotFound.jsx';
import { AccountPage } from './AccountPage.jsx';
import { BookingPageSettings } from './BookingPageSettings.jsx';
import { BookingsList } from './BookingsList.jsx';
import { DashboardPage } from './DashboardPage.jsx';
import { EventDetail, EventsPage, EventWizard } from './EventsPages.jsx';
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
    case '/check-in':
      // Check-in is a tab of the Bookings page now.
      window.history.replaceState(null, '', `${bookingsBase}${window.location.search}#check-in`);
      return <BookingsList />;
    case '/dashboard':
      return <DashboardPage />;
    case '/events':
      return <EventsPage />;
    case '/events/new':
      return <EventWizard />;
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
    default: {
      const event = /^\/events\/(\d+)$/.exec(sub);
      if (event) return <EventDetail id={Number(event[1])} />;
      return <NotFound />;
    }
  }
}

/** Can the signed-in member do this? (The API checks again.) */
export const can = (me, permission) => me?.business?.permissions?.includes(permission);
