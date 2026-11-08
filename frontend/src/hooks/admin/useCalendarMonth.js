import { useEffect, useMemo } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { fetchCalendar } from '../../store/adminDataSlices.js';

const pad = (n) => String(n).padStart(2, '0');
/** Local calendar day, e.g. "2026-11-08". */
export const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** "2026-11" -> "2026-12" (delta = +1) */
export function shiftMonth(month, delta) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

/**
 * The month grid in the browser's time zone: 6 weeks starting on the Sunday on or before the 1st,
 * with that range's bookings fetched and grouped by day.
 */
export function useCalendarMonth() {
  const dispatch = useDispatch();
  const { month, items, status, error } = useSelector((s) => s.adminBookings.calendar);

  const grid = useMemo(() => {
    const [y, m] = month.split('-').map(Number);
    const first = new Date(y, m - 1, 1);
    const start = new Date(y, m - 1, 1 - first.getDay());
    const days = Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 42);
    return { first, days, from: start.toISOString(), to: end.toISOString() };
  }, [month]);

  useEffect(() => {
    const p = dispatch(fetchCalendar({ from: grid.from, to: grid.to }));
    return () => p.abort();
  }, [dispatch, grid.from, grid.to]);

  const byDay = useMemo(() => {
    const out = {};
    for (const b of items) (out[dayKey(new Date(b.startsAt))] ??= []).push(b);
    return out;
  }, [items]);

  return { month, grid, byDay, status, error, total: items.length };
}
