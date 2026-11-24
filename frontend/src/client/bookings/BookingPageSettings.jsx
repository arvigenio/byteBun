import { yupResolver } from '@hookform/resolvers/yup';
import { useEffect } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { useConfigQuery, useMeQuery, useSaveSettingsMutation, useSettingsQuery } from '../api.js';
import { asHtml, RichText } from '../components/RichText.jsx';
import { contrast, inkOn, isHex } from '../lib/color.js';
import { pageSchema } from '../lib/schemas.js';
import { bookingsBase } from '../lib/surface.js';
import { Button, Card, Field, Input, LinkButton, Loading, Notice, PageHeader, Select, Textarea } from '../ui.jsx';
import { can } from './BookingsApp.jsx';

// The public booking page: name, link, instructions, colors (free: primary color; paid: all
// colors, theme, font, button style, and no "Powered by" footer), and contact. Reminders and
// owner alerts are on the Schedule page.
export function BookingPageSettings() {
  const { data: me } = useMeQuery();
  const { data: cfg } = useConfigQuery();
  const q = useSettingsQuery();
  if (q.isLoading || !q.data || !cfg) return <Loading />;
  return <PageForm data={q.data} cfg={cfg} edit={can(me, 'bookings.settings')} />;
}


function PageForm({ data, cfg, edit }) {
  const s = data.settings;
  const full = data.fullBranding;
  const [save] = useSaveSettingsMutation();
  const defaults = {
    businessName: s.businessName,
    slug: s.slug,
    pageInstructions: asHtml(s.pageInstructions),
    privateInstructions: s.privateInstructions ?? '',
    primaryColor: s.primaryColor,
    accentColor: s.accentColor ?? '#F59E0B',
    backgroundColor: s.backgroundColor ?? '#FFFFFF',
    theme: s.theme,
    font: s.font,
    buttonStyle: s.buttonStyle,
    phone: s.phone ?? '',
    contactEmail: s.contactEmail ?? '',
  };
  const { register, handleSubmit, control, watch, setValue, reset, setError, formState } = useForm({ resolver: yupResolver(pageSchema), defaultValues: defaults });
  useEffect(() => reset(defaults), [data]); // eslint-disable-line react-hooks/exhaustive-deps
  const color = watch('primaryColor');
  const slug = watch('slug');
  const name = watch('businessName');
  const err = (k) => formState.errors[k]?.message;
  const ratio = isHex(color) ? contrast(color, inkOn(color)) : 0;
  const onPage = isHex(color) ? contrast(color, '#FFFFFF') : 0;

  const submit = handleSubmit(async (v) => {
    const body = {
      businessName: v.businessName,
      slug: v.slug,
      pageInstructions: v.pageInstructions || null,
      privateInstructions: v.privateInstructions || null,
      primaryColor: v.primaryColor,
      phone: v.phone || null,
      contactEmail: v.contactEmail || null,
      ...(full && { accentColor: v.accentColor, backgroundColor: v.backgroundColor, theme: v.theme, font: v.font, buttonStyle: v.buttonStyle }),
    };
    const r = await save(body);
    if (r.error) {
      for (const [k, m] of Object.entries(r.error.fields ?? {})) setError(k, { message: m });
      return toast.error(r.error.message);
    }
    toast.success('Booking page saved');
  });

  const url = `${cfg.bookingsUrl}/${slug}`;
  return (
    <>
      <PageHeader
        title="Booking page"
        description="What customers see, and what goes in their confirmation."
        actions={
          <>
            <LinkButton href={data.publicUrl} target="_blank" rel="noreferrer">
              Open page
            </LinkButton>
            {edit && (
              <Button onClick={submit} loading={formState.isSubmitting}>
                Save
              </Button>
            )}
          </>
        }
      />
      <form onSubmit={submit} noValidate>
        <fieldset disabled={!edit} className="grid items-start gap-5 desktop:grid-cols-[1fr_300px]">
          <div className="flex flex-col gap-5">
            <Card title="Page">
              <div className="flex flex-col gap-4">
                <Field label="Business name" hint="Page title, header and emails." error={err('businessName')}>
                  {(a) => <Input {...a} {...register('businessName')} />}
                </Field>
                <Field label="Booking link" hint={url} error={err('slug')}>
                  {(a) => <Input {...a} {...register('slug')} />}
                </Field>
                <Field label="Instructions on the booking page" hint="Public: shown at the top of your booking page, as formatted here." error={err('pageInstructions')}>
                  {({ id }) => <Controller control={control} name="pageInstructions" render={({ field }) => <RichText id={id} value={field.value} onChange={field.onChange} placeholder="Please arrive 10 minutes early." />} />}
                </Field>
                <Field label="Instructions in every confirmation and reminder" hint="Private: never on the public page. Parking, entrance, gate code, what to bring. Per-service instructions are on Services." error={err('privateInstructions')}>
                  {({ id }) => <Controller control={control} name="privateInstructions" render={({ field }) => <RichText id={id} value={field.value} onChange={field.onChange} placeholder="Parking is behind the building. Gate code 1234." />} />}
                </Field>
              </div>
            </Card>
            <Card title="Contact">
              <div className="grid gap-4 desktop:grid-cols-2">
                <Field label="Phone" hint="Shown when customers can’t change a booking online." error={err('phone')}>
                  {(a) => <Input {...a} type="tel" {...register('phone')} />}
                </Field>
                <Field label="Reply-to email" hint="Customers’ replies to booking emails go here." error={err('contactEmail')}>
                  {(a) => <Input {...a} type="email" {...register('contactEmail')} />}
                </Field>
              </div>
            </Card>
          </div>
          <div className="flex flex-col gap-5">
            <Card title="Colors">
              <Field label="Primary color" error={err('primaryColor')}>
                {(a) => (
                  <div className="flex gap-2">
                    <input type="color" aria-label="Pick a color" value={isHex(color) ? color : '#0F766E'} onChange={(e) => setValue('primaryColor', e.target.value.toUpperCase(), { shouldDirty: true, shouldValidate: true })} className="h-10 w-12 cursor-pointer rounded-btn border border-line-strong bg-surface p-1" />
                    <Input {...a} {...register('primaryColor')} className="font-mono uppercase" maxLength={7} />
                  </div>
                )}
              </Field>
              {isHex(color) && (
                <div className="mt-4">
                  <div className="rounded-btn px-4 py-2.5 text-center text-sm font-semibold" style={{ background: color, color: inkOn(color) }}>
                    Confirm booking
                  </div>
                  {ratio < 4.5 || onPage < 3 ? (
                    <Notice tone="warn" className="mt-3">
                      Hard to read: {onPage < 3 ? 'this color is too light for links and buttons on a white page.' : 'button text doesn’t stand out enough.'} Try a darker shade.
                    </Notice>
                  ) : (
                    <p className="mt-2 text-xs text-ok">Readable contrast ✓</p>
                  )}
                </div>
              )}
            </Card>
            <Card title="More branding" description={full ? undefined : 'Paid plans: accent and background colors, dark theme, fonts, button style, and no “Powered by Byte Bun Bookings” footer.'}>
              {full ? (
                <div className="flex flex-col gap-4">
                  <Field label="Theme">
                    {(a) => (
                      <Select {...a} {...register('theme')}>
                        <option value="light">Light</option>
                        <option value="dark">Dark</option>
                        <option value="custom">Custom background</option>
                      </Select>
                    )}
                  </Field>
                  {watch('theme') === 'custom' && <Field label="Background">{(a) => <Input {...a} type="color" className="h-10 p-1" {...register('backgroundColor')} />}</Field>}
                  <Field label="Accent">{(a) => <Input {...a} type="color" className="h-10 p-1" {...register('accentColor')} />}</Field>
                  <Field label="Font">
                    {(a) => (
                      <Select {...a} {...register('font')}>
                        <option value="system">Clean (system)</option>
                        <option value="serif">Classic (serif)</option>
                        <option value="rounded">Friendly (rounded)</option>
                        <option value="mono">Technical (mono)</option>
                      </Select>
                    )}
                  </Field>
                  <Field label="Buttons">
                    {(a) => (
                      <Select {...a} {...register('buttonStyle')}>
                        <option value="rounded">Rounded</option>
                        <option value="pill">Pill</option>
                        <option value="square">Square</option>
                      </Select>
                    )}
                  </Field>
                </div>
              ) : (
                <LinkButton href={`${bookingsBase}/plan`} variant="primary" className="w-full">
                  See plans
                </LinkButton>
              )}
            </Card>
            <p className="text-xs text-faint">Preview: open your page in a new tab after saving ({name}).</p>
          </div>
        </fieldset>
      </form>
    </>
  );
}
