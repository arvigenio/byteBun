import { useLayoutEffect, useRef } from 'react';
import { useLenis } from 'lenis/react';
import { SmoothScroll } from './components/SmoothScroll.jsx';
import { HomePage } from './pages/HomePage.jsx';
import { GetStartedPage } from './pages/GetStartedPage.jsx';
import { ManageBookingPage } from './pages/ManageBookingPage.jsx';
import { routes, usePathname } from './lib/router.js';

const pages = {
  [routes.getStarted]: GetStartedPage,
  [routes.manageBooking]: ManageBookingPage,
};

// The landing page, the lead page, and the lead's private manage-booking page.
// Any unknown path shows the landing page.
// <head> tags (title, meta, JSON-LD) are injected at build time by seo-plugin.js, so they are in
// the static HTML for crawlers and link previews that don't run JavaScript.
export default function App() {
  const pathname = usePathname().replace(/\/+$/, '') || routes.home;
  const Page = pages[pathname] ?? HomePage;
  return (
    <SmoothScroll>
      <ScrollResetOnNavigate pathname={pathname} />
      <Page />
    </SmoothScroll>
  );
}

// A new page starts at the top. Skips the first render so /#faq links still land on #faq.
function ScrollResetOnNavigate({ pathname }) {
  const lenis = useLenis();
  const previous = useRef(pathname);
  useLayoutEffect(() => {
    if (previous.current === pathname) return;
    previous.current = pathname;
    if (lenis) lenis.scrollTo(0, { immediate: true, force: true });
    else window.scrollTo(0, 0);
  }, [pathname, lenis]);
  return null;
}
