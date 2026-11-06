import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { yupResolver } from '@hookform/resolvers/yup';
import { useDispatch, useSelector } from 'react-redux';
import { detectTimeZone } from '../lib/calendar.js';
import { LEAD_STEPS, emptyLead, leadSchema } from '../lib/leadSchema.js';
import { fetchSlots, selectLeadForm, submitLead } from '../store/leadFormSlice.js';

const lastStep = LEAD_STEPS.length - 1;
const stepOf = (name) => LEAD_STEPS.findIndex((fields) => fields.includes(name));

// Everything the multi-step lead form needs, so the page only renders markup:
//  - react-hook-form + the yup schema for values and validation
//  - steps: each "Continue" validates only that step's fields
//  - the submit lifecycle from the Redux store (status, formError)
//  - server field errors mapped back onto their fields (jumping to that step); a call time
//    that was just taken is cleared and the open times reloaded
//  - the visitor's time zone (detected, changeable) as the `timeZone` field
//  - `field(name)`: props for an input (id, aria wiring, register)
export function useLeadFormController() {
  const uid = useId();
  const dispatch = useDispatch();
  const { status, formError, slots } = useSelector(selectLeadForm);
  const sending = status === 'sending';

  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState('next'); // which way the step animation slides
  const [nudge, setNudge] = useState(0); // bumped when a step is invalid, to replay a shake

  const {
    register,
    handleSubmit,
    setError,
    setFocus,
    trigger,
    watch,
    setValue,
    formState: { errors, touchedFields },
  } = useForm({
    resolver: yupResolver(leadSchema),
    defaultValues: { ...emptyLead, timeZone: detectTimeZone() },
    mode: 'onTouched', // check a field when it loses focus, then live as it changes
    shouldFocusError: true,
  });

  const values = watch();
  const firstName = values.firstName.trim();

  // A field showing an error re-checks on every change, so the message clears as soon as it's
  // fixed (otherwise 'onTouched' waits for the field to lose focus first).
  const errorsRef = useRef(errors);
  errorsRef.current = errors;
  useEffect(() => {
    const sub = watch((_, { name }) => {
      const field = name?.split('.')[0];
      if (field && errorsRef.current[field]) trigger(field);
    });
    return () => sub.unsubscribe();
  }, [watch, trigger]);

  // Move focus to the first field of each step as it appears.
  // (A step without fields, like the bonus step, leaves focus on the Continue button.)
  useEffect(() => {
    const first = LEAD_STEPS[step][0];
    if (first) setFocus(first);
  }, [step, setFocus]);

  const goTo = useCallback(
    (target) => {
      setDirection(target >= step ? 'next' : 'prev');
      setStep(target);
    },
    [step],
  );

  const next = useCallback(async () => {
    const fields = LEAD_STEPS[step];
    const ok = fields.length === 0 || (await trigger(fields, { shouldFocus: true }));
    if (ok) goTo(Math.min(step + 1, lastStep));
    else setNudge((n) => n + 1);
  }, [goTo, step, trigger]);

  const back = useCallback(() => step > 0 && goTo(step - 1), [goTo, step]);

  // `data` is already cleaned by the yup schema (trimmed, email lowercased, blanks -> null).
  const submit = useCallback(
    async (data) => {
      if (sending) return;
      try {
        await dispatch(submitLead(data)).unwrap();
      } catch (err) {
        // Show the server's per-field messages next to their fields, on the earliest step with one.
        const fields = Object.entries(err?.fields ?? {}).filter(([name]) => name in emptyLead);
        if (fields.length === 0) return;
        goTo(Math.min(...fields.map(([name]) => stepOf(name)).filter((i) => i >= 0)));
        if (fields.some(([name]) => name === 'meetingAt')) {
          setValue('meetingAt', '');
          dispatch(fetchSlots());
        }
        fields.forEach(([name, msg]) => setError(name, { type: 'server', message: msg }));
      }
    },
    [dispatch, goTo, sending, setError, setValue],
  );

  // Enter on any step but the last means "Continue", not "submit".
  const onSubmit = (e) => {
    if (step < lastStep) {
      e.preventDefault();
      next();
      return undefined;
    }
    return handleSubmit(submit, () => setNudge((n) => n + 1))(e);
  };

  const id = (name) => `${uid}-${name}`;
  const field = (name) => ({
    id: id(name),
    'aria-invalid': errors[name] ? true : undefined,
    'aria-describedby': errors[name] ? `${id(name)}-error` : undefined,
    ...register(name),
  });

  return {
    id,
    field,
    register,
    setValue,
    errorFor: (name) => errors[name]?.message,
    // A field the visitor has filled in and left, with no error: shows a check mark.
    isValid: (name) => Boolean(touchedFields[name] && !errors[name] && String(values[name] ?? '').trim()),
    values,
    firstName,
    step,
    stepCount: LEAD_STEPS.length,
    isLastStep: step === lastStep,
    direction,
    nudge,
    next,
    back,
    onSubmit,
    slots,
    status,
    sending,
    formError,
  };
}
