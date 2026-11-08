// The booked call as a calendar event: "Add to calendar" links (Google, Outlook.com, Office 365,
// Yahoo) and an .ics file (Apple Calendar and everything else; Gmail also offers to add it).
import { availability } from '../booking/availability';

export interface CallEvent {
  /** Stable per booking, so a reschedule updates the same event in the lead's calendar. */
  uid: string;
  /** Bumped on each reschedule (iCalendar SEQUENCE). */
  sequence: number;
  title: string;
  description: string;
  location: string;
  start: Date;
  end: Date;
}

export function callEvent(opts: { bookingId: number; startsAt: Date; sequence: number; meetingUrl: string; manageUrl: string }): CallEvent {
  const end = new Date(opts.startsAt.getTime() + availability.slotMinutes * 60_000);
  const description = [
    `Your free ${availability.slotMinutes}-minute audit call with Byte Bun Tech.`,
    '',
    "We'll review your website, response time and follow-up, show you where leads slip through, and send you a clear plan within 24 hours.",
    '',
    ...(opts.meetingUrl ? [`Join the call: ${opts.meetingUrl}`, ''] : ["We'll send the video call link to your email."]),
    `Need a different time, or can't make it? ${opts.manageUrl}`,
  ].join('\n');
  return {
    uid: `booking-${opts.bookingId}@bytebuntech.com`,
    sequence: opts.sequence,
    title: 'Free audit call with Byte Bun Tech',
    description,
    location: opts.meetingUrl || 'Video call (link sent by email)',
    start: opts.startsAt,
    end,
  };
}

/** 2026-11-18T11:30:00.000Z -> 20261118T113000Z */
const icsDate = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

export function calendarLinks(ev: CallEvent) {
  const q = (params: Record<string, string>) => new URLSearchParams(params).toString();
  const isoNoMs = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const outlook = (host: string) =>
    `https://${host}/calendar/0/action/compose?${q({
      path: '/calendar/action/compose',
      rru: 'addevent',
      subject: ev.title,
      startdt: isoNoMs(ev.start),
      enddt: isoNoMs(ev.end),
      body: ev.description,
      location: ev.location,
    })}`;
  return {
    google: `https://calendar.google.com/calendar/render?${q({
      action: 'TEMPLATE',
      text: ev.title,
      dates: `${icsDate(ev.start)}/${icsDate(ev.end)}`,
      details: ev.description,
      location: ev.location,
    })}`,
    outlook: outlook('outlook.live.com'),
    office365: outlook('outlook.office.com'),
    yahoo: `https://calendar.yahoo.com/?${q({ v: '60', title: ev.title, st: icsDate(ev.start), et: icsDate(ev.end), desc: ev.description, in_loc: ev.location })}`,
  };
}

const escapeIcs = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

/** RFC 5545 line folding: at most 75 octets per line, continuation lines start with a space. */
function fold(line: string): string {
  const out: string[] = [];
  let cur = '';
  for (const ch of line) {
    if (Buffer.byteLength(cur + ch) > (out.length ? 74 : 75)) {
      out.push(cur);
      cur = '';
    }
    cur += ch;
  }
  out.push(cur);
  return out.join('\r\n ');
}

/** An .ics file. PUBLISH adds/updates the event; CANCEL removes it (same UID). */
export function icsFile(ev: CallEvent, method: 'PUBLISH' | 'CANCEL' = 'PUBLISH'): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Byte Bun Tech//Booking//EN',
    'CALSCALE:GREGORIAN',
    `METHOD:${method}`,
    'BEGIN:VEVENT',
    `UID:${ev.uid}`,
    `SEQUENCE:${ev.sequence}`,
    `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(ev.start)}`,
    `DTEND:${icsDate(ev.end)}`,
    `SUMMARY:${escapeIcs(method === 'CANCEL' ? `Cancelled: ${ev.title}` : ev.title)}`,
    `DESCRIPTION:${escapeIcs(ev.description)}`,
    `LOCATION:${escapeIcs(ev.location)}`,
    `STATUS:${method === 'CANCEL' ? 'CANCELLED' : 'CONFIRMED'}`,
    'TRANSP:OPAQUE',
    ...(method === 'PUBLISH' ? ['BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Your call with Byte Bun Tech starts in 15 minutes', 'TRIGGER:-PT15M', 'END:VALARM'] : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.map(fold).join('\r\n')}\r\n`;
}

/** The parts of a call time the emails show, in a given time zone. */
export function callTimeParts(startsAt: Date, timeZone: string | null) {
  const tz = safeZone(timeZone);
  const end = new Date(startsAt.getTime() + availability.slotMinutes * 60_000);
  const f = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-US', { timeZone: tz, ...o }).format(startsAt);
  const time = (d: Date, withZone = false) =>
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', ...(withZone && { timeZoneName: 'short' }) }).format(d);
  return {
    timeZone: tz,
    month: f({ month: 'short' }),
    day: f({ day: 'numeric' }),
    weekday: f({ weekday: 'long' }),
    /** "Wed, Nov 18" */
    shortDate: f({ weekday: 'short', month: 'short', day: 'numeric' }),
    /** "7:30 PM" */
    start: time(startsAt),
    /** "7:30 PM – 8:00 PM EST" */
    range: `${time(startsAt)} – ${time(end, true)}`,
    /** "Wednesday, November 18, 2026 at 7:30 PM EST" */
    long: `${f({ weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })} at ${time(startsAt, true)}`,
    /** "2026-11-18" in that zone, to tell today from tomorrow */
    ymd: new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(startsAt),
  };
}

function safeZone(tz: string | null): string {
  if (!tz) return availability.timeZone;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return availability.timeZone;
  }
}
