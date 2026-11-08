import { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { useBookings } from '../hooks/admin/useAdminPages.js';
import { dayKey, shiftMonth, useCalendarMonth } from '../hooks/admin/useCalendarMonth.js';
import { fetchLead, monthChanged, openLead, viewChanged } from '../store/adminDataSlices.js';
import { PageTitle } from './AdminLayout.jsx';
import { AdminButton, formatDateTime, Notice, Panel, Spinner } from './ui.jsx';

const dayTitle = (iso) => new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(iso));
const timeOnly = (iso) => new Intl.DateTimeFormat(undefined, { timeStyle: 'short' }).format(new Date(iso));
const WEEKDAYS = Array.from({ length: 7 }, (_, i) => new Intl.DateTimeFormat(undefined, { weekday: 'short' }).format(new Date(2026, 1, 1 + i))); // 1 Feb 2026 is a Sunday

// Cancel from the list: opens the lead drawer on its cancel panel (optional note, emails).
function useCancelBooking() {
  const dispatch = useDispatch();
  return (b) => dispatch(openLead(b.lead.id, 'cancel'));
}

// Booked calls: a month calendar, or a list. Times are in your browser's time zone.
// Clicking a call opens the lead drawer (details, edit).
export function BookingsPage() {
  const dispatch = useDispatch();
  const view = useSelector((s) => s.adminBookings.view);
  return (
    <>
      <PageTitle
        title="Bookings"
        actions={
          <div className="flex rounded-btn border-2 border-line bg-cream-dough p-1" role="tablist" aria-label="View">
            {[
              ['calendar', 'Calendar'],
              ['list', 'List'],
            ].map(([v, label]) => (
              <button
                key={v}
                role="tab"
                aria-selected={view === v}
                onClick={() => dispatch(viewChanged(v))}
                className={`cursor-pointer rounded-md px-4 py-1.5 text-sm font-semibold ${view === v ? 'bg-byte-purple text-cream-dough' : 'text-muted hover:text-byte-purple'}`}
              >
                {label}
              </button>
            ))}
          </div>
        }
      >
        Free calls booked on the lead page. Times are shown in your time zone.
      </PageTitle>
      {view === 'calendar' ? <CalendarView /> : <ListView />}
    </>
  );
}

