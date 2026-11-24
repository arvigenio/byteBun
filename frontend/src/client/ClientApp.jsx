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
const PortalHome = lazy(() => import('./pages/PortalHome.jsx').then((m) => ({ default: m.PortalHome })));
const page = (el) => <Suspense fallback={<Loading />}>{el}</Suspense>;

// One app for every client host (lib/surface.js). The host decides the look; the plan
// (entitlements, from /api/client/me) decides the features.
//
//   any client host   /sign-in  /welcome  /invite/:id
//   accounts          /  -> where the client lands (their only app, or the portal)
//   bookings          /  product page (signed in: -> /app)   /app/*  the Bookings app (standalone)    /manage  customer's link    /{slug}  public page
//                     /app/scan (portal: /bookings/scan)  the full-screen check-in scanner, no app menu
//   clientportal      /  app tiles     /bookings/*  the Bookings app inside the portal
export default function ClientApp() {
  const path = usePathname().replace(/\/+$/, '') || '/';

  if (path === '/sign-in') return <SignInPage />;
  if (path === '/welcome') return <WelcomePage />;
  const invite = /^\/invite\/([^/]+)$/.exec(path);
  if (invite) return <InvitePage id={decodeURIComponent(invite[1])} />;

  if (surface === 'accounts') return path === '/' ? <AccountsHome /> : <NotFound />;

  if (surface === 'portal') {
    if (path === '/') return <AppGate shell="portal" page={page(<PortalHome />)} />;
    if (path === `${bookingsBase}/scan`) return <AppGate bare shell="portal" app="bookings" page={page(<ScanPage />)} />;
    if (path === bookingsBase || path.startsWith(`${bookingsBase}/`)) return <AppGate shell="portal" app="bookings" page={page(<BookingsApp sub={path.slice(bookingsBase.length) || '/'} />)} />;
    return <NotFound />;
  }

  // bookings host: new visitors see the product page; signed-in people go to their app.
  if (path === '/') return <AccountsHome guest={page(<BookingsLanding />)} />;
  if (path === '/manage') return <ManageBookingPage />;
  if (path === `${bookingsBase}/scan`) return <AppGate bare shell="bookings" app="bookings" page={page(<ScanPage />)} />;
  if (path === bookingsBase || path.startsWith(`${bookingsBase}/`)) return <AppGate shell="bookings" app="bookings" page={page(<BookingsApp sub={path.slice(bookingsBase.length) || '/'} />)} />;
  const slug = /^\/([a-z0-9-]{3,60})$/.exec(path);
  if (slug) return <PublicBookingPage slug={slug[1]} />;
  return <NotFound />;
}
