import { yupResolver } from '@hookform/resolvers/yup';
import { useState } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { useCreateServiceMutation, useDeleteServiceMutation, useMeQuery, useServicesQuery, useUpdateServiceMutation } from '../api.js';
import { RichText } from '../components/RichText.jsx';
import { duration, LOCATION_LABEL } from '../lib/format.js';
import { serviceSchema } from '../lib/schemas.js';
import { Badge, Button, Dialog, Empty, Field, Input, Loading, Notice, PageHeader, Select, Textarea } from '../ui.jsx';
import { can } from './BookingsApp.jsx';

const EMPTY = { name: '', description: '', durationMinutes: 30, bufferMinutes: 0, locationType: 'in_person', address: '', meetingUrl: '', instructions: '' };

export function ServicesPage() {
  const { data: me } = useMeQuery();
  const q = useServicesQuery();
  const [editing, setEditing] = useState(null);
  const [update] = useUpdateServiceMutation();
  const [remove] = useDeleteServiceMutation();
  const edit = can(me, 'bookings.settings');
  const services = q.data?.services ?? [];
  const limit = q.data?.limit;
  const activeCount = services.filter((s) => s.active).length;

  return (
    <>
      <PageHeader title="Services" description="What customers can book: length, buffer time and where it happens." actions={edit && <Button onClick={() => setEditing(EMPTY)}>Add service</Button>} />
      {limit !== null && limit !== undefined && (
        <Notice tone={activeCount >= limit ? 'warn' : 'info'} className="mb-5">
          The free plan includes {limit} active services ({activeCount} used). Upgrade for unlimited services.
        </Notice>
      )}
      {q.isLoading ? (
        <Loading />
      ) : !services.length ? (
        <Empty title="No services yet" action={edit && <Button onClick={() => setEditing(EMPTY)}>Add your first service</Button>}>
          For example “Cleaning, 45 min” or “Consultation, 30 min, online”.
        </Empty>
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-surface">
          {services.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {s.name} {!s.active && <Badge>Hidden</Badge>}
                </p>
                <p className="text-sm text-faint">
                  {duration(s.durationMinutes)}
                  {s.bufferMinutes ? ` + ${s.bufferMinutes} min buffer` : ''} · {LOCATION_LABEL[s.locationType]}
                  {s.locationType === 'in_person' && s.address ? ` · ${s.address}` : ''}
                </p>
              </div>
              {edit && (
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(s)}>
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      const r = await update({ id: s.id, active: !s.active });
                      if (r.error) toast.error(r.error.message);
                    }}
                  >
                    {s.active ? 'Hide' : 'Show'}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      if (!window.confirm(`Delete “${s.name}”?`)) return;
                      const r = await remove(s.id);
                      if (r.error) return toast.error(r.error.message);
                      toast.success(r.data.archived ? 'It has bookings, so it was hidden instead of deleted.' : 'Service deleted');
                    }}
                  >
                    Delete
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {editing && <ServiceDialog service={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function ServiceDialog({ service, onClose }) {
  const isNew = !service.id;
  const [create] = useCreateServiceMutation();
  const [update] = useUpdateServiceMutation();
  const { register, handleSubmit, control, watch, setError, formState } = useForm({
    resolver: yupResolver(serviceSchema),
    defaultValues: { ...EMPTY, ...Object.fromEntries(Object.entries(service).map(([k, v]) => [k, v ?? ''])) },
  });
  const type = watch('locationType');
  const err = (k) => formState.errors[k]?.message;
  const submit = handleSubmit(async (v) => {
    const body = { ...v, description: v.description || null, address: v.address || null, meetingUrl: v.meetingUrl || null, instructions: v.instructions || null };
    const r = isNew ? await create(body) : await update({ id: service.id, ...body });
    if (r.error) {
      for (const [k, m] of Object.entries(r.error.fields ?? {})) setError(k, { message: m });
      return toast.error(r.error.message);
    }
    toast.success(isNew ? 'Service added' : 'Service saved');
    onClose();
  });
  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={isNew ? 'Add service' : `Edit ${service.name}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} loading={formState.isSubmitting}>
            Save
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Field label="Name" error={err('name')}>
          {(a) => <Input {...a} {...register('name')} />}
        </Field>
        <Field label="Description (shown on the booking page)" error={err('description')}>
          {(a) => <Textarea {...a} rows={2} {...register('description')} />}
        </Field>
        <div className="grid gap-4 desktop:grid-cols-2">
          <Field label="Duration (minutes)" error={err('durationMinutes')}>
            {(a) => <Input {...a} type="number" min={5} step={5} {...register('durationMinutes')} />}
          </Field>
          <Field label="Buffer after (minutes)" hint="Clean-up or travel time; blocks the next slot." error={err('bufferMinutes')}>
            {(a) => <Input {...a} type="number" min={0} step={5} {...register('bufferMinutes')} />}
          </Field>
        </div>
        <Field label="Where" error={err('locationType')}>
          {(a) => (
            <Select {...a} {...register('locationType')}>
              <option value="in_person">In person</option>
              <option value="online">Online meeting</option>
              <option value="phone">Phone call</option>
            </Select>
          )}
        </Field>
        {type === 'in_person' && (
          <Field label="Address" hint="Shown with an “Open in Google Maps” link." error={err('address')}>
            {(a) => <Input {...a} autoComplete="street-address" {...register('address')} />}
          </Field>
        )}
        {type === 'online' && (
          <Field label="Meeting link (Zoom, Meet, Teams)" hint="Private: only in the confirmation and reminders, as a “Join meeting” button." error={err('meetingUrl')}>
            {(a) => <Input {...a} type="url" placeholder="https://" {...register('meetingUrl')} />}
          </Field>
        )}
        <Field label="Instructions for this service" hint="Private: only in confirmations and reminders. E.g. what to bring, how to prepare, gate code." error={err('instructions')}>
          {({ id }) => <Controller control={control} name="instructions" render={({ field }) => <RichText id={id} value={field.value} onChange={field.onChange} placeholder="Please arrive 10 minutes early…" />} />}
        </Field>
      </form>
    </Dialog>
  );
}
