// How the visitor reached the site, sent with their booking so the team can see which channels
// bring calls in (backend/src/leads/attribution.ts classifies it; the browser only collects clues).
//
// Kept: the last visit that came from somewhere (a tagged link, an ad or social click, another
// site), for 30 days. A later direct visit (typing the address, a bookmark) doesn't replace it,
// so "saw us on Facebook, came back two days later and booked" still counts as Facebook.
//
// Tip for social posts and bios: tag the link, e.g.
//   https://bytebuntech.com/?utm_source=instagram&utm_medium=social&utm_campaign=bio
// In-app browsers (Instagram, Facebook, TikTok) often send no referrer, so tags are the surest way.

const KEY = 'bb-attribution';
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const CLICK_IDS = ['gclid', 'gbraid', 'wbraid', 'msclkid', 'ttclid', 'fbclid', 'igshid', 'li_fat_id', 'twclid'];

const clip = (v, max) => (v ? String(v).trim().slice(0, max) : undefined);

function read() {
  try {
    const saved = JSON.parse(window.localStorage.getItem(KEY) ?? 'null');
    return saved && Date.now() - saved.at < MAX_AGE_MS ? saved : null;
  } catch {
    return null;
  }
}

/** Call once when the public site loads. */
export function captureAttribution() {
  try {
    const params = new URLSearchParams(window.location.search);
    let referrer;
    try {
      const ref = document.referrer ? new URL(document.referrer) : null;
      // Only the site's address (no path or query: those can hold personal details).
      if (ref && ref.host !== window.location.host) referrer = ref.origin;
    } catch {
      /* not a URL */
    }
    const touch = {
      utmSource: clip(params.get('utm_source'), 100),
      utmMedium: clip(params.get('utm_medium'), 100),
      utmCampaign: clip(params.get('utm_campaign'), 100),
      clickIds: CLICK_IDS.filter((id) => params.has(id)),
      referrer,
      landingPath: window.location.pathname.slice(0, 300),
      at: Date.now(),
    };
    const fromSomewhere = touch.utmSource || touch.utmMedium || touch.clickIds.length || touch.referrer;
    if (fromSomewhere || !read()) window.localStorage.setItem(KEY, JSON.stringify(touch));
  } catch {
    /* storage blocked: the booking is sent without it */
  }
}

/** What to send with a booking (POST /api/leads `attribution`), or undefined. */
export function getAttribution() {
  const saved = read();
  if (!saved) return undefined;
  const { at: _at, ...clues } = saved;
  return clues;
}
