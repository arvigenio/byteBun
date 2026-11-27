import { lazy, Suspense } from 'react';
import { usePathname } from '../lib/router.js';
import { AppGate } from './AppGate.jsx';
import { bookingsBase, surface } from './lib/surface.js';
import { Loading } from './ui.jsx';
import { AccountsHome, InvitePage, SignInPage, WelcomePage } from './pages/Accounts.jsx';
import { ManageBookingPage } from './pages/ManageBooking.jsx';
import { NotFound } from './pages/NotFound.jsx';
import { PublicBookingPage } from './pages/PublicBooking.jsx';

// The business's app (editor, settings) loads on demand, so customers' booking pages stay light.
const BookingsApp = lazy(() => import('./bookings/BookingsApp.jsx').then((m) => ({ default: m.BookingsApp })));
const BookingsLanding = lazy(() => import('./pages/BookingsLanding.jsx').then((m) => ({ default: m.BookingsLanding })));
// The dedicated check-in scanner: full screen, without the app's menu.
const ScanPage = lazy(() => import('./bookings/CheckInPage.jsx').then((m) => ({ default: m.ScanPage })));
const EventScanPage = lazy(() => import('./bookings/EventsPages.jsx').then((m) => ({ default: m.EventScanPage })));
const ScannerApp = lazy(() => import('./pages/ScannerApp.jsx').then((m) => ({ default: m.ScannerApp })));
const AffiliatePortal = lazy(() => import('./pages/AffiliatePortal.jsx').then((m) => ({ default: m.AffiliatePortal })));
const PublicEventPage = lazy(() => import('./pages/PublicEvent.jsx').then((m) => ({ default: m.PublicEventPage })));
/** /app/events/12/scan -> 12: an event's own full-screen scanner. */
const eventScan = (path) => (path.startsWith(`${bookingsBase}/events/`) ? Number(/^\/events\/(\d+)\/scan$/.exec(path.slice(bookingsBase.length))?.[1]) || null : null);
const PortalHome = lazy(() => import('./pages/PortalHome.jsx').then((m) => ({ default: m.PortalHome })));
const page = (el) => <Suspense fallback={<Loading screen />}>{el}</Suspense>;

// One app for every client host (lib/surface.js). The host decides the look; the plan
// (entitlements, from /api/client/me) decides the features.
//
//   any client host   /sign-in  /welcome  /invite/:id
//   accounts          /  -> where the client lands (their only app, or the portal)
//   bookings          /  product page (signed in: -> /app)   /app/*  the Bookings app (standalone)    /manage  customer's link    /{slug}  public page
//                     /app/scan (portal: /bookings/scan)  the full-screen check-in scanner, no app menu
//                     /app/events/:id/scan  an event's own scanner    /{slug}/e/{event}  public event page
//   scanner           /  sign in (scanner code + access code)   /{company}/{event}/{scannerCode}  a scanner's link
//   affiliates        /  sign in, then the dashboard   /join#t=...  accept a proposal
//   clientportal      /  app tiles     /bookings/*  the Bookings app inside the portal
export default function ClientApp() {
  const path = usePathname().replace(/\/+$/, '') || '/';

  // The attendance scanner site: its own sign-in (scanner code + access code), no account.
  if (surface === 'scanner') return page(<ScannerApp />);
  // The affiliate portal: its own sign-in (email + emailed code), no business account.
  if (surface === 'affiliates') return page(<AffiliatePortal path={path} />);
  if (path === '/sign-in') return <SignInPage />;
  if (path === '/welcome') return <WelcomePage />;
  const invite = /^\/invite\/([^/]+)$/.exec(path);
  if (invite) return <InvitePage id={decodeURIComponent(invite[1])} />;

  if (surface === 'accounts') return path === '/' ? <AccountsHome /> : <NotFound />;

  if (surface === 'portal') {
    if (path === '/') return <AppGate shell="portal" page={page(<PortalHome />)} />;
    if (path === `${bookingsBase}/scan`) return <AppGate bare shell="portal" app="bookings" page={page(<ScanPage />)} />;
    if (eventScan(path)) return <AppGate bare shell="portal" app="bookings" page={page(<EventScanPage id={eventScan(path)} />)} />;
    if (path === bookingsBase || path.startsWith(`${bookingsBase}/`)) return <AppGate shell="portal" app="bookings" page={page(<BookingsApp sub={path.slice(bookingsBase.length) || '/'} />)} />;
    return <NotFound />;
  }

  // bookings host: new visitors see the product page; signed-in people go to their app.
  if (path === '/') return <AccountsHome guest={page(<BookingsLanding />)} />;
  if (path === '/manage') return <ManageBookingPage />;
  if (path === `${bookingsBase}/scan`) return <AppGate bare shell="bookings" app="bookings" page={page(<ScanPage />)} />;
  if (eventScan(path)) return <AppGate bare shell="bookings" app="bookings" page={page(<EventScanPage id={eventScan(path)} />)} />;
  if (path === bookingsBase || path.startsWith(`${bookingsBase}/`)) return <AppGate shell="bookings" app="bookings" page={page(<BookingsApp sub={path.slice(bookingsBase.length) || '/'} />)} />;
  const ev = /^\/([a-z0-9-]{3,60})\/e\/([a-z0-9-]{3,60})$/.exec(path);
  if (ev) return page(<PublicEventPage slug={ev[1]} event={ev[2]} />);
  const slug = /^\/([a-z0-9-]{3,60})$/.exec(path);
  if (slug) return <PublicBookingPage slug={slug[1]} />;
  return <NotFound />;
}
