import { yupResolver } from '@hookform/resolvers/yup';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { useProfileQuery, useUpdateBusinessNameMutation, useUpdateProfileMutation } from '../api.js';
import { companySchema, profileSchema } from '../lib/schemas.js';
import { Button, Card, Field, Input, Loading, PageHeader } from '../ui.jsx';

// Your own details (anyone on the team) and the company name (owners and admins). The email is
// how you sign in, so it can't be changed here.
export function AccountPage() {
  const q = useProfileQuery();
  if (q.isLoading || !q.data) return <Loading />;
  return (
    <>
      <PageHeader title="Account" description="Your details and your company name." />
      <div className="flex max-w-2xl flex-col gap-5">
        <ProfileCard profile={q.data} />
        {q.data.business && <CompanyCard business={q.data.business} />}
      </div>
    </>
  );
}

const showErrors = (r, setError) => {
  for (const [k, m] of Object.entries(r.error.fields ?? {})) setError(k, { message: m });
  toast.error(r.error.message);
};

function ProfileCard({ profile }) {
  const [save] = useUpdateProfileMutation();
  const defaults = { firstName: profile.firstName, lastName: profile.lastName, phone: profile.phone };
  const { register, handleSubmit, reset, setError, formState } = useForm({ resolver: yupResolver(profileSchema), defaultValues: defaults });
  useEffect(() => reset(defaults), [profile]); // eslint-disable-line react-hooks/exhaustive-deps
  const err = (k) => formState.errors[k]?.message;
  const submit = handleSubmit(async (v) => {
    const r = await save({ firstName: v.firstName, lastName: v.lastName || null, phone: v.phone || null });
    if (r.error) return showErrors(r, setError);
    toast.success('Your details are saved');
  });
  return (
    <Card title="Your details">
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <div className="grid gap-4 desktop:grid-cols-2">
          <Field label="First name" error={err('firstName')}>
            {(a) => <Input {...a} autoComplete="given-name" {...register('firstName')} />}
          </Field>
          <Field label="Last name" error={err('lastName')}>
            {(a) => <Input {...a} autoComplete="family-name" {...register('lastName')} />}
          </Field>
        </div>
        <Field label="Phone" error={err('phone')}>
          {(a) => <Input {...a} type="tel" autoComplete="tel" {...register('phone')} />}
        </Field>
        <Field label="Email" hint="This is how you sign in, so it can't be changed. Contact Byte Bun if you need a different address.">
          {(a) => <Input {...a} type="email" value={profile.email} readOnly disabled />}
        </Field>
        <div>
          <Button type="submit" loading={formState.isSubmitting} disabled={!formState.isDirty}>
            Save details
          </Button>
        </div>
      </form>
    </Card>
  );
}

function CompanyCard({ business }) {
  const [save] = useUpdateBusinessNameMutation();
  const { register, handleSubmit, reset, setError, formState } = useForm({ resolver: yupResolver(companySchema), defaultValues: { name: business.name } });
  useEffect(() => reset({ name: business.name }), [business.name, reset]);
  const submit = handleSubmit(async (v) => {
    const r = await save(v.name);
    if (r.error) return showErrors(r, setError);
    toast.success('Company name saved');
  });
  return (
    <Card title="Company" description="Shown on your booking page, in emails to customers, and in the app.">
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Field label="Company name" error={formState.errors.name?.message} hint={business.canEdit ? undefined : 'Only owners and admins can change the company name.'}>
          {(a) => <Input {...a} disabled={!business.canEdit} {...register('name')} />}
        </Field>
        {business.canEdit && (
          <div>
            <Button type="submit" loading={formState.isSubmitting} disabled={!formState.isDirty}>
              Save company name
            </Button>
          </div>
        )}
      </form>
    </Card>
  );
}
