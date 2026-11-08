import { useDispatch } from 'react-redux';
import { useAdminForm } from '../hooks/admin/useAdminForm.js';
import { useSecurity } from '../hooks/admin/useAdminPages.js';
import { authenticatorCodeSchema } from '../lib/adminSchemas.js';
import { fetchSecurity, newBackupCodes, newCodesDismissed, signOutOtherSessions, signOutSession } from '../store/adminDataSlices.js';
import { PageTitle } from './AdminLayout.jsx';
import { BackupCodeList } from './SignInPage.jsx';
import { AdminButton, Badge, CodeInput, Field, formatDateTime, Notice, Panel, Spinner } from './ui.jsx';

function describeDevice(ua = '') {
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}

export function SecurityPage() {
  const dispatch = useDispatch();
  const { data, status, error, newCodes, notice } = useSecurity();

  const revoke = async (s) => {
    const result = await dispatch(signOutSession(s.id));
    if (result.payload?.signedOutCurrent) window.location.replace('/');
    else dispatch(fetchSecurity());
  };
  const revokeOthers = async () => {
    await dispatch(signOutOtherSessions());
    dispatch(fetchSecurity());
  };

  if (!data) return status === 'error' ? <Notice tone="danger">{error}</Notice> : <Spinner />;
  const others = data.sessions.filter((s) => !s.current).length;

  return (
    <>
      <PageTitle title="Security">
        Signed in as {data.user.email}. Every sign-in attempt is emailed to both admins.
      </PageTitle>
      {notice && <Notice tone="success">{notice}</Notice>}

      <Panel className="mb-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-midnight-plum">Active sessions</h2>
            <p className="text-sm text-muted">Sessions end after 12 hours. Sign out anything you don't recognise, then tell the other admin.</p>
          </div>
          <AdminButton variant="danger" disabled={!others} onClick={revokeOthers}>
            Sign out all other devices
          </AdminButton>
        </div>
        <ul className="divide-y divide-line border-y border-line">
          {data.sessions.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-x-6 gap-y-2 py-3.5">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 font-semibold text-midnight-plum">
                  {describeDevice(s.userAgent)}
                  {s.current && <Badge tone="teal">This device</Badge>}
                  {!s.fullySignedIn && <Badge tone="gold">Stopped after email code</Badge>}
                </div>
                <div className="text-sm text-muted">
                  IP {s.ipAddress || 'unknown'} · signed in {formatDateTime(s.createdAt)} · last active {formatDateTime(s.updatedAt)}
                </div>
              </div>
              <AdminButton variant="outline" className="min-h-9 px-3.5 py-1.5 text-sm" onClick={() => revoke(s)}>
                {s.current ? 'Sign out this device' : 'Sign out'}
              </AdminButton>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel>
        <h2 className="text-lg font-bold text-midnight-plum">Backup codes</h2>
        <p className="mb-4 text-sm text-muted">
          For signing in without your phone. Each works once.{' '}
          <strong className={data.backupCodesRemaining <= 3 ? 'text-danger' : 'text-midnight-plum'}>{data.backupCodesRemaining} remaining.</strong>
        </p>
        {newCodes.length ? (
          <div className="max-w-md">
            <Notice tone="warning">Your old backup codes no longer work. Save these now; they won't be shown again.</Notice>
            <BackupCodeList codes={newCodes} />
            <AdminButton className="mt-4" onClick={() => dispatch(newCodesDismissed())}>
              I've saved them
            </AdminButton>
          </div>
        ) : (
          <RegenerateForm />
        )}
      </Panel>
    </>
  );
}

function RegenerateForm() {
  const dispatch = useDispatch();
  const { register, handleSubmit, formState, setError, reset } = useAdminForm(authenticatorCodeSchema, { code: '' });
  const onSubmit = handleSubmit(async (v) => {
    const result = await dispatch(newBackupCodes(v.code));
    if (newBackupCodes.rejected.match(result)) setError('code', { type: 'server', message: result.payload?.fields?.code || result.payload?.message });
    else reset({ code: '' });
  });
  return (
    <form onSubmit={onSubmit} noValidate className="max-w-xs">
      <Field label="Current authenticator code" id="regen-code" hint="Needed to make new codes. The old ones stop working." error={formState.errors.code?.message}>
        <CodeInput id="regen-code" error={formState.errors.code} {...register('code')} />
      </Field>
      <AdminButton type="submit" variant="outline" busy={formState.isSubmitting}>
        Regenerate backup codes
      </AdminButton>
    </form>
  );
}
