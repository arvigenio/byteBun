import { useSyncExternalStore } from 'react';

// A tiny History API router: the site has two pages, so a routing library would be overkill.
// Production serves index.html for every non-API path (backend/src/web/static-site.ts) and Vite does
// the same in development, so /get-started works on a fresh load too.
export const routes = {
  home: '/',
  getStarted: '/get-started',
};

// Every lead button links here; `from` is saved with the lead (see store/leadFormSlice.js).
export const leadHref = (source) => `${routes.getStarted}?from=${encodeURIComponent(source)}`;

const NAVIGATE_EVENT = 'bytebun:navigate';

function subscribe(callback) {
  window.addEventListener('popstate', callback);
  window.addEventListener(NAVIGATE_EVENT, callback);
  return () => {
    window.removeEventListener('popstate', callback);
    window.removeEventListener(NAVIGATE_EVENT, callback);
  };
}

export const usePathname = () => useSyncExternalStore(subscribe, () => window.location.pathname, () => routes.home);

export function navigate(to, { replace = false } = {}) {
  window.history[replace ? 'replaceState' : 'pushState'](null, '', to);
  window.dispatchEvent(new Event(NAVIGATE_EVENT));
}

// onClick for <a href="/..."> links between pages: client-side navigation for plain clicks,
// normal browser behavior for new-tab / modified clicks.
export function onRouteLinkClick(e) {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  navigate(e.currentTarget.getAttribute('href'));
}

// The lead source from ?from=..., if it is one the API accepts.
export function readLeadSource() {
  const from = new URLSearchParams(window.location.search).get('from') ?? '';
  return /^[a-z0-9_-]{1,50}$/i.test(from) ? from : 'website';
}
