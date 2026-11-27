import { yupResolver } from '@hookform/resolvers/yup';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { useAddTeamRoleMutation, useCancelInviteMutation, useDeleteTeamRoleMutation, useInviteMutation, useMeQuery, useRemoveMemberMutation, useSetRoleMutation, useTeamQuery, useTeamRolesQuery, useUpdateTeamRoleMutation } from '../api.js';
import { inviteSchema } from '../lib/schemas.js';
import { Badge, Button, Card, Checkbox, Dialog, Field, Input, Loading, PageHeader, Select, useConfirm } from '../ui.jsx';
import { can } from './BookingsApp.jsx';

// The team: members, invitations and roles (backend accounts.controller.ts, team/team.controller.ts).
// Built-in roles: Owner, Admin (every event), Staff. Custom roles: a name and a set of permissions,
// made by owners and admins. Everyone except owners and admins works only on the events they're
// assigned to (each event's Team tab).

const ROLE_HINT = { owner: 'Everything, including the plan', admin: 'Everything except the plan; every event', staff: 'Bookings, plus attendees and payments of their events' };
/** A role picker's value: owner | admin | staff | role:{id}. */
const valueOf = (role, teamRoleId) => (role === 'staff' && teamRoleId ? `role:${teamRoleId}` : role);
const parse = (v) => (v.startsWith('role:') ? { role: 'staff', teamRoleId: Number(v.slice(5)) } : { role: v, teamRoleId: null });

function RoleOptions({ isOwner, roles }) {
  return (
    <>
      {isOwner && <option value="owner">Owner</option>}
      <option value="admin">Admin</option>
      <option value="staff">Staff</option>
      {roles.length > 0 && (
        <optgroup label="Custom roles">
          {roles.map((r) => (
            <option key={r.id} value={`role:${r.id}`}>
              {r.name}
            </option>
          ))}
        </optgroup>
      )}
    </>
  );
}

