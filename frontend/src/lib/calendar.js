// Date helpers for the booking calendar. Everything goes through Intl, so time zones, daylight
// saving, and the visitor's language and 12/24-hour preference are handled by the browser.
// Dates are keyed as 'YYYY-MM-DD' strings in the chosen time zone.

const locale = undefined; // the browser's language

export function detectTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

const keyFormatters = new Map();
// 'YYYY-MM-DD' for an instant, in `timeZone`.
export function dateKey(iso, timeZone) {
  let f = keyFormatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
    keyFormatters.set(timeZone, f);
  }
  return f.format(new Date(iso));
}

// Slots grouped by local date: Map<'YYYY-MM-DD', iso[]>, in time order.
export function groupByDate(slots, timeZone) {
  const groups = new Map();
  for (const iso of slots) {
    const key = dateKey(iso, timeZone);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(iso);
  }
  return groups;
}

// A date key as a UTC Date at noon, for calendar math and formatting with timeZone: 'UTC'.
const keyToDate = (key) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 12));
};
const toKey = (date) => date.toISOString().slice(0, 10);

export const monthOf = (key) => key.slice(0, 7); // 'YYYY-MM'

export function addMonths(month, n) {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 7);
}

// Weeks (Sunday first) for a month: arrays of 7 date keys, null outside the month.
export function monthGrid(month) {
  const [y, m] = month.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1, 12));
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells = Array(first.getUTCDay()).fill(null);
  for (let d = 1; d <= days; d++) cells.push(toKey(new Date(Date.UTC(y, m - 1, d, 12))));
  while (cells.length % 7) cells.push(null);
  return Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7));
}

// Short weekday names, Sunday first, in the visitor's language.
export function weekdayNames() {
  const f = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' });
  return Array.from({ length: 7 }, (_, i) => f.format(new Date(Date.UTC(2023, 0, 1 + i, 12)))); // 2023-01-01 was a Sunday
}

export const formatMonth = (month) => new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(keyToDate(`${month}-01`));
export const formatDay = (key) => new Intl.DateTimeFormat(locale, { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(keyToDate(key));
export const dayNumber = (key) => Number(key.slice(8, 10));
export const formatTime = (iso, timeZone) => new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', timeZone }).format(new Date(iso));

// "Saturday, November 7 at 8:00 PM EST"
export const formatWhen = (iso, timeZone) =>
  new Intl.DateTimeFormat(locale, { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short', timeZone }).format(new Date(iso));

// 'night' | 'morning' | 'afternoon' | 'evening' for the slot's local hour.
export function periodOf(iso, timeZone) {
  const hour = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone }).format(new Date(iso)));
  if (hour < 5) return 'night';
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

// Our hours ({ start: '18:30', end: '05:00', utcOffsetMinutes, timeZone } from the API) as
// times in our zone and in the visitor's, using tonight's window so daylight saving is right.
export function describeHours(availability, timeZone) {
  const toMinutes = (hhmm) => {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
  };
  const offset = availability.utcOffsetMinutes * 60_000;
  const ours = new Date(Date.now() + offset);
  const midnight = Date.UTC(ours.getUTCFullYear(), ours.getUTCMonth(), ours.getUTCDate()) - offset;
  const startMin = toMinutes(availability.start);
  let endMin = toMinutes(availability.end);
  if (endMin <= startMin) endMin += 24 * 60;
  const start = new Date(midnight + startMin * 60_000).toISOString();
  const end = new Date(midnight + endMin * 60_000).toISOString();
  return {
    phStart: formatTime(start, availability.timeZone),
    phEnd: formatTime(end, availability.timeZone),
    start: formatTime(start, timeZone),
    end: formatTime(end, timeZone),
  };
}

// Every IANA time zone the browser knows, labeled "America/New York (GMT-5)", sorted by offset.
let zoneOptions;
export function timeZoneOptions(current) {
  if (!zoneOptions) {
    let zones;
    try {
      zones = Intl.supportedValuesOf('timeZone');
    } catch {
      zones = [];
    }
    const now = new Date();
    zoneOptions = zones
      .map((tz) => {
        const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' }).formatToParts(now);
        const gmt = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
        const match = /GMT([+-])(\d{2}):(\d{2})/.exec(gmt);
        const minutes = match ? (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3])) : 0;
        return { value: tz, label: `${tz.replaceAll('_', ' ')} (${gmt === 'GMT' ? 'GMT+0' : gmt.replace(':00', '')})`, minutes };
      })
      .sort((a, b) => a.minutes - b.minutes || a.value.localeCompare(b.value));
  }
  // The detected zone may be an alias the list doesn't include (e.g. "Asia/Calcutta").
  return zoneOptions.some((o) => o.value === current) ? zoneOptions : [{ value: current, label: current.replaceAll('_', ' '), minutes: 0 }, ...zoneOptions];
}