function CalendarView() {
  const dispatch = useDispatch();
  const { month, grid, byDay, status, error, total } = useCalendarMonth();
  const today = dayKey(new Date());
  const monthTitle = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(grid.first);
  const thisMonth = dayKey(new Date()).slice(0, 7);

  return (
    <>
      {error && <Notice tone="danger">{error}</Notice>}
      <Panel className="p-0 mobile:p-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-bold text-midnight-plum">{monthTitle}</h2>
            {status === 'loading' ? (
              <span className="size-4 animate-spin rounded-full border-2 border-soft-violet border-t-transparent" aria-label="Loading" />
            ) : (
              <span className="rounded-full bg-lavender-mist px-2.5 py-0.5 text-xs font-bold text-byte-purple">
                {total} call{total === 1 ? '' : 's'}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <AdminButton variant="outline" className="min-h-9 px-3 py-1.5 text-sm" onClick={() => dispatch(monthChanged(shiftMonth(month, -1)))} aria-label="Previous month">
              ‹
            </AdminButton>
            <AdminButton variant="outline" className="min-h-9 px-3.5 py-1.5 text-sm" disabled={month === thisMonth} onClick={() => dispatch(monthChanged(thisMonth))}>
              Today
            </AdminButton>
            <AdminButton variant="outline" className="min-h-9 px-3 py-1.5 text-sm" onClick={() => dispatch(monthChanged(shiftMonth(month, 1)))} aria-label="Next month">
              ›
            </AdminButton>
          </div>
        </div>

        <div className="grid grid-cols-7 border-b border-line text-center text-xs font-bold tracking-wider text-soft-violet uppercase">
          {WEEKDAYS.map((d) => (
            <div key={d} className="py-2">
              {d}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {grid.days.map((d) => {
            const key = dayKey(d);
            const calls = byDay[key] ?? [];
            const outside = d.getMonth() !== grid.first.getMonth();
            const isToday = key === today;
            return (
              <div key={key} className={`min-h-28 border-r border-b border-line p-1.5 nth-[7n]:border-r-0 mobile:min-h-20 ${outside ? 'bg-lavender-mist/40' : ''}`}>
                <div className="mb-1 flex justify-end">
                  <span
                    className={`inline-flex size-7 items-center justify-center rounded-full text-[13px] font-semibold ${isToday ? 'bg-bun-orange text-midnight-plum' : outside ? 'text-muted/50' : 'text-midnight-plum'}`}
                  >
                    {d.getDate()}
                  </span>
                </div>
                <ul className="space-y-1">
                  {calls.map((b) => (
                    <li key={b.id}>
                      <button
                        type="button"
                        onClick={() => dispatch(fetchLead(b.lead.id))}
                        title={`${timeOnly(b.startsAt)} · ${b.lead.firstName} ${b.lead.lastName}${b.lead.businessName ? ` · ${b.lead.businessName}` : ''}`}
                        className={`block w-full cursor-pointer truncate rounded-md border-l-[3px] px-1.5 py-1 text-left text-xs transition-colors ${
                          new Date(b.startsAt) < new Date() ? 'border-line bg-lavender-mist/60 text-muted' : 'border-bun-orange bg-lavender-mist text-midnight-plum hover:bg-gold-tint'
                        }`}
                      >
                        <span className="font-bold text-byte-purple">{timeOnly(b.startsAt)}</span> <span className="mobile:hidden">{b.lead.firstName} {b.lead.lastName}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </Panel>
      <p className="mt-3 text-sm text-muted">Click a call to see or edit the lead.</p>
    </>
  );
}

function ListView() {
  const dispatch = useDispatch();
  const [when, setWhen] = useState('upcoming');
  const { items, status, error } = useBookings(when);
  const cancel = useCancelBooking();
  const days = Object.entries(
    items.reduce((out, b) => {
      (out[dayTitle(b.startsAt)] ??= []).push(b);
      return out;
    }, {}),
  );

  return (
    <>
      <div className="mb-4 flex gap-2">
        {['upcoming', 'past'].map((w) => (
          <AdminButton key={w} variant={when === w ? 'primary' : 'outline'} className="min-h-9 px-4 py-1.5 text-sm capitalize" onClick={() => setWhen(w)}>
            {w}
          </AdminButton>
        ))}
      </div>
      {error && <Notice tone="danger">{error}</Notice>}
      {status === 'loading' && !items.length ? (
        <Spinner />
      ) : !items.length ? (
        <Panel>
          <p className="py-6 text-center text-muted">No {when} calls.</p>
        </Panel>
      ) : (
        <div className="space-y-6">
          {days.map(([day, list]) => (
            <section key={day}>
              <h2 className="mb-2 text-sm font-bold tracking-wider text-soft-violet uppercase">{day}</h2>
              <Panel className="divide-y divide-line p-0 mobile:p-0">
                {list.map((b) => (
                  <div key={b.id} className="flex flex-wrap items-center gap-x-6 gap-y-2 px-5 py-4">
                    <div className="w-20 text-lg font-bold text-byte-purple">{timeOnly(b.startsAt)}</div>
                    <button type="button" onClick={() => dispatch(fetchLead(b.lead.id))} className="min-w-0 flex-1 cursor-pointer text-left">
                      <div className="font-semibold text-midnight-plum hover:text-byte-purple">
                        {b.lead.firstName} {b.lead.lastName}
                        {b.lead.businessName && <span className="font-normal text-muted"> · {b.lead.businessName}</span>}
                      </div>
                      <div className="text-sm text-muted">
                        {b.lead.email}
                        {b.lead.phone && ` · ${b.lead.phone}`}
                        {b.timeZone && ` · their time: ${formatDateTime(b.startsAt, b.timeZone)} (${b.timeZone})`}
                      </div>
                    </button>
                    {when === 'upcoming' && (
                      <AdminButton variant="danger" className="min-h-9 px-3.5 py-1.5 text-sm" onClick={() => cancel(b)}>
                        Cancel call
                      </AdminButton>
                    )}
                  </div>
                ))}
              </Panel>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
