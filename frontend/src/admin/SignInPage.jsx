import { useDispatch, useSelector } from 'react-redux';
import { Logo } from '../components/Logo.jsx';
import { useAdminForm } from '../hooks/admin/useAdminForm.js';
import { useCountdown } from '../hooks/admin/useCountdown.js';
import { useQrCode } from '../hooks/admin/useQrCode.js';
import { useSignIn } from '../hooks/admin/useSignIn.js';
import { authenticatorCodeSchema, backupCodeSchema, emailCodeSchema, emailSchema, savedCodesSchema } from '../lib/adminSchemas.js';
import {
  backupCodesSaved,
  confirmSetup,
  resendCode,
  sendCode,
  startOver,
  submitEmailCode,
  submitSecondFactor,
  toggleBackupCode,
} from '../store/adminAuthSlice.js';
import { AdminButton, CodeInput, Field, Notice, Spinner, TextInput } from './ui.jsx';

// The secret sign-in page (LOGIN_PATH). Passwordless, two steps; see backend/src/auth/auth.ts.
export function SignInPage() {
  const state = useSignIn();
  const steps = {
    checking: <Spinner label="Checking…" />,
    email: <EmailStep />,
    code: <CodeStep />,
    authenticator: <AuthenticatorStep />,
    setup: <SetupStep />,
    backupCodes: <BackupCodesStep />,
    done: <Spinner label="Signing you in…" />,
  };
  return (
    <main className="flex min-h-dvh items-center justify-center bg-cream-dough px-4 py-10">
      <div className="w-full max-w-[440px]">
        <div className="mb-6 flex items-center justify-between">
          <Logo className="h-7 w-auto" />
          <span className="text-xs font-bold tracking-[0.12em] text-soft-violet uppercase">Admin</span>
        </div>
        <div className="overflow-hidden rounded-card border border-line bg-cream-dough shadow-[0_8px_30px_rgb(26_10_51/0.08)]">
          <div className="h-1 bg-bun-orange" />
          <div className="p-7 mobile:p-5">{steps[state.step]}</div>
        </div>
        <p className="mt-5 text-center text-xs text-muted">Every sign-in attempt is emailed to both admins.</p>
      </div>
    </main>
  );
}

function Heading({ title, children }) {
  return (
    <header className="mb-5">
      <h1 className="text-[22px] leading-tight font-bold text-midnight-plum">{title}</h1>
      {children && <p className="mt-2 text-[15px] text-muted">{children}</p>}
    </header>
  );
}

function ServerError() {
  const error = useSelector((s) => s.adminAuth.error);
  return error ? <Notice tone="danger">{error}</Notice> : null;
}

function EmailStep() {
  const dispatch = useDispatch();
  const { pending, email } = useSelector((s) => s.adminAuth);
  const { register, handleSubmit, formState } = useAdminForm(emailSchema, { email });
  const onSubmit = handleSubmit((v) => dispatch(sendCode(v.email)));
  return (
    <form onSubmit={onSubmit} noValidate>
      <Heading title="Sign in">Enter your email and we'll send you a sign-in code.</Heading>
      <ServerError />
      <Field label="Email" id="email" error={formState.errors.email?.message}>
        <TextInput id="email" type="email" autoComplete="username" autoFocus error={formState.errors.email} {...register('email')} />
      </Field>
      <AdminButton type="submit" busy={pending} className="w-full">
        Send code
      </AdminButton>
    </form>
  );
}

function CodeStep() {
  const dispatch = useDispatch();
  const { pending, email, resendAt } = useSelector((s) => s.adminAuth);
  const wait = useCountdown(resendAt);
  const { register, handleSubmit, formState, reset } = useAdminForm(emailCodeSchema, { otp: '' });
  const onSubmit = handleSubmit((v) => dispatch(submitEmailCode(v.otp)));
  return (
    <form onSubmit={onSubmit} noValidate>
      <Heading title="Check your email">
        If <strong className="text-midnight-plum">{email}</strong> is registered, we've sent a code. It expires in 5 minutes.
      </Heading>
      <ServerError />
      <Field label="Email code" id="otp" error={formState.errors.otp?.message}>
        <CodeInput id="otp" autoFocus error={formState.errors.otp} {...register('otp')} />
      </Field>
      <AdminButton type="submit" busy={pending} className="w-full">
        Continue
      </AdminButton>
      <div className="mt-4 flex items-center justify-between text-sm">
        <AdminButton variant="link" onClick={() => dispatch(startOver())}>
          Use a different email
        </AdminButton>
        <AdminButton
          variant="link"
          disabled={wait > 0 || pending}
          onClick={() => {
            reset({ otp: '' });
            dispatch(resendCode());
          }}
        >
          {wait > 0 ? `Resend code in ${wait}s` : 'Resend code'}
        </AdminButton>
      </div>
    </form>
  );
}

