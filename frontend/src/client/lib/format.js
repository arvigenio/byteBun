// Dates and times are always shown in the BUSINESS's time zone (the API sends UTC instants).
export const fmtTime = (iso, timeZone) => new Intl.DateTimeFormat(undefined, { timeZone, hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
export const fmtDate = (date) => new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(`${date}T12:00:00Z`));
export const fmtLongDate = (date) => new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(`${date}T12:00:00Z`));
export const zoneName = (timeZone, at = new Date()) =>
  new Intl.DateTimeFormat(undefined, { timeZone, timeZoneName: 'short' }).formatToParts(at).find((p) => p.type === 'timeZoneName')?.value ?? timeZone;

/** "9:00 AM" from minutes after midnight. */
export const minuteLabel = (m) => {
  const h = Math.floor(m / 60) % 24;
  return `${h % 12 || 12}:${String(m % 60).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};
/** <input type="time"> value <-> minutes. */
export const toTimeInput = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
export const fromTimeInput = (v) => {
  const [h, m] = String(v).split(':').map(Number);
  return h * 60 + (m || 0);
};

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const addDays = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
export const todayIn = (timeZone) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

export const duration = (min) => (min < 60 ? `${min} min` : min % 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min / 60} h`);

export const LOCATION_LABEL = { in_person: 'In person', online: 'Online meeting', phone: 'Phone call' };

/** Every IANA zone the browser knows (fallback: a short list). */
export function timeZones() {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    return ['UTC', 'America/Toronto', 'America/Vancouver', 'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'Australia/Sydney', 'Australia/Melbourne', 'Asia/Manila', 'Europe/London'];
  }
}
export const detectTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

export const slugify = (s) =>
  String(s)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
