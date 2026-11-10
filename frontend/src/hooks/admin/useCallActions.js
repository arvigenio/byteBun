import { useEffect, useMemo, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { toast } from 'sonner';
import { adminCancelSchema, adminRescheduleSchema } from '../../lib/adminSchemas.js';
import { cancelBookingAdmin, drawerModeChanged, fetchBookingSlots, rescheduleBookingAdmin } from '../../store/adminDataSlices.js';
import { useAdminForm } from './useAdminForm.js';

const dayLabel = (iso) => new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(iso));
const timeLabel = (iso) => new Intl.DateTimeFormat(undefined, { timeStyle: 'short' }).format(new Date(iso));
const fmt = (iso) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));

/** Shared submit flow: success toast + back to the details, or the server's message on the form. */
function useSubmit(form, run, success) {
  const dispatch = useDispatch();
  const [error, setError] = useState('');
  const onSubmit = form.handleSubmit(async (values) => {
    setError('');
    const result = await dispatch(run(values));
    if (result.meta.requestStatus === 'fulfilled') {
      toast.success(success(values), { description: 'The lead and the other admins have been emailed.' });
      dispatch(drawerModeChanged('view'));
    } else {
      form.applyServerErrors(result.payload);
      setError(result.payload?.message || 'Something went wrong. Please try again.');
    }
  });
  return { onSubmit, error, back: () => dispatch(drawerModeChanged('view')) };
}

/** Every call time in the booking window and the booked ones (loaded on mount): { items, taken, status, error, retry }. */
export function useOpenSlots() {
  const dispatch = useDispatch();
  const slots = useSelector((s) => s.adminBookings.slots);

  useEffect(() => {
    dispatch(fetchBookingSlots());
  }, [dispatch]);

  return { ...slots, retry: () => dispatch(fetchBookingSlots()) };
}

/**
 * The open call times (loaded on mount), grouped by day in your time zone: [[day, [{ iso, time, current }]]].
 * `current` (an ISO time, e.g. the call being moved) is listed too, marked as current.
 */
export function useOpenSlotDays(current = '') {
  const slots = useOpenSlots();

  const days = useMemo(() => {
    const taken = new Set(slots.taken);
    const out = new Map();
    for (const iso of slots.items) {
      if (taken.has(iso) && iso !== current) continue;
      const key = dayLabel(iso);
      if (!out.has(key)) out.set(key, []);
      out.get(key).push({ iso, time: timeLabel(iso), current: iso === current });
    }
    return [...out.entries()];
  }, [slots.items, slots.taken, current]);

  return { days, status: slots.status, error: slots.error, retry: slots.retry };
}

/** Reschedule panel: the open times grouped by day (your time zone), plus an optional note to the lead. */
export function useReschedule(lead) {
  const form = useAdminForm(adminRescheduleSchema, { startsAt: '', note: '' });
  const selected = form.watch('startsAt');
  const slots = useOpenSlotDays(lead.booking?.startsAt ? new Date(lead.booking.startsAt).toISOString() : '');

  const submit = useSubmit(
    form,
    (v) => rescheduleBookingAdmin({ bookingId: lead.booking.id, leadId: lead.id, startsAt: v.startsAt, note: v.note }),
    (v) => `Call moved to ${fmt(v.startsAt)}`,
  );
  return { form, selected, slots, ...submit };
}

export function useCancelCall(lead) {
  const form = useAdminForm(adminCancelSchema, { note: '' });
  const submit = useSubmit(
    form,
    (v) => cancelBookingAdmin({ bookingId: lead.booking.id, leadId: lead.id, note: v.note }),
    () => `Call with ${lead.firstName} ${lead.lastName} cancelled`,
  );
  return { form, ...submit };
}
