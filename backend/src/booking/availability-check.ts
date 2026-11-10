import { availability } from './availability';

// Answers "is this time free?" and "what's open that week / month?" for the website chatbot
// (chat/chat.service.ts, tool check_availability). Pure functions: the caller passes the call times
// in the booking window and the open ones, and gets back plain text for the model.
// Everything is in the visitor's time zone, as dates (YYYY-MM-DD) and 24-hour times (HH:MM).

const DAY_MS = 24 * 60 * 60_000;
/** The longest range one check covers (a month, with room to spare). Longer asks are cut here. */
export const MAX_RANGE_DAYS = 35;

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz.trim() || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string, kind: 'parts' | 'day' | 'time'): Intl.DateTimeFormat {
  const key = `${kind}|${timeZone}`;
  let f = formatters.get(key);
  if (!f) {
    const opts: Intl.DateTimeFormatOptions =
      kind === 'parts'
        ? { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }
        : kind === 'day'
          ? { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }
          : { hour: 'numeric', minute: '2-digit' };
    f = new Intl.DateTimeFormat('en-US', { ...opts, timeZone });
    formatters.set(key, f);
  }
  return f;
}

/** The wall-clock date and time of `d` in `timeZone`. */
export function localParts(d: Date, timeZone: string) {
  const p = Object.fromEntries(formatter(timeZone, 'parts').formatToParts(d).map((x) => [x.type, x.value]));
  const date = `${p.year}-${p.month}-${p.day}`;
  const time = `${p.hour}:${p.minute}`;
  return { date, time, wall: wallMs(date, time) };
}

/** A local date and time as a number, for comparing wall-clock times (not a real instant). */
const wallMs = (date: string, time: string) => {
  const [, y, m, d] = DATE_RE.exec(date)!.map(Number);
  const [, hh, mm] = TIME_RE.exec(time)!.map(Number);
  return Date.UTC(y, m - 1, d, hh, mm);
};

const dayLabel = (date: string) => formatter('UTC', 'day').format(new Date(`${date}T12:00:00Z`));
const timeLabel = (d: Date, timeZone: string) => formatter(timeZone, 'time').format(d);
const time24Label = (time: string) => timeLabel(new Date(`2000-01-01T${time}:00Z`), 'UTC');
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);

