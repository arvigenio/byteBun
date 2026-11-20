// What can be booked: pure functions over a business's rules and its existing bookings. The
// public page, the reschedule picker and the final check inside the booking transaction all use
// these, so a time that is shown is a time that is accepted.
//
// Time slots mode:
//  - a slot starts every `intervalMinutes` from the day's opening time
//  - the appointment (service duration) must finish by closing time and not overlap a break
//  - a slot holds `bookersPerSlot` people; each booking occupies its duration + buffer, and a
//    candidate is full when that many bookings overlap its own duration + buffer
// Date-only mode: customers pick a day; first come, first served; spots = max per day.
// Both: max bookings per day (or no limit), blocked dates, minimum notice, booking window.
import { addDays, fromLocal, toLocal, todayIn, weekdayOf } from './time';

export interface DayHours {
  startMinute: number;
  endMinute: number;
}

export interface ScheduleRules {
  timeZone: string;
  mode: 'slots' | 'date';
  intervalMinutes: number;
  bookersPerSlot: number;
  maxPerDay: number | null;
  minNoticeMinutes: number;
  windowDays: number;
  /** By weekday (0 = Sunday). Missing = closed. */
  hours: Map<number, DayHours>;
  breaks: { weekday: number; startMinute: number; endMinute: number }[];
  /** Inclusive local date ranges. */
  blocked: { startDate: string; endDate: string }[];
}

export interface ServiceTiming {
  durationMinutes: number;
  bufferMinutes: number;
}

/** A confirmed booking, as far as capacity is concerned. */
export interface Occupied {
  id?: number;
  localDate: string;
  startsAt: Date;
  blockedUntil: Date;
}

export interface Slot {
  startsAt: Date;
  /** Places left in this slot. */
  remaining: number;
}

export interface DayAvailability {
  date: string;
  /** closed: not a working day / blocked / outside the window; full: no places left. */
  status: 'open' | 'full' | 'closed';
  slots: Slot[];
  /** Spots left that day (max per day minus bookings); null = no daily limit. */
  spotsLeft: number | null;
}

const MIN = 60_000;

export const isBlocked = (rules: ScheduleRules, date: string) => rules.blocked.some((b) => b.startDate <= date && date <= b.endDate);

/** The local dates customers may book, today through the booking window. */
export function windowDates(rules: ScheduleRules, now = new Date()) {
  const today = todayIn(rules.timeZone, now);
  return { first: today, last: addDays(today, rules.windowDays) };
}

export function dayAvailability(rules: ScheduleRules, service: ServiceTiming, date: string, occupied: Occupied[], now = new Date()): DayAvailability {
  const closed: DayAvailability = { date, status: 'closed', slots: [], spotsLeft: null };
  const { first, last } = windowDates(rules, now);
  if (date < first || date > last || isBlocked(rules, date)) return closed;
  const hours = rules.hours.get(weekdayOf(date));
  if (!hours || hours.endMinute <= hours.startMinute) return closed;

  const sameDay = occupied.filter((o) => o.localDate === date);
  const spotsLeft = rules.maxPerDay === null ? null : Math.max(0, rules.maxPerDay - sameDay.length);
  const earliest = now.getTime() + rules.minNoticeMinutes * MIN;

  if (rules.mode === 'date') {
    // Bookable while the day's closing time is still more than the minimum notice away.
    const closes = fromLocal(date, hours.endMinute, rules.timeZone).getTime();
    if (closes <= earliest) return closed;
    return { date, status: spotsLeft === 0 ? 'full' : 'open', slots: [], spotsLeft };
  }

  const breaks = rules.breaks.filter((b) => b.weekday === weekdayOf(date));
  const slots: Slot[] = [];
  let anyCandidate = false;
  const step = Math.max(5, rules.intervalMinutes);
  for (let m = hours.startMinute; m + service.durationMinutes <= hours.endMinute; m += step) {
    const end = m + service.durationMinutes;
    if (breaks.some((b) => m < b.endMinute && end > b.startMinute)) continue;
    const startsAt = fromLocal(date, m, rules.timeZone);
    if (startsAt.getTime() < earliest) continue;
    anyCandidate = true;
    const holdUntil = startsAt.getTime() + (service.durationMinutes + service.bufferMinutes) * MIN;
    const overlapping = occupied.filter((o) => o.startsAt.getTime() < holdUntil && o.blockedUntil.getTime() > startsAt.getTime()).length;
    const remaining = rules.bookersPerSlot - overlapping;
    if (remaining > 0) slots.push({ startsAt, remaining });
  }
  if (!anyCandidate) return closed;
  if (spotsLeft === 0) return { date, status: 'full', slots: [], spotsLeft };
  return { date, status: slots.length ? 'open' : 'full', slots, spotsLeft };
}

