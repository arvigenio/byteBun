import { useCallback, useEffect, useId, useRef } from 'react';
import { useForm } from 'react-hook-form';
import { yupResolver } from '@hookform/resolvers/yup';
import { useDispatch, useSelector } from 'react-redux';
import { useLenis } from 'lenis/react';
import { site } from '../content/site.js';
import { detectTimeZone } from '../lib/calendar.js';
import { readManageToken, rescheduleSchema } from '../lib/manageBookingSchema.js';
import { fetchSlots, selectLeadForm } from '../store/leadFormSlice.js';
import { cancelCall, loadManagedBooking, manageBookingStarted, manageModeChanged, rescheduleCall, selectManageBooking } from '../store/manageBookingSlice.js';

// Changes that failed because the booking moved on meanwhile (the call started, or it was
// cancelled from another tab or by us): reload it, so the page shows what is true now.
const STALE = ['call_started', 'no_booking', 'not_found'];

// Everything the /manage-booking page needs, so the page only renders markup:
//  - the token from the URL fragment (#t=...), loaded on mount and when the fragment changes
//  - the page title, and a robots noindex tag (the page is private to each lead)
//  - react-hook-form + yup for the new time, shaped like the lead form's controller so the
//    same BookingCalendar renders it (`c`)
//  - reschedule / cancel, with server errors mapped back (a time just taken is cleared and the
//    open times reloaded)
//  - focus and scroll move to the top of the card whenever its content changes
export function useManageBooking() {
  const uid = useId();
  const dispatch = useDispatch();
  const lenis = useLenis();
  const m = useSelector(selectManageBooking);
  const { slots } = useSelector(selectLeadForm);
  const sending = m.action === 'sending';

  useEffect(() => {
    const start = () => {
      const token = readManageToken();
      dispatch(manageBookingStarted(token));
      if (token) dispatch(loadManagedBooking());
    };
    start();
    window.addEventListener('hashchange', start); // another email's link opened in this tab
    return () => window.removeEventListener('hashchange', start);
  }, [dispatch]);

  useEffect(() => {
    const previous = document.title;
    document.title = site.manageBooking.pageTitle;
    const robots = Object.assign(document.createElement('meta'), { name: 'robots', content: 'noindex, nofollow' });
    document.head.append(robots);
    return () => {
      document.title = previous;
      robots.remove();
    };
  }, []);

  const {
    register,
    handleSubmit,
    setError,
    setValue,
    clearErrors,
    watch,
    formState: { errors },
  } = useForm({
    resolver: yupResolver(rescheduleSchema),
    defaultValues: { meetingAt: '', timeZone: detectTimeZone() },
    mode: 'onTouched',
  });
  const values = watch();

  // New content in the card: move keyboard / screen-reader focus to its heading, and bring
  // the card's top into view if it scrolled off (phones: the calendar is long).
  const headingRef = useRef(null);
  const cardRef = useRef(null);
  const view = `${m.status}:${m.mode}:${m.done}`;
  const firstView = useRef(true);
  useEffect(() => {
    if (m.status === 'idle' || m.status === 'loading') return;
    headingRef.current?.focus({ preventScroll: true });
    if (firstView.current) {
      firstView.current = false;
      return;
    }
    const top = cardRef.current?.getBoundingClientRect().top ?? 0;
    if (top >= 0) return;
    const target = Math.max(0, window.scrollY + top - 16);
    if (lenis) lenis.scrollTo(target, { force: true });
    else window.scrollTo(0, target);
  }, [view, m.status, lenis]);

  const setMode = useCallback(
    (mode) => {
      setValue('meetingAt', '');
      clearErrors();
      dispatch(manageModeChanged(mode));
    },
    [clearErrors, dispatch, setValue],
  );

  const recover = useCallback(
    (err) => {
      if (err?.fields?.meetingAt) {
        setValue('meetingAt', '');
        dispatch(fetchSlots());
        setError('meetingAt', { type: 'server', message: err.fields.meetingAt });
      }
      if (STALE.includes(err?.error)) dispatch(loadManagedBooking());
    },
    [dispatch, setError, setValue],
  );

  // `data` is already cleaned by the yup schema.
  const reschedule = useCallback(
    async (data) => {
      try {
        await dispatch(rescheduleCall({ meetingAt: data.meetingAt, ...(data.timeZone && { timeZone: data.timeZone }) })).unwrap();
        setValue('meetingAt', '');
      } catch (err) {
        recover(err);
      }
    },
    [dispatch, recover, setValue],
  );

  const cancel = useCallback(async () => {
    try {
      await dispatch(cancelCall()).unwrap();
    } catch (err) {
      recover(err);
    }
  }, [dispatch, recover]);

  const id = (name) => `${uid}-${name}`;
  // The shape BookingCalendar expects (see useLeadFormController).
  const c = {
    id,
    field: (name) => ({
      id: id(name),
      'aria-invalid': errors[name] ? true : undefined,
      'aria-describedby': errors[name] ? `${id(name)}-error` : undefined,
      ...register(name),
    }),
    register,
    setValue,
    errorFor: (name) => errors[name]?.message,
    values,
    slots,
  };

  return {
    ...m,
    c,
    timeZone: values.timeZone,
    sending,
    headingRef,
    cardRef,
    setMode,
    onSubmit: handleSubmit(reschedule),
    cancel,
    retry: () => dispatch(loadManagedBooking()),
  };
}