function AuthenticatorStep() {
  const dispatch = useDispatch();
  const { pending, useBackupCode } = useSelector((s) => s.adminAuth);
  const schema = useBackupCode ? backupCodeSchema : authenticatorCodeSchema;
  const { register, handleSubmit, formState } = useAdminForm(schema, { code: '' });
  const onSubmit = handleSubmit((v) => dispatch(submitSecondFactor(v.code)));
  return (
    <form onSubmit={onSubmit} noValidate key={String(useBackupCode)}>
      <Heading title={useBackupCode ? 'Use a backup code' : 'Authenticator code'}>
        {useBackupCode
          ? 'Enter one of the backup codes you saved when you set up your authenticator. Each code works once.'
          : 'Open your authenticator app and enter the 6-digit code for Byte Bun Admin.'}
      </Heading>
      <ServerError />
      {useBackupCode ? (
        <Field label="Backup code" id="code" error={formState.errors.code?.message}>
          <TextInput id="code" autoComplete="off" autoFocus spellCheck={false} className="font-mono tracking-wider" error={formState.errors.code} {...register('code')} />
        </Field>
      ) : (
        <Field label="6-digit code" id="code" error={formState.errors.code?.message}>
          <CodeInput id="code" autoFocus error={formState.errors.code} {...register('code')} />
        </Field>
      )}
      <AdminButton type="submit" busy={pending} className="w-full">
        Sign in
      </AdminButton>
      <div className="mt-4 flex items-center justify-between text-sm">
        <AdminButton variant="link" onClick={() => dispatch(toggleBackupCode())}>
          {useBackupCode ? 'Use the authenticator app' : 'Lost your phone? Use a backup code'}
        </AdminButton>
        <AdminButton variant="link" onClick={() => dispatch(startOver())}>
          Start over
        </AdminButton>
      </div>
    </form>
  );
}

function SetupStep() {
  const dispatch = useDispatch();
  const { pending, setup, error } = useSelector((s) => s.adminAuth);
  const qr = useQrCode(setup?.totpURI);
  const { register, handleSubmit, formState } = useAdminForm(authenticatorCodeSchema, { code: '' });
  const onSubmit = handleSubmit((v) => dispatch(confirmSetup(v.code)));

  if (!setup) {
    return error ? (
      <>
        <ServerError />
        <AdminButton className="w-full" onClick={() => dispatch(startOver())}>
          Start over
        </AdminButton>
      </>
    ) : (
      <Spinner label="Preparing your authenticator…" />
    );
  }
  const groupedKey = setup.secret.match(/.{1,4}/g)?.join(' ') ?? setup.secret;
  return (
    <form onSubmit={onSubmit} noValidate>
      <Heading title="Set up your authenticator">
        First sign-in: scan this with an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, …). You'll need it every time you sign in.
      </Heading>
      <ServerError />
      <div className="mb-5 flex flex-col items-center gap-3 rounded-card bg-lavender-mist p-5">
        {qr ? (
          <img src={qr} width="220" height="220" alt="QR code for your authenticator app" className="rounded-lg border-4 border-cream-dough" />
        ) : (
          <div className="size-[220px] animate-pulse rounded-lg bg-line" />
        )}
        <details className="w-full text-center text-sm">
          <summary className="cursor-pointer font-semibold text-soft-violet">Can't scan? Enter the key instead</summary>
          <p className="mt-2 font-mono text-[15px] break-all text-midnight-plum select-all">{groupedKey}</p>
          <p className="mt-1 text-xs text-muted">Account: Byte Bun Admin · time-based · 6 digits</p>
        </details>
      </div>
      <Field label="Enter the 6-digit code the app shows" id="code" error={formState.errors.code?.message}>
        <CodeInput id="code" error={formState.errors.code} {...register('code')} />
      </Field>
      <AdminButton type="submit" busy={pending} className="w-full">
        Verify and continue
      </AdminButton>
    </form>
  );
}

function BackupCodesStep() {
  const dispatch = useDispatch();
  const codes = useSelector((s) => s.adminAuth.backupCodes);
  const { register, handleSubmit, formState } = useAdminForm(savedCodesSchema, { saved: false });
  const onSubmit = handleSubmit(() => dispatch(backupCodesSaved()));
  return (
    <form onSubmit={onSubmit} noValidate>
      <Heading title="Save your backup codes">
        If you lose your phone, each of these codes signs you in once. This is the only time they are shown.
      </Heading>
      <BackupCodeList codes={codes} />
      <label className="mt-5 mb-1 flex cursor-pointer items-start gap-3 text-sm text-midnight-plum">
        <input type="checkbox" className="mt-0.5 size-4 accent-byte-purple" {...register('saved')} />
        I've saved these codes somewhere safe (a password manager, or printed).
      </label>
      {formState.errors.saved && <p className="mb-2 text-[13px] font-medium text-danger">{formState.errors.saved.message}</p>}
      <AdminButton type="submit" className="mt-4 w-full">
        Continue to admin
      </AdminButton>
    </form>
  );
}

/** The codes with Copy and Download buttons (also used on the Security page). */
export function BackupCodeList({ codes }) {
  const text = `Byte Bun Admin backup codes (each works once)\n\n${codes.join('\n')}\n`;
  const copy = () => navigator.clipboard?.writeText(text);
  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: 'bytebun-admin-backup-codes.txt' });
    a.click();
    URL.revokeObjectURL(url);
  };
  return (
    <div>
      <ol className="grid grid-cols-2 gap-2 rounded-card bg-lavender-mist p-4 font-mono text-[15px] text-midnight-plum">
        {codes.map((c) => (
          <li key={c} className="rounded-md bg-cream-dough px-3 py-1.5 text-center select-all">
            {c}
          </li>
        ))}
      </ol>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <AdminButton variant="outline" onClick={copy}>
          Copy
        </AdminButton>
        <AdminButton variant="outline" onClick={download}>
          Download .txt
        </AdminButton>
      </div>
    </div>
  );
}
