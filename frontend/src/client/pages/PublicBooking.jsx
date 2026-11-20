import { yupResolver } from '@hookform/resolvers/yup';
import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { useBookMutation, usePublicAvailabilityQuery, usePublicPageQuery } from '../api.js';
import { SlotPicker } from '../components/SlotPicker.jsx';
import { inkOn } from '../lib/color.js';
import { duration, fmtLongDate, fmtTime, LOCATION_LABEL, todayIn, zoneName } from '../lib/format.js';
import { bookingSchema } from '../lib/schemas.js';
import { Button, Field, Icon, ICONS, Input, Loading, Textarea } from '../ui.jsx';

const FONT_CLASS = { system: 'font-sans', serif: 'font-serif', rounded: 'font-[family-name:var(--font-rounded)]', mono: 'font-mono' };
const RADIUS = { rounded: '10px', pill: '999px', square: '3px' };

/** The business's branding as CSS variables (their color replaces the product's). */
export function brandStyle(b) {
  const primary = b?.primaryColor ?? '#0F766E';
  const dark = b?.theme === 'dark';
  const style = {
    '--color-brand': primary,
    '--color-brand-ink': inkOn(primary),
    '--color-brand-soft': `${primary}1f`,
    '--radius-btn': RADIUS[b?.buttonStyle] ?? RADIUS.rounded,
  };
  if (b?.accentColor) style['--color-accent'] = b.accentColor;
  if (dark) Object.assign(style, { '--color-canvas': '#0E1116', '--color-surface': '#161B22', '--color-sunken': '#1F252D', '--color-line': '#2A313B', '--color-line-strong': '#3A434F', '--color-ink': '#F3F4F6', '--color-muted': '#C4C9D0', '--color-faint': '#9AA3AD' });
  if (b?.theme === 'custom' && b.backgroundColor) style['--color-canvas'] = b.backgroundColor;
  return style;
}

export function BrandFrame({ branding, name, children }) {
  useEffect(() => {
    if (name) document.title = `Book with ${name}`;
  }, [name]);
  return (
    <div style={brandStyle(branding)} className={`min-h-screen bg-canvas text-ink ${FONT_CLASS[branding?.font] ?? ''}`}>
      <div className="mx-auto max-w-2xl px-4 pt-8 pb-5 mobile:pt-5">{children}</div>
      {branding?.poweredBy && (
        <footer className="pb-4 text-center text-[11px] text-faint">
          Powered by{' '}
          <a href="https://bytebuntech.com" className="font-medium underline" target="_blank" rel="noreferrer">
            Byte Bun Bookings
          </a>
        </footer>
      )}
    </div>
  );
}