/** Every day from `from` to `to` (inclusive, at most 62 days). */
export function rangeAvailability(rules: ScheduleRules, service: ServiceTiming, from: string, to: string, occupied: Occupied[], now = new Date()) {
  const days: DayAvailability[] = [];
  for (let d = from, i = 0; d <= to && i < 62; d = addDays(d, 1), i++) days.push(dayAvailability(rules, service, d, occupied, now));
  return days;
}

/** Is `startsAt` (slots) or `date` (date-only) bookable right now? */
export function checkBookable(
  rules: ScheduleRules,
  service: ServiceTiming,
  want: { startsAt?: Date; date?: string },
  occupied: Occupied[],
  now = new Date(),
): { ok: true; localDate: string; startsAt: Date; endsAt: Date; blockedUntil: Date } | { ok: false; reason: 'unavailable' | 'full' } {
  if (rules.mode === 'date') {
    if (!want.date) return { ok: false, reason: 'unavailable' };
    const day = dayAvailability(rules, service, want.date, occupied, now);
    if (day.status !== 'open') return { ok: false, reason: day.status === 'full' ? 'full' : 'unavailable' };
    const hours = rules.hours.get(weekdayOf(want.date))!;
    const startsAt = fromLocal(want.date, hours.startMinute, rules.timeZone);
    const endsAt = fromLocal(want.date, hours.endMinute, rules.timeZone);
    // A date-only booking doesn't hold a time; it only counts toward the day.
    return { ok: true, localDate: want.date, startsAt, endsAt, blockedUntil: startsAt };
  }
  if (!want.startsAt) return { ok: false, reason: 'unavailable' };
  const localDate = toLocal(want.startsAt, rules.timeZone).date;
  const day = dayAvailability(rules, service, localDate, occupied, now);
  const slot = day.slots.find((s) => s.startsAt.getTime() === want.startsAt!.getTime());
  if (!slot) {
    // Distinguish "someone just took it" from "never was a time".
    const free = dayAvailability(rules, service, localDate, [], now);
    const existed = free.slots.some((s) => s.startsAt.getTime() === want.startsAt!.getTime());
    return { ok: false, reason: existed ? 'full' : 'unavailable' };
  }
  const endsAt = new Date(slot.startsAt.getTime() + service.durationMinutes * MIN);
  const blockedUntil = new Date(endsAt.getTime() + service.bufferMinutes * MIN);
  return { ok: true, localDate, startsAt: slot.startsAt, endsAt, blockedUntil };
}

/** Does a booking still fit inside the (new) opening hours and breaks? */
export function fitsHours(rules: ScheduleRules, b: { localDate: string; startsAt: Date; endsAt: Date; dateOnly: boolean }) {
  if (isBlocked(rules, b.localDate)) return false;
  const hours = rules.hours.get(weekdayOf(b.localDate));
  if (!hours) return false;
  if (b.dateOnly) return true;
  const start = toLocal(b.startsAt, rules.timeZone).minute;
  const end = start + Math.round((b.endsAt.getTime() - b.startsAt.getTime()) / MIN);
  if (start < hours.startMinute || end > hours.endMinute) return false;
  return !rules.breaks.some((br) => br.weekday === weekdayOf(b.localDate) && start < br.endMinute && end > br.startMinute);
}
