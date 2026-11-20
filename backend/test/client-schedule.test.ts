// Pure scheduling rules (clients/booking/schedule.ts, time.ts): time zones incl. daylight saving,
// intervals, breaks, buffers, capacity, notice, window, blocked dates, date-only mode.
import './env';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkBookable, dayAvailability, fitsHours, type ScheduleRules } from '../src/clients/booking/schedule';
import { fromLocal, toLocal } from '../src/clients/booking/time';

const rules = (over: Partial<ScheduleRules> = {}): ScheduleRules => ({
  timeZone: 'America/Toronto',
  mode: 'slots',
  intervalMinutes: 30,
  bookersPerSlot: 1,
  maxPerDay: null,
  minNoticeMinutes: 0,
  windowDays: 60,
  hours: new Map([[2, { startMinute: 9 * 60, endMinute: 12 * 60 }]]), // Tuesdays 9-12
  breaks: [],
  blocked: [],
  ...over,
});
const svc = { durationMinutes: 45, bufferMinutes: 15 };
const NOW = new Date('2026-11-21T12:00:00Z'); // a Saturday
const TUE = '2026-11-24';
const at = (hhmm: string, date = TUE, tz = 'America/Toronto') => fromLocal(date, Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)), tz);
const times = (r: ScheduleRules, occupied = [] as Parameters<typeof dayAvailability>[3], date = TUE) =>
  dayAvailability(r, svc, date, occupied, NOW).slots.map((s) => toLocal(s.startsAt, r.timeZone).minute);

describe('time zones', () => {
  it('converts wall time to UTC across daylight saving changes', () => {
    assert.equal(fromLocal('2026-07-01', 9 * 60, 'America/Toronto').toISOString(), '2026-07-01T13:00:00.000Z'); // EDT
    assert.equal(fromLocal('2026-12-01', 9 * 60, 'America/Toronto').toISOString(), '2026-12-01T14:00:00.000Z'); // EST
    assert.equal(fromLocal('2026-04-05', 9 * 60, 'Australia/Sydney').toISOString(), '2026-04-04T23:00:00.000Z'); // AEST after DST ends
    // 2:30 AM doesn't exist on 2026-03-08 in Toronto: moved forward past the gap.
    assert.equal(toLocal(fromLocal('2026-03-08', 150, 'America/Toronto'), 'America/Toronto').minute, 210);
  });
});

describe('slots', () => {
  it('steps by the interval and the appointment must finish by closing time', () => {
    // 45-min service, closes 12:00: last start 11:00 (11:30 would end 12:15).
    assert.deepEqual(times(rules()), [540, 570, 600, 630, 660]);
  });

  it('skips breaks, and the buffer blocks the following slot', () => {
    const r = rules({ breaks: [{ weekday: 2, startMinute: 600, endMinute: 630 }] });
    assert.deepEqual(times(r), [540, 630, 660]);
    // A booking 9:00-9:45 + 15 min buffer holds until 10:00.
    const occ = [{ localDate: TUE, startsAt: at('09:00'), blockedUntil: at('10:00') }];
    assert.deepEqual(times(rules(), occ), [600, 630, 660]);
  });

  it('respects capacity, the daily maximum, notice, the window and blocked dates', () => {
    const occ = [{ localDate: TUE, startsAt: at('09:00'), blockedUntil: at('10:00') }];
    assert.deepEqual(times(rules({ bookersPerSlot: 2 }), occ).slice(0, 2), [540, 570]);
    assert.equal(dayAvailability(rules({ maxPerDay: 1 }), svc, TUE, occ, NOW).status, 'full');
    const soon = new Date(at('09:40').getTime());
    assert.deepEqual(dayAvailability(rules({ minNoticeMinutes: 30 }), svc, TUE, [], soon).slots.map((s) => toLocal(s.startsAt, 'America/Toronto').minute), [630, 660]);
    assert.equal(dayAvailability(rules({ windowDays: 2 }), svc, TUE, [], NOW).status, 'closed');
    assert.equal(dayAvailability(rules({ blocked: [{ startDate: '2026-11-23', endDate: '2026-11-25' }] }), svc, TUE, [], NOW).status, 'closed');
    assert.equal(dayAvailability(rules(), svc, '2026-11-25', [], NOW).status, 'closed'); // Wednesday: closed
  });

  it('accepts only real slot times, and tells taken from invalid', () => {
    const occ = [{ localDate: TUE, startsAt: at('09:00'), blockedUntil: at('10:00') }];
    assert.equal(checkBookable(rules(), svc, { startsAt: at('10:00') }, occ, NOW).ok, true);
    assert.deepEqual(checkBookable(rules(), svc, { startsAt: at('09:30') }, occ, NOW), { ok: false, reason: 'full' });
    assert.deepEqual(checkBookable(rules(), svc, { startsAt: at('09:10') }, occ, NOW), { ok: false, reason: 'unavailable' });
  });
});

describe('date-only mode and hour changes', () => {
  it('counts spots per day', () => {
    const r = rules({ mode: 'date', maxPerDay: 2 });
    const one = [{ localDate: TUE, startsAt: at('09:00'), blockedUntil: at('09:00') }];
    assert.equal(dayAvailability(r, svc, TUE, one, NOW).spotsLeft, 1);
    assert.equal(checkBookable(r, svc, { date: TUE }, [...one, ...one], NOW).ok, false);
  });

  it('finds existing bookings outside new hours', () => {
    const b = { localDate: TUE, startsAt: at('11:00'), endsAt: at('11:45'), dateOnly: false };
    assert.equal(fitsHours(rules(), b), true);
    assert.equal(fitsHours(rules({ hours: new Map([[2, { startMinute: 540, endMinute: 660 }]]) }), b), false);
  });
});
