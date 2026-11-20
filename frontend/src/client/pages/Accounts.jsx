import { yupResolver } from '@hookform/resolvers/yup';
import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { authHttp, toError, useAcceptInvitationMutation, useConfigQuery, useInvitationQuery, useMeQuery, useOnboardingMutation } from '../api.js';
import { Centered } from '../AppGate.jsx';
import { detectTimeZone, slugify, timeZones } from '../lib/format.js';
import { codeSchema, emailSchema, onboardingSchema } from '../lib/schemas.js';
import { go, landingUrl, safeNext, signInUrl, welcomeUrl } from '../lib/surface.js';
import { Button, Field, Input, Loading, Select } from '../ui.jsx';

function AuthCard({ title, subtitle, children }) {
  return (
    <main className="grid min-h-screen place-items-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <img src="/client/bookings-icon.svg" alt="" className="size-9 rounded-lg" />
          <span className="text-lg font-semibold">Byte Bun</span>
        </div>
        <div className="rounded-card border border-line bg-surface p-7 shadow-sm mobile:p-5">
          <h1 className="text-xl font-semibold">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </div>
      </div>
    </main>
  );
}

/**
 * "/" on accounts (and bookings): send the person where they belong. `guest`: what to show
 * someone who isn't signed in (the bookings product page) instead of the sign-in page.
 */
export function AccountsHome({ guest = null }) {
  const { data: cfg } = useConfigQuery();
  const me = useMeQuery();
  const isGuest = me.error?.status === 401;
  const hasGuestPage = !!guest;
  useEffect(() => {
    if (!cfg) return;
    if (isGuest) {
      if (!hasGuestPage) go(signInUrl(cfg, landingUrl(cfg, null)));
    } else if (me.data && !me.data.business) go(welcomeUrl(cfg));
    else if (me.data) go(landingUrl(cfg, me.data.business));
  }, [cfg, me.data, isGuest, hasGuestPage]);
  if (isGuest && guest) return guest;
  return <Loading />;
}

/** Email -> 6-digit code. New emails get an account on their first sign-in. */
export function SignInPage() {
  const { data: cfg } = useConfigQuery();
  const [email, setEmail] = useState(null);
  const next = new URLSearchParams(window.location.search).get('next');

  const finish = async () => {
    // Freshly signed in: decide where to go.
    const me = await fetch('/api/client/me', { credentials: 'same-origin' }).then((r) => (r.ok ? r.json() : null));
    const target = safeNext(next, cfg);
    if (me && !me.business) return go(welcomeUrl(cfg));
    go(target ?? landingUrl(cfg, me?.business));
  };

  return (
    <AuthCard title={email ? 'Check your email' : 'Sign in to Byte Bun'} subtitle={email ? `We sent a 6-digit code to ${email}.` : 'New here? Enter your email and we’ll create your free account.'}>
      {email ? <CodeStep email={email} onBack={() => setEmail(null)} onDone={finish} /> : <EmailStep onSent={setEmail} />}
    </AuthCard>
  );
}

function EmailStep({ onSent }) {
  const { register, handleSubmit, setError, formState } = useForm({ resolver: yupResolver(emailSchema) });
  const submit = handleSubmit(async ({ email }) => {
    try {
      await authHttp.post('/email-otp/send-verification-otp', { email: email.toLowerCase(), type: 'sign-in' });
      onSent(email.toLowerCase());
    } catch (err) {
      setError('email', { message: toError(err).message });
    }
  });
  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <Field label="Email" error={formState.errors.email?.message}>
        {(a) => <Input {...a} type="email" autoComplete="email" autoFocus placeholder="you@yourbusiness.com" {...register('email')} />}
      </Field>
      <Button type="submit" size="lg" loading={formState.isSubmitting}>
        Email me a code
      </Button>
      <p className="text-center text-xs text-faint">No password needed. We’ll email you a one-time code.</p>
    </form>
  );
}

function CodeStep({ email, onBack, onDone }) {
  const { register, handleSubmit, setError, formState } = useForm({ resolver: yupResolver(codeSchema) });
  const [resent, setResent] = useState(false);
  const submit = handleSubmit(async ({ otp }) => {
    try {
      await authHttp.post('/sign-in/email-otp', { email, otp: otp.trim() });
      await onDone();
    } catch (err) {
      setError('otp', { message: toError(err).message });
    }
  });
  const resend = async () => {
    try {
      await authHttp.post('/email-otp/send-verification-otp', { email, type: 'sign-in' });
      setResent(true);
    } catch (err) {
      setError('otp', { message: toError(err).message });
    }
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <Field label="Code" error={formState.errors.otp?.message}>
        {(a) => <Input {...a} inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={6} className="text-center font-mono text-2xl tracking-[0.4em]" {...register('otp')} />}
      </Field>
      <Button type="submit" size="lg" loading={formState.isSubmitting}>
        Sign in
      </Button>
      <div className="flex justify-between text-sm">
        <button type="button" onClick={onBack} className="cursor-pointer text-muted hover:text-ink">
          Use another email
        </button>
        <button type="button" onClick={resend} disabled={resent} className="cursor-pointer text-brand disabled:text-faint">
          {resent ? 'Code sent again' : 'Send a new code'}
        </button>
      </div>
    </form>
  );
}

