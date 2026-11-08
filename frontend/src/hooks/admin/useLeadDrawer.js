import { useEffect, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { leadEditSchema, OTHER_GOAL } from '../../lib/adminSchemas.js';
import { fetchLeadOptions, leadClosed, updateLead } from '../../store/adminDataSlices.js';
import { useAdminForm } from './useAdminForm.js';

/** While the drawer is open: load the edit choices once, close on Escape. */
export function useLeadDrawer(open) {
  const dispatch = useDispatch();
  useEffect(() => {
    if (!open) return undefined;
    dispatch(fetchLeadOptions());
    const onKey = (e) => e.key === 'Escape' && dispatch(leadClosed());
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, dispatch]);
}

const toForm = (lead) => ({
  firstName: lead.firstName,
  lastName: lead.lastName,
  email: lead.email,
  phone: lead.phone ?? '',
  businessName: lead.businessName ?? '',
  businessType: lead.businessType,
  goals: lead.goalKeys,
  goalsOther: lead.goalsOther ?? '',
  features: lead.featureKeys,
  message: lead.message ?? '',
  status: lead.status,
});

/** The edit form: RHF + yup, sends the whole form, shows the server's per-field messages. */
export function useLeadEditForm(lead) {
  const dispatch = useDispatch();
  const options = useSelector((s) => s.adminLeads.options);
  const form = useAdminForm(leadEditSchema, toForm(lead));
  const [state, setState] = useState({ saving: false, error: '' });
  const goals = form.watch('goals') ?? [];

  const onSubmit = form.handleSubmit(async (values) => {
    setState({ saving: true, error: '' });
    const result = await dispatch(updateLead({ id: lead.id, fields: values }));
    if (updateLead.rejected.match(result)) {
      form.applyServerErrors(result.payload);
      setState({ saving: false, error: result.payload?.message || 'Could not save. Please try again.' });
    } else {
      setState({ saving: false, error: '' });
    }
  });

  return { form, options, onSubmit, saving: state.saving, error: state.error, wantsOther: goals.includes(options?.otherGoal ?? OTHER_GOAL) };
}
