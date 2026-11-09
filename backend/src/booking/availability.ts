// When the team takes free consultations. This file is the single source of truth: the lead page
// asks GET /api/booking/slots for call times, and POST /api/leads only accepts an open one.
// Times are Philippine time; visitors see them converted to their own time zone.
export const availability = Object.freeze({
  timeZone: 'Asia/Manila',
  utcOffsetMinutes: 8 * 60, // the Philippines has no daylight saving time, so this never changes
  start: { hour: 18, minute: 30 }, // 6:30 PM
  end: { hour: 5, minute: 0 }, // 5:00 AM the next morning
  slotMinutes: 30, // length of the call ("free 30-minute call")
  intervalMinutes: 60, // a bookable start time every hour: 6:30 PM, 7:30 PM, ... 4:30 AM
  // Which evenings are open, by the PH weekday the evening starts on (0 = Sunday ... 6 = Saturday).
  nights: [0, 1, 2, 3, 4, 5, 6] as readonly number[],
  minNoticeHours: 12, // earliest bookable slot, counted from now
  daysAhead: 21, // how far ahead people can book
});

const MINUTE = 60_000;
const pad = (n: number) => String(n).padStart(2, '0');

/** Every bookable call start (UTC) from now until `daysAhead`, ignoring existing bookings. */
export function generateSlots(now = new Date()): Date[] {
  const a = availability;
  const offset = a.utcOffsetMinutes * MINUTE;
  const earliest = now.getTime() + a.minNoticeHours * 60 * MINUTE;
  const latest = now.getTime() + a.daysAhead * 24 * 60 * MINUTE;
  const startMinute = a.start.hour * 60 + a.start.minute;
  let endMinute = a.end.hour * 60 + a.end.minute;
  if (endMinute <= startMinute) endMinute += 24 * 60; // the window runs past midnight

  // "Now" on the PH wall clock, read with getUTC* methods.
  const ph = new Date(now.getTime() + offset);
  const slots: Date[] = [];
  // Start one day back: tonight's window may have opened yesterday (PH date).
  for (let d = -1; d <= a.daysAhead; d++) {
    const phMidnight = Date.UTC(ph.getUTCFullYear(), ph.getUTCMonth(), ph.getUTCDate() + d);
    if (!a.nights.includes(new Date(phMidnight).getUTCDay())) continue;
    for (let m = startMinute; m + a.slotMinutes <= endMinute; m += a.intervalMinutes) {
      const t = phMidnight + m * MINUTE - offset;
      if (t >= earliest && t <= latest) slots.push(new Date(t));
    }
  }
  return slots;
}

export function isBookableSlot(date: Date, now = new Date()): boolean {
  const t = date.getTime();
  return generateSlots(now).some((s) => s.getTime() === t);
}

/** For the lead page: shown as "6:30 PM to 5:00 AM Philippine time" and converted locally. */
export const publicAvailability = () => ({
  timeZone: availability.timeZone,
  utcOffsetMinutes: availability.utcOffsetMinutes,
  start: `${pad(availability.start.hour)}:${pad(availability.start.minute)}`,
  end: `${pad(availability.end.hour)}:${pad(availability.end.minute)}`,
  slotMinutes: availability.slotMinutes,
});