const validDate = (v: unknown): v is string => {
  if (typeof v !== 'string' || !DATE_RE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};

/** The open call that starts at `date` `time` in `timeZone`, if there is one. */
export function findOpenSlot(open: Date[], date: string, time: string, timeZone: string): Date | undefined {
  return open.find((s) => {
    const l = localParts(s, timeZone);
    return l.date === date && l.time === time;
  });
}

/** "5:30 AM to 3:30 PM, every hour" for a run of hourly calls, otherwise each time. */
function describeDay(slots: Date[], timeZone: string): string {
  const step = availability.intervalMinutes * 60_000;
  const runs: Date[][] = [];
  for (const s of slots) {
    const run = runs.at(-1);
    if (run && s.getTime() - run.at(-1)!.getTime() === step) run.push(s);
    else runs.push([s]);
  }
  const every = availability.intervalMinutes === 60 ? 'every hour' : `every ${availability.intervalMinutes} minutes`;
  return runs
    .map((r) => (r.length >= 3 ? `${timeLabel(r[0], timeZone)} to ${timeLabel(r.at(-1)!, timeZone)} (${every})` : r.map((s) => timeLabel(s, timeZone)).join(', ')))
    .join(', ');
}

export interface AvailabilityQuery {
  /** First day to check, YYYY-MM-DD in `timeZone`. */
  from: unknown;
  /** Last day to check (inclusive). Defaults to `from`. */
  to?: unknown;
  /** A specific start time to check on each day, HH:MM (24-hour) in `timeZone`. */
  time?: unknown;
  timeZone: string;
}

/**
 * Plain-text answer for the model. `all` is every call time in the booking window (booked or not),
 * `open` the ones still free; both sorted.
 */
export function describeAvailability(q: AvailabilityQuery, all: Date[], open: Date[]): string {
  const { timeZone } = q;
  if (!validDate(q.from)) return 'Error: "from" must be a date like 2026-11-17.';
  if (q.to !== undefined && q.to !== null && q.to !== '' && !validDate(q.to)) return 'Error: "to" must be a date like 2026-11-23.';
  if (q.time !== undefined && q.time !== null && q.time !== '' && (typeof q.time !== 'string' || !TIME_RE.test(q.time))) {
    return 'Error: "time" must be a 24-hour time like 20:00.';
  }
  let from = q.from;
  let to = validDate(q.to) ? q.to : from;
  if (to < from) [from, to] = [to, from];
  const time = typeof q.time === 'string' && q.time ? q.time : null;

  const lines = [`All dates and times are in ${timeZone}.`];
  if (!all.length) return [...lines, 'There are no call times in the booking window right now.'].join('\n');

  const windowFrom = localParts(all[0], timeZone).date;
  const windowTo = localParts(all.at(-1)!, timeZone).date;
  lines.push(
    `Booking window: ${dayLabel(windowFrom)} to ${dayLabel(windowTo)} (calls can be booked from ${availability.minNoticeHours} hours ahead up to ${availability.daysAhead} days ahead).`,
  );

  const capped = addDays(from, MAX_RANGE_DAYS - 1) < to;
  if (capped) to = addDays(from, MAX_RANGE_DAYS - 1);
  lines.push(`Checked: ${dayLabel(from)}${to !== from ? ` to ${dayLabel(to)}` : ''}${capped ? ` (only the first ${MAX_RANGE_DAYS} days of the range)` : ''}.`);

  if (to < windowFrom || from > windowTo) {
    lines.push(
      from > windowTo
        ? `That is past the booking window: calls can't be booked that far ahead yet. The latest bookable day is ${dayLabel(windowTo)}.`
        : `That is before the earliest bookable time. The earliest bookable day is ${dayLabel(windowFrom)}.`,
    );
    return lines.join('\n');
  }
  if (from < windowFrom || to > windowTo) lines.push('Part of that range is outside the booking window; only the days inside it can be booked.');

  // Open calls by local day, inside the range.
  const byDay = new Map<string, Date[]>();
  for (const s of open) {
    const { date } = localParts(s, timeZone);
    if (date < from || date > to) continue;
    const list = byDay.get(date);
    if (list) list.push(s);
    else byDay.set(date, [s]);
  }

  if (time) {
    const target = wallMs(from, time);
    const yes: string[] = [];
    const no: string[] = [];
    for (let d = from; d <= to; d = addDays(d, 1)) {
      if (d < windowFrom || d > windowTo) continue;
      (findOpenSlot(byDay.get(d) ?? [], d, time, timeZone) ? yes : no).push(dayLabel(d));
    }
    const t = time24Label(time);
    if (yes.length) lines.push(`${t} is OPEN on: ${yes.join('; ')}.`);
    if (no.length) lines.push(`${t} is NOT open on: ${no.join('; ')}.`);
    if (!yes.length) {
      const nearest = [...open]
        .sort((a, b) => Math.abs(localParts(a, timeZone).wall - target) - Math.abs(localParts(b, timeZone).wall - target))
        .slice(0, 3)
        .sort((a, b) => a.getTime() - b.getTime());
      if (nearest.length) lines.push(`Nearest open times: ${nearest.map((s) => `${dayLabel(localParts(s, timeZone).date)} ${timeLabel(s, timeZone)}`).join('; ')}.`);
    }
  }

  const days = [...byDay.keys()].sort();
  const count = days.reduce((n, d) => n + byDay.get(d)!.length, 0);
  if (!count) {
    lines.push('No open times in that range.');
    const next = open.find((s) => localParts(s, timeZone).date > to);
    if (next) lines.push(`The next open time after it: ${dayLabel(localParts(next, timeZone).date)} ${timeLabel(next, timeZone)}.`);
    return lines.join('\n');
  }

  lines.push(`Open times in that range: ${count} on ${days.length} day${days.length === 1 ? '' : 's'}.`);
  for (const d of days) lines.push(`${dayLabel(d)}: ${describeDay(byDay.get(d)!, timeZone)}`);
  const full: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) if (d >= windowFrom && d <= windowTo && !byDay.has(d)) full.push(dayLabel(d));
  if (full.length) lines.push(`No open times on: ${full.join('; ')}.`);
  return lines.join('\n');
}

/** "Tuesday, November 10, 2026, 3:12 PM", the visitor's "now", so the model can read "next week". */
export function describeNow(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'full', timeStyle: 'short', timeZone }).format(now);
}