/** New business setup (free plan): name, business, booking link, time zone (detected). */
export function WelcomePage() {
  const { data: cfg } = useConfigQuery();
  const me = useMeQuery();
  const [onboard] = useOnboardingMutation();
  const zones = useMemo(() => timeZones(), []);
  const { register, handleSubmit, setValue, watch, setError, formState } = useForm({
    resolver: yupResolver(onboardingSchema),
    defaultValues: { firstName: '', lastName: '', businessName: '', slug: '', timeZone: detectTimeZone() },
  });
  const [slugTouched, setSlugTouched] = useState(false);
  const businessName = watch('businessName');
  const slug = watch('slug');
  useEffect(() => {
    if (!slugTouched) setValue('slug', slugify(businessName));
  }, [businessName, slugTouched, setValue]);
  useEffect(() => {
    const [first, ...rest] = (me.data?.user?.name ?? '').trim().split(/\s+/);
    if (first) {
      setValue('firstName', first);
      setValue('lastName', rest.join(' '));
    }
  }, [me.data, setValue]);
  useEffect(() => {
    if (cfg && me.error?.status === 401) go(signInUrl(cfg));
  }, [cfg, me.error]);

  if (me.isLoading || !cfg) return <Loading />;
  const bookingsHost = new URL(cfg.bookingsUrl).host;

  const submit = handleSubmit(async (values) => {
    const res = await onboard(values);
    if (res.error) {
      for (const [k, v] of Object.entries(res.error.fields ?? {})) setError(k, { message: v });
      if (!Object.keys(res.error.fields ?? {}).length) setError('businessName', { message: res.error.message });
      return;
    }
    go(`${cfg.bookingsUrl}/app?welcome=1`);
  });

  return (
    <AuthCard title="Set up your business" subtitle="Your free booking page is ready in a minute. You can change everything later.">
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <div className="grid gap-4 desktop:grid-cols-2">
          <Field label="First name" error={formState.errors.firstName?.message}>
            {(a) => <Input {...a} autoComplete="given-name" {...register('firstName')} />}
          </Field>
          <Field label="Last name" error={formState.errors.lastName?.message}>
            {(a) => <Input {...a} autoComplete="family-name" {...register('lastName')} />}
          </Field>
        </div>
        <Field label="Company name" error={formState.errors.businessName?.message}>
          {(a) => <Input {...a} placeholder="Northside Studio" {...register('businessName')} />}
        </Field>
        <Field label="Booking link" error={formState.errors.slug?.message} hint={`${bookingsHost}/${slug || 'your-business'}`}>
          {(a) => <Input {...a} {...register('slug', { onChange: () => setSlugTouched(true) })} />}
        </Field>
        <Field label="Time zone" hint="Detected from this device. Customers see times in this zone." error={formState.errors.timeZone?.message}>
          {(a) => (
            <Select {...a} {...register('timeZone')}>
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z.replace(/_/g, ' ')}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Button type="submit" size="lg" loading={formState.isSubmitting}>
          Create my booking page
        </Button>
      </form>
    </AuthCard>
  );
}

export function InvitePage({ id }) {
  const { data: cfg } = useConfigQuery();
  const me = useMeQuery();
  const inv = useInvitationQuery(id, { skip: !me.data });
  const [accept, acceptState] = useAcceptInvitationMutation();
  useEffect(() => {
    if (cfg && me.error?.status === 401) go(signInUrl(cfg));
  }, [cfg, me.error]);
  if (!cfg || me.isLoading || inv.isLoading) return <Loading />;
  if (inv.error) return <Centered title="Invitation">{inv.error.message}</Centered>;
  if (!inv.data) return <Loading />;
  return (
    <AuthCard title={`Join ${inv.data.businessName}`} subtitle={`${inv.data.inviter} invited you as ${inv.data.role}.`}>
      <Button
        size="lg"
        className="w-full"
        loading={acceptState.isLoading}
        onClick={async () => {
          const r = await accept(id);
          if (!r.error) go(landingUrl(cfg, null));
        }}
      >
        Accept invitation
      </Button>
      {acceptState.error && <p className="mt-3 text-sm text-danger">{acceptState.error.message}</p>}
    </AuthCard>
  );
}
