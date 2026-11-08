import { yupResolver } from '@hookform/resolvers/yup';
import { useForm } from 'react-hook-form';

/**
 * react-hook-form + yup, plus: `submit(thunkAction)` dispatches it and puts the server's per-field
 * messages (if any) on the matching fields.
 */
export function useAdminForm(schema, defaultValues) {
  const form = useForm({ resolver: yupResolver(schema), defaultValues, mode: 'onSubmit' });
  const applyServerErrors = (payload) => {
    for (const [name, message] of Object.entries(payload?.fields ?? {})) form.setError(name, { type: 'server', message });
  };
  return { ...form, applyServerErrors };
}
