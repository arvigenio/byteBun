import { useCallback, useEffect, useId } from 'react';
import { useForm } from 'react-hook-form';
import { yupResolver } from '@hookform/resolvers/yup';
import { useDispatch, useSelector } from 'react-redux';
import { emptyLead, leadSchema } from '../lib/leadSchema.js';
import { selectLeadForm, submitLead } from '../store/leadFormSlice.js';

// Everything the lead form needs, so the component only renders markup:
//  - react-hook-form + the yup schema for values and validation
//  - the submit lifecycle from the Redux store (status, formError)
//  - server field errors mapped back onto the fields
//  - `field(name)`: props for an input (id, aria wiring, register)
export function useLeadFormController() {
  const uid = useId();
  const dispatch = useDispatch();
  const { status, formError } = useSelector(selectLeadForm);
  const sending = status === 'sending';

  const {
    register,
    handleSubmit,
    setError,
    setFocus,
    formState: { errors },
  } = useForm({
    resolver: yupResolver(leadSchema),
    defaultValues: emptyLead,
    mode: 'onSubmit', // first check on submit...
    reValidateMode: 'onChange', // ...then each error clears as soon as the field is fixed
    shouldFocusError: true, // focus the first invalid field
  });

  useEffect(() => setFocus('name'), [setFocus]);

  // `values` are already cleaned by the yup schema (trimmed, email lowercased, blanks -> null).
  const submit = useCallback(
    async (values) => {
      if (sending) return;
      try {
        await dispatch(submitLead(values)).unwrap();
      } catch (err) {
        // Show the server's per-field messages next to the fields they belong to.
        const fields = Object.entries(err?.fields ?? {}).filter(([name]) => name in emptyLead);
        fields.forEach(([name, message], i) => setError(name, { type: 'server', message }, { shouldFocus: i === 0 }));
      }
    },
    [dispatch, sending, setError],
  );

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
    errorFor: (name) => errors[name]?.message,
    onSubmit: handleSubmit(submit),
    status,
    sending,
    formError,
  };
}