function Location({ service }) {
  if (service.locationType === 'in_person' && service.address) {
    return (
      <span className="inline-flex flex-wrap items-center gap-x-2">
        <Icon d={ICONS.pin} className="size-4" /> {service.address}
        <a className="text-brand underline" href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(service.address)}`} target="_blank" rel="noreferrer">
          Open in Google Maps
        </a>
      </span>
    );
  }
  const icon = service.locationType === 'online' ? ICONS.video : service.locationType === 'phone' ? ICONS.phone : ICONS.pin;
  return (
    <span className="inline-flex items-center gap-2">
      <Icon d={icon} className="size-4" /> {LOCATION_LABEL[service.locationType]}
      {service.locationType === 'online' && <span className="text-faint">· link in your confirmation</span>}
    </span>
  );
}

export function PublicBookingPage({ slug }) {
  const page = usePublicPageQuery(slug);
  const [serviceId, setServiceId] = useState(null);
  const [pick, setPick] = useState(null);
  const [done, setDone] = useState(null);

  if (page.isLoading) return <Loading />;
  if (page.error) {
    return (
      <BrandFrame>
        <h1 className="text-xl font-semibold">Booking page not found</h1>
        <p className="mt-2 text-muted">Check the link and try again.</p>
      </BrandFrame>
    );
  }
  const { business, branding, services, status } = page.data;
  const service = services.find((s) => s.id === serviceId) ?? (services.length === 1 ? services[0] : null);

  return (
    <BrandFrame branding={branding} name={business.name}>
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">{business.name}</h1>
        {business.instructions && <p className="mt-2 whitespace-pre-line text-muted">{business.instructions}</p>}
      </header>

      {status === 'unavailable' ? (
        <Closed title="Online booking is currently unavailable" phone={business.phone} />
      ) : status === 'month_full' ? (
        <Closed title="No more online bookings available this month" phone={business.phone} />
      ) : done ? (
        <Confirmed done={done} business={business} service={service} onAgain={() => (setDone(null), setPick(null))} />
      ) : !services.length ? (
        <Closed title="No services are open for booking yet" phone={business.phone} />
      ) : (
        <div className="flex flex-col gap-5">
          <Step n={1} title="Choose a service" done={!!service} summary={service && `${service.name} · ${duration(service.durationMinutes)}`} onEdit={services.length > 1 ? () => (setServiceId(null), setPick(null)) : null}>
            <div className="grid gap-2">
              {services.map((s) => (
                <button key={s.id} type="button" onClick={() => setServiceId(s.id)} className="cursor-pointer rounded-btn border border-line bg-surface p-4 text-left transition hover:border-brand">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-semibold">{s.name}</span>
                    <span className="shrink-0 text-sm text-muted">{duration(s.durationMinutes)}</span>
                  </div>
                  {s.description && <p className="mt-1 text-sm text-muted">{s.description}</p>}
                  <p className="mt-2 text-xs text-faint">
                    <Location service={s} />
                  </p>
                </button>
              ))}
            </div>
          </Step>
          {service && (
            <Step n={2} title={business.mode === 'date' ? 'Choose a day' : 'Choose a time'} done={!!pick} summary={pick && pickLabel(pick, business)} onEdit={() => setPick(null)}>
              <PublicSlots slug={slug} service={service} business={business} onPick={setPick} />
            </Step>
          )}
          {service && pick && (
            <Step n={3} title="Your details">
              <DetailsForm slug={slug} service={service} pick={pick} onDone={setDone} onTaken={() => setPick(null)} />
            </Step>
          )}
        </div>
      )}
    </BrandFrame>
  );
}

const pickLabel = (pick, business) => (pick.startsAt ? `${fmtLongDate(pick.date)}, ${fmtTime(pick.startsAt, business.timeZone)} ${zoneName(business.timeZone, new Date(pick.startsAt))}` : fmtLongDate(pick.date));

function Step({ n, title, done, summary, onEdit, children }) {
  return (
    <section className="rounded-card border border-line bg-surface p-5 mobile:p-4">
      <div className="flex items-center gap-3">
        <span className={`grid size-7 shrink-0 place-items-center rounded-full text-sm font-bold ${done ? 'bg-brand text-brand-ink' : 'bg-brand-soft text-brand'}`}>{done ? <Icon d={ICONS.check} className="size-4" /> : n}</span>
        <h2 className="font-semibold">{title}</h2>
        {done && onEdit && (
          <button type="button" onClick={onEdit} className="ml-auto cursor-pointer text-sm text-brand underline">
            Change
          </button>
        )}
      </div>
      {done && summary ? <p className="mt-2 pl-10 text-sm text-muted">{summary}</p> : <div className="mt-4">{children}</div>}
    </section>
  );
}

function PublicSlots({ slug, service, business, onPick }) {
  const today = todayIn(business.timeZone);
  const [from, setFrom] = useState(today);
  const q = usePublicAvailabilityQuery({ slug, serviceId: service.id, from, to: undefined });
  return <SlotPicker data={q.data} loading={q.isFetching} from={from} onFromChange={setFrom} today={today} value={null} onChange={onPick} />;
}

function DetailsForm({ slug, service, pick, onDone, onTaken }) {
  const [book] = useBookMutation();
  const [error, setErr] = useState(null);
  const { register, handleSubmit, setError, formState } = useForm({ resolver: yupResolver(bookingSchema) });
  const submit = handleSubmit(async (v) => {
    setErr(null);
    const res = await book({ slug, serviceId: service.id, ...(pick.startsAt ? { startsAt: pick.startsAt } : { date: pick.date }), ...v });
    if (res.error) {
      if (res.error.error === 'slot_taken') {
        setErr(res.error.message);
        setTimeout(onTaken, 1800);
        return;
      }
      for (const [k, m] of Object.entries(res.error.fields ?? {})) setError(k, { message: m });
      setErr(res.error.message);
      return;
    }
    onDone({ ...pick, email: v.email });
  });
  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <div className="grid gap-4 desktop:grid-cols-2">
        <Field label="Full name" error={formState.errors.name?.message}>
          {(a) => <Input {...a} autoComplete="name" {...register('name')} />}
        </Field>
        <Field label="Email" hint="Your confirmation goes here." error={formState.errors.email?.message}>
          {(a) => <Input {...a} type="email" autoComplete="email" {...register('email')} />}
        </Field>
      </div>
      <Field label="Phone (optional)" error={formState.errors.phone?.message}>
        {(a) => <Input {...a} type="tel" autoComplete="tel" {...register('phone')} />}
      </Field>
      <Field label="Anything we should know? (optional)" error={formState.errors.note?.message}>
        {(a) => <Textarea {...a} rows={2} {...register('note')} />}
      </Field>
      {/* Honeypot: hidden from people, filled by bots. */}
      <input type="text" tabIndex={-1} autoComplete="off" aria-hidden="true" className="absolute -left-[9999px] h-0 w-0 opacity-0" {...register('website')} />
      {error && <p className="rounded-btn bg-danger-soft px-4 py-3 text-sm text-danger" role="alert">{error}</p>}
      <Button type="submit" size="lg" loading={formState.isSubmitting}>
        Confirm booking
      </Button>
    </form>
  );
}

function Confirmed({ done, business, service, onAgain }) {
  return (
    <section className="rounded-card border border-line bg-surface p-8 text-center mobile:p-5">
      <span className="mx-auto grid size-14 place-items-center rounded-full bg-brand text-brand-ink">
        <Icon d={ICONS.check} className="size-7" />
      </span>
      <h2 className="mt-4 text-xl font-bold">You’re booked!</h2>
      <p className="mt-2 text-muted">
        {service?.name} · {pickLabel(done, business)}
      </p>
      <p className="mt-4 text-sm text-muted">
        We sent the details to <strong className="text-ink">{done.email}</strong>, with links to add it to your calendar, reschedule or cancel.
      </p>
      <button type="button" onClick={onAgain} className="mt-6 cursor-pointer text-sm text-brand underline">
        Book another appointment
      </button>
    </section>
  );
}

function Closed({ title, phone }) {
  return (
    <section className="rounded-card border border-line bg-surface p-8 text-center">
      <h2 className="text-lg font-semibold">{title}</h2>
      {phone && (
        <p className="mt-2 text-muted">
          Please call <a className="font-medium text-brand underline" href={`tel:${phone.replace(/[^+\d]/g, '')}`}>{phone}</a>.
        </p>
      )}
    </section>
  );
}
