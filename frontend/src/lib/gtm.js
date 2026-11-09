// Google Tag Manager, public site only (never the admin app). The container ID comes from
// VITE_GTM_ID at build time; it is loaded only in production builds, so local development
// doesn't show up in the stats.
//
// This is Google's standard GTM snippet as a module: the site's Content-Security-Policy blocks
// inline <script> blocks (backend/src/app.ts allows googletagmanager.com and Google Analytics).
const GTM_ID = /^GTM-[A-Z0-9]{4,12}$/;

export function loadGtm(id = import.meta.env.VITE_GTM_ID) {
  const containerId = String(id ?? '').trim().toUpperCase();
  if (!import.meta.env.PROD || !GTM_ID.test(containerId) || typeof window === 'undefined') return false;
  if (window.google_tag_manager?.[containerId]) return true; // already loaded

  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({ 'gtm.start': Date.now(), event: 'gtm.js' });
  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(containerId)}`;
  document.head.appendChild(script);
  return true;
}

/** Sends a custom event to GTM (no-op until GTM loads; dataLayer queues it). */
export function trackEvent(event, params = {}) {
  if (typeof window === 'undefined') return;
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({ event, ...params });
}
