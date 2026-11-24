import { yupResolver } from '@hookform/resolvers/yup';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { useCancelInviteMutation, useInviteMutation, useMeQuery, useRemoveMemberMutation, useSetRoleMutation, useTeamQuery } from '../api.js';
import { inviteSchema } from '../lib/schemas.js';
import { Badge, Button, Card, Field, Input, Loading, PageHeader, Select, useConfirm } from '../ui.jsx';
import { can } from './BookingsApp.jsx';

const ROLE_HINT = { owner: 'Everything, including the plan', admin: 'Settings, services, page and team', staff: 'Sees and manages bookings' };

export function TeamPage() {
  const { data: me } = useMeQuery();
  const q = useTeamQuery();
  const [setRole] = useSetRoleMutation();
  const [remove] = useRemoveMemberMutation();
  const confirm = useConfirm();
  const [cancelInvite] = useCancelInviteMutation();
  const manage = can(me, 'team.manage');
  const isOwner = me.business.role === 'owner';
  if (q.isLoading || !q.data) return <Loading />;
  const { members, invitations, seats } = q.data;
  const act = async (p, ok) => {
    const r = await p;
    if (r.error) toast.error(r.error.message);
    else if (ok) toast.success(ok);
  };

  return (
    <>
      <PageHeader title="Team" description={seats ? `${members.length + invitations.length} of ${seats} seats used` : 'Everyone who can sign in to this business.'} />
      <div className="flex flex-col gap-5">
        {manage && <InviteCard isOwner={isOwner} />}
        <Card title="Members">
          <ul className="divide-y divide-line">
            {members.map((m) => {
              const self = m.userId === me.user.id;
              const locked = !manage || (m.role === 'owner' && !isOwner);
              return (
                <li key={m.id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">
                      {m.name || m.email} {self && <Badge tone="brand">You</Badge>}
                    </p>
                    <p className="truncate text-sm text-faint">{m.email}</p>
                  </div>
                  {locked ? (
                    <Badge>{m.role}</Badge>
                  ) : (
                    <Select className="w-32" value={m.role} onChange={(e) => act(setRole({ id: m.id, role: e.target.value }), 'Role changed')} aria-label={`Role of ${m.email}`}>
                      {(isOwner ? ['owner', 'admin', 'staff'] : ['admin', 'staff']).map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </Select>
                  )}
                  {!locked && !self && (
                    <Button size="sm" variant="ghost" 
                      onClick={async () => {
                        const sure = await confirm({ title: 'Remove from the team?', body: `${m.name || m.email} will lose access to this business. You can invite them again later.`, action: 'Remove' });
                        if (sure) act(remove(m.id), 'Removed');
                      }}
                    >
                      Remove
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
        {!!invitations.length && (
          <Card title="Pending invitations">
            <ul className="divide-y divide-line">
              {invitations.map((i) => (
                <li key={i.id} className="flex items-center gap-3 py-3 text-sm">
                  <span className="flex-1 truncate">{i.email}</span>
                  <Badge>{i.role}</Badge>
                  {manage && (
                    <Button size="sm" variant="ghost" onClick={() => act(cancelInvite(i.id), 'Invitation cancelled')}>
                      Cancel
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </div>
    </>
  );
}

function InviteCard({ isOwner }) {
  const [invite] = useInviteMutation();
  const { register, handleSubmit, reset, watch, setError, formState } = useForm({ resolver: yupResolver(inviteSchema), defaultValues: { email: '', role: 'staff' } });
  const submit = handleSubmit(async (v) => {
    const r = await invite(v);
    if (r.error) {
      for (const [k, m] of Object.entries(r.error.fields ?? {})) setError(k, { message: m });
      if (!r.error.fields || !Object.keys(r.error.fields).length) setError('email', { message: r.error.message });
      return;
    }
    toast.success(`Invitation sent to ${v.email}`);
    reset({ email: '', role: v.role });
  });
  return (
    <Card title="Invite someone" description="They get an email with a link, and sign in with that address.">
      <form onSubmit={submit} className="flex flex-wrap items-start gap-3" noValidate>
        <Field label="Email" error={formState.errors.email?.message} className="min-w-56 flex-1">
          {(a) => <Input {...a} type="email" {...register('email')} />}
        </Field>
        <Field label="Role" hint={ROLE_HINT[watch('role')]} className="w-44">
          {(a) => (
            <Select {...a} {...register('role')}>
              {isOwner && <option value="owner">Owner</option>}
              <option value="admin">Admin</option>
              <option value="staff">Staff</option>
            </Select>
          )}
        </Field>
        <Button type="submit" className="mt-6" loading={formState.isSubmitting}>
          Send invite
        </Button>
      </form>
    </Card>
  );
}
