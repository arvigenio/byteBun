// Time zone helpers. Instants are stored in UTC; the business's wall clock is read with its IANA
// time zone. Local dates are 'YYYY-MM-DD' strings, local times minutes after midnight.
const DAY_MS = 86_400_000;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function isDate(v: unknown): v is string {
  if (typeof v !== 'string' || !DATE_RE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

const partsFormatters = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(timeZone: string) {
  let f = partsFormatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    partsFormatters.set(timeZone, f);
  }
  return f;
}

/** The business's wall clock at instant `d`. */
export function toLocal(d: Date, timeZone: string) {
  const p = Object.fromEntries(partsFormatter(timeZone).formatToParts(d).map((x) => [x.type, x.value]));
  const date = `${p.year}-${p.month}-${p.day}`;
  const minute = Number(p.hour) * 60 + Number(p.minute);
  return { date, minute, weekday: weekdayOf(date) };
}

/** Offset (ms) of `timeZone` from UTC at instant `t`. */
function offsetAt(t: number, timeZone: string) {
  const p = Object.fromEntries(partsFormatter(timeZone).formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
  return asUtc - Math.floor(t / 1000) * 1000;
}

/**
 * The instant at local `date` + `minute` in `timeZone`. Times that don't exist (the hour skipped
 * when clocks go forward) move forward by the gap; repeated times take the first occurrence.
 */
export function fromLocal(date: string, minute: number, timeZone: string): Date {
  const [, y, m, d] = DATE_RE.exec(date)!.map(Number);
  const wall = Date.UTC(y, m - 1, d) + minute * 60_000;
  let t = wall - offsetAt(wall, timeZone);
  const o2 = offsetAt(t, timeZone);
  if (wall - o2 !== t) {
    const t2 = wall - o2;
    // Pick the candidate that maps back to the requested wall time, else the later one (gap).
    t = toLocalWall(t2, timeZone) === wall ? t2 : toLocalWall(t, timeZone) === wall ? t : Math.max(t, t2);
  }
  return new Date(t);
}
const toLocalWall = (t: number, timeZone: string) => {
  const l = toLocal(new Date(t), timeZone);
  const [, y, m, d] = DATE_RE.exec(l.date)!.map(Number);
  return Date.UTC(y, m - 1, d) + l.minute * 60_000;
};

export const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
export const weekdayOf = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();
export const dateToDb = (date: string) => new Date(`${date}T00:00:00Z`);
export const dateFromDb = (d: Date) => d.toISOString().slice(0, 10);
export const todayIn = (timeZone: string, now = new Date()) => toLocal(now, timeZone).date;

/** "9:30 AM" from minutes after midnight. */
export function minuteLabel(minute: number) {
  const h = Math.floor(minute / 60) % 24;
  const m = minute % 60;
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/** "Tuesday, November 24, 2026" and "9:30 AM" in the business's zone, plus the zone's short name. */
export function formatInZone(d: Date, timeZone: string) {
  const date = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(d);
  const time = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' }).format(d);
  const zone = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' }).formatToParts(d).find((p) => p.type === 'timeZoneName')?.value ?? timeZone;
  return { date, time, zone };
}

export const formatLocalDate = (date: string) =>
  new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(`${date}T12:00:00Z`));