export function TeamPage() {
  const { data: me } = useMeQuery();
  const q = useTeamQuery();
  const rolesQ = useTeamRolesQuery();
  const [setRole] = useSetRoleMutation();
  const [remove] = useRemoveMemberMutation();
  const confirm = useConfirm();
  const [cancelInvite] = useCancelInviteMutation();
  const manage = can(me, 'team.manage');
  const isOwner = me.business.role === 'owner';
  if (q.isLoading || !q.data || rolesQ.isLoading) return <Loading />;
  const { members, invitations, seats } = q.data;
  const roles = rolesQ.data?.roles ?? [];
  const act = async (p, ok) => {
    const r = await p;
    if (r.error) toast.error(r.error.message);
    else if (ok) toast.success(ok);
  };

  return (
    <>
      <PageHeader title="Team" description={seats ? `${members.length + invitations.length} of ${seats} seats used` : 'Everyone who can sign in to this business.'} />
      <div className="flex flex-col gap-5">
        {manage && <InviteCard isOwner={isOwner} roles={roles} />}
        <Card title="Members" description="Owners and admins work on every event. Everyone else sees only the events they’re assigned to (each event’s Team tab).">
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
                    <p className="truncate text-sm text-faint">
                      {m.email} · {m.allEvents ? 'every event' : `${m.events} ${m.events === 1 ? 'event' : 'events'}`}
                    </p>
                  </div>
                  {locked ? (
                    <Badge>{m.roleName}</Badge>
                  ) : (
                    <Select className="w-44" value={valueOf(m.role, m.teamRoleId)} onChange={(e) => act(setRole({ id: m.id, ...parse(e.target.value) }), 'Role changed')} aria-label={`Role of ${m.email}`}>
                      <RoleOptions isOwner={isOwner} roles={roles} />
                    </Select>
                  )}
                  {!locked && !self && (
                    <Button
                      size="sm"
                      variant="ghost"
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
                  <Badge>{i.roleName}</Badge>
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
        {rolesQ.data && <RolesCard data={rolesQ.data} manage={manage} />}
      </div>
    </>
  );
}

function InviteCard({ isOwner, roles }) {
  const [invite] = useInviteMutation();
  const { register, handleSubmit, reset, watch, setError, formState } = useForm({ resolver: yupResolver(inviteSchema), defaultValues: { email: '', role: 'staff' } });
  const picked = watch('role');
  const custom = picked.startsWith('role:') ? roles.find((r) => `role:${r.id}` === picked) : null;
  const submit = handleSubmit(async (v) => {
    const r = await invite({ email: v.email, ...parse(v.role) });
    if (r.error) {
      for (const [k, m] of Object.entries(r.error.fields ?? {})) setError(k === 'teamRoleId' ? 'role' : k, { message: m });
      if (!r.error.fields || !Object.keys(r.error.fields).length) setError('email', { message: r.error.message });
      return;
    }
    toast.success(`Invitation sent to ${v.email}`);
    reset({ email: '', role: v.role });
  });
  return (
    <Card title="Invite someone" description="They get an email to accept, then sign in with that address and a one-time code. People can be on several businesses’ teams.">
      <form onSubmit={submit} className="flex flex-wrap items-start gap-3" noValidate>
        <Field label="Email" error={formState.errors.email?.message} className="min-w-56 flex-1">
          {(a) => <Input {...a} type="email" {...register('email')} />}
        </Field>
        <Field label="Role" hint={custom ? `Custom role: ${custom.permissions.length} permissions` : ROLE_HINT[picked]} error={formState.errors.role?.message} className="w-52">
          {(a) => (
            <Select {...a} {...register('role')}>
              <RoleOptions isOwner={isOwner} roles={roles} />
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

function RolesCard({ data, manage }) {
  const [editing, setEditing] = useState(null); // null | 'new' | role
  const [del] = useDeleteTeamRoleMutation();
  const confirm = useConfirm();
  const labels = Object.fromEntries(data.catalog.flatMap((g) => g.items.map((i) => [i.key, i.label])));
  return (
    <Card
      title="Custom roles"
      description="Choose exactly what someone can see and do, e.g. a front desk role for bookings only, or an event crew role for check-in."
      actions={
        manage && (
          <Button size="sm" variant="secondary" onClick={() => setEditing('new')}>
            New role
          </Button>
        )
      }
    >
      {!data.roles.length ? (
        <p className="rounded-card border border-dashed border-line-strong px-4 py-6 text-center text-sm text-muted">No custom roles yet. Team members are Owner, Admin or Staff.</p>
      ) : (
        <ul className="divide-y divide-line">
          {data.roles.map((r) => (
            <li key={r.id} className="flex flex-wrap items-start gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-medium">
                  {r.name} <span className="text-sm font-normal text-faint">· {r.members} {r.members === 1 ? 'member' : 'members'}</span>
                </p>
                <p className="text-sm text-muted">{r.permissions.map((p) => labels[p] ?? p).join(' · ')}</p>
              </div>
              {manage && (
                <span className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(r)}>
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      if (!(await confirm({ title: `Delete the ${r.name} role?`, body: 'Only possible when nobody has it.', action: 'Delete' }))) return;
                      const res = await del(r.id);
                      if (res.error) toast.error(res.error.message);
                      else toast.success('Role deleted');
                    }}
                  >
                    Delete
                  </Button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {editing && <RoleDialog catalog={data.catalog} role={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </Card>
  );
}

function RoleDialog({ catalog, role, onClose }) {
  const [add, addState] = useAddTeamRoleMutation();
  const [update, updateState] = useUpdateTeamRoleMutation();
  const [name, setName] = useState(role?.name ?? '');
  const [perms, setPerms] = useState(() => new Set(role?.permissions ?? ['bookings.view']));
  const [errors, setErrors] = useState({});
  const busy = addState.isLoading || updateState.isLoading;
  const toggle = (k) => setPerms((s) => {
    const n = new Set(s);
    if (n.has(k)) n.delete(k);
    else n.add(k);
    return n;
  });
  const save = async (e) => {
    e?.preventDefault();
    setErrors({});
    const body = { name, permissions: [...perms] };
    const r = role ? await update({ id: role.id, ...body }) : await add(body);
    if (r.error) {
      setErrors(r.error.fields ?? {});
      return toast.error(r.error.message);
    }
    toast.success(role ? 'Role saved' : `${name} created`);
    onClose();
  };
  return (
    <Dialog
      open
      wide
      onClose={onClose}
      busy={busy}
      title={role ? `Edit ${role.name}` : 'New role'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="role-form" loading={busy} disabled={name.trim().length < 2 || !perms.size}>
            {role ? 'Save' : 'Create role'}
          </Button>
        </>
      }
    >
      <form id="role-form" onSubmit={save} className="flex flex-col gap-5" noValidate>
        <Field label="Name" hint="e.g. Front desk, Event crew, Cashier" error={errors.name}>
          {(a) => <Input {...a} autoFocus value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />}
        </Field>
        {catalog.map((g) => (
          <fieldset key={g.group} className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-semibold">{g.group}</legend>
            {g.items.map((i) => (
              <Checkbox key={i.key} label={i.label} hint={i.hint} checked={perms.has(i.key)} onChange={() => toggle(i.key)} />
            ))}
          </fieldset>
        ))}
        {errors.permissions && <p className="text-[13px] text-danger">{errors.permissions}</p>}
        <p className="text-xs text-muted">Inviting people and changing roles stays with owners and admins.</p>
      </form>
    </Dialog>
  );
}
