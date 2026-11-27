// Team: custom roles (Team page) and who works on which event (the event's Team tab).
//
//   GET    /api/client/team/roles              the permission catalog + this business's custom roles
//   POST   /api/client/team/roles              { name, permissions }          owners and admins
//   PATCH  /api/client/team/roles/:id          { name?, permissions? }
//   DELETE /api/client/team/roles/:id          only while nobody (member or invitation) has it
//   GET    /api/client/bookings/events/:id/team             assigned members + who can be assigned
//   POST   /api/client/bookings/events/:id/team             { userId }   assign
//   DELETE /api/client/bookings/events/:id/team/:userId     unassign
//
// Owners and admins see every event and every event's chat; everyone else only the events they're
// assigned to (client-context.ts checks every /events/:id route).
import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import * as yup from 'yup';
import { ApiError } from '../../common/api-error';
import { YupValidationPipe } from '../../common/yup-validation.pipe';
import { ClientsDb } from '../clients-db';
import { ClientRoute, type ClientContext } from '../client-context';
import { CUSTOM_PERMISSIONS, EVENT_ROUTES, isRole, PERMISSION_CATALOG, seesAllEvents } from '../roles';
import { ChatService } from './chat.service';

const ctx = (req: Request) => req.client as ClientContext;

const roleSchema = yup.object({
  name: yup.string().trim().min(2, 'At least 2 characters.').max(40, 'At most 40 characters.').required('Please name the role.'),
  permissions: yup
    .array(yup.string().oneOf(CUSTOM_PERMISSIONS as string[], 'Unknown permission.').required())
    .min(1, 'Choose at least one thing this role can do.')
    .max(CUSTOM_PERMISSIONS.length)
    .required('Choose at least one thing this role can do.'),
});
const rolePatchSchema = roleSchema.partial();
const assignSchema = yup.object({ userId: yup.string().trim().max(100).required('Choose a team member.') });

/** Role editing: owners and admins only (a custom role can't widen itself). */
const ROLE_ADMIN = { permission: 'team.manage' } as const;

/** Every permission a role touching events also needs: seeing the event. */
const withImplied = (permissions: string[]) => {
  const set = new Set(permissions);
  if ([...set].some((p) => p.startsWith('events.'))) set.add('events.view');
  if (set.has('bookings.manage') || set.has('bookings.settings')) set.add('bookings.view');
  return CUSTOM_PERMISSIONS.filter((p) => set.has(p));
};

@Controller('client/team/roles')
export class TeamRolesController {
  constructor(private readonly db: ClientsDb) {}

  @Get()
  @ClientRoute({ permission: 'team.view' })
  async list(@Req() req: Request) {
    const orgId = ctx(req).org.id;
    const [roles, counts] = await Promise.all([
      this.db.teamRole.findMany({ where: { organizationId: orgId }, orderBy: { name: 'asc' } }),
      this.db.member.groupBy({ by: ['teamRoleId'], where: { organizationId: orgId, role: 'staff', teamRoleId: { not: null } }, _count: { _all: true } }),
    ]);
    return {
      catalog: PERMISSION_CATALOG,
      // The built-in roles, for the role pickers.
      builtIn: [
        { key: 'owner', name: 'Owner', hint: 'Everything, including the plan. Sees every event.' },
        { key: 'admin', name: 'Admin', hint: 'Everything except the plan. Sees every event.' },
        { key: 'staff', name: 'Staff', hint: 'Bookings, plus attendees and payments of their assigned events.' },
      ],
      roles: roles.map((r) => ({ id: r.id, name: r.name, permissions: r.permissions, members: counts.find((x) => x.teamRoleId === r.id)?._count._all ?? 0 })),
    };
  }

  private async role(orgId: string, id: number) {
    const r = await this.db.teamRole.findFirst({ where: { id, organizationId: orgId } });
    if (!r) throw new ApiError(404, { error: 'not_found', message: 'That role does not exist.' });
    return r;
  }

  private taken(err: unknown) {
    if ((err as { code?: string })?.code === 'P2002') return new ApiError(409, { error: 'name_taken', message: 'There is already a role with that name.', fields: { name: 'Already used.' } });
    return err;
  }

  @Post()
  @ClientRoute(ROLE_ADMIN)
  async create(@Req() req: Request, @Body(new YupValidationPipe(roleSchema)) body: yup.InferType<typeof roleSchema>) {
    try {
      const r = await this.db.teamRole.create({ data: { organizationId: ctx(req).org.id, name: body.name, permissions: withImplied(body.permissions) } });
      return { id: r.id, name: r.name, permissions: r.permissions, members: 0 };
    } catch (err) {
      throw this.taken(err);
    }
  }

  @Patch(':id')
  @ClientRoute(ROLE_ADMIN)
  async update(@Req() req: Request, @Param('id', ParseIntPipe) id: number, @Body(new YupValidationPipe(rolePatchSchema)) body: yup.InferType<typeof rolePatchSchema>) {
    await this.role(ctx(req).org.id, id);
    try {
      const r = await this.db.teamRole.update({ where: { id }, data: { ...(body.name ? { name: body.name } : {}), ...(body.permissions ? { permissions: withImplied(body.permissions) } : {}) } });
      return { id: r.id, name: r.name, permissions: r.permissions };
    } catch (err) {
      throw this.taken(err);
    }
  }

  @Delete(':id')
  @ClientRoute(ROLE_ADMIN)
  async remove(@Req() req: Request, @Param('id', ParseIntPipe) id: number) {
    const orgId = ctx(req).org.id;
    await this.role(orgId, id);
    const [members, invites] = await Promise.all([this.db.member.count({ where: { teamRoleId: id } }), this.db.invitation.count({ where: { teamRoleId: id, status: 'pending' } })]);
    if (members || invites) throw new ApiError(409, { error: 'role_in_use', message: `${members + invites} ${members + invites === 1 ? 'person has' : 'people have'} this role. Give them another role first.` });
    await this.db.teamRole.delete({ where: { id } });
    return { ok: true };
  }
}

@Controller('client/bookings/events/:id/team')
export class EventTeamController {
  constructor(
    private readonly db: ClientsDb,
    private readonly chat: ChatService,
  ) {}

  private async event(orgId: string, id: number) {
    const e = await this.db.event.findFirst({ where: { id, organizationId: orgId }, select: { id: true, title: true } });
    if (!e) throw new ApiError(404, { error: 'not_found', message: 'That event does not exist.' });
    return e;
  }

  /** Who is assigned; and the rest of the team, to assign. Owners and admins see every event anyway. */
  @Get()
  @ClientRoute(EVENT_ROUTES.view)
  async list(@Req() req: Request, @Param('id', ParseIntPipe) id: number) {
    const c = ctx(req);
    await this.event(c.org.id, id);
    const [members, assigned] = await Promise.all([
      this.db.member.findMany({ where: { organizationId: c.org.id }, include: { user: { select: { email: true, name: true } }, teamRole: { select: { name: true } } }, orderBy: { createdAt: 'asc' } }),
      this.db.eventMember.findMany({ where: { eventId: id } }),
    ]);
    const row = (m: (typeof members)[number]) => {
      const role = isRole(m.role) ? m.role : 'staff';
      const a = assigned.find((x) => x.userId === m.userId);
      return { userId: m.userId, name: m.user.name, email: m.user.email, role: m.role, roleName: role === 'staff' && m.teamRole ? m.teamRole.name : { owner: 'Owner', admin: 'Admin', staff: 'Staff' }[role], allEvents: seesAllEvents(role), assigned: !!a, assignedAt: a?.createdAt ?? null, assignedBy: a?.assignedBy ?? null };
    };
    const rows = members.map(row);
    return {
      canAssign: c.permissions.includes('events.manage'),
      // Owners and admins: on every event.
      everyEvent: rows.filter((r) => r.allEvents),
      assigned: rows.filter((r) => !r.allEvents && r.assigned),
      available: rows.filter((r) => !r.allEvents && !r.assigned),
    };
  }

  @Post()
  @ClientRoute(EVENT_ROUTES.manage)
  async assign(@Req() req: Request, @Param('id', ParseIntPipe) id: number, @Body(new YupValidationPipe(assignSchema)) body: yup.InferType<typeof assignSchema>) {
    const c = ctx(req);
    const e = await this.event(c.org.id, id);
    const m = await this.db.member.findFirst({ where: { organizationId: c.org.id, userId: body.userId } });
    if (!m) throw new ApiError(404, { error: 'not_found', message: 'That person isn’t on the team.' });
    if (seesAllEvents(isRole(m.role) ? m.role : 'staff')) throw new ApiError(409, { error: 'sees_all', message: 'Owners and admins already work on every event.' });
    await this.db.eventMember.upsert({ where: { eventId_userId: { eventId: id, userId: body.userId } }, create: { eventId: id, userId: body.userId, organizationId: c.org.id, assignedBy: c.user.email }, update: {} });
    this.chat.notifyRooms(c.org.id, [body.userId]);
    return { ok: true, event: e.title };
  }

  @Delete(':userId')
  @ClientRoute(EVENT_ROUTES.manage)
  async unassign(@Req() req: Request, @Param('id', ParseIntPipe) id: number, @Param('userId') userId: string) {
    const c = ctx(req);
    await this.event(c.org.id, id);
    const { count } = await this.db.eventMember.deleteMany({ where: { eventId: id, userId } });
    if (!count) throw new ApiError(404, { error: 'not_found', message: 'That person isn’t assigned to this event.' });
    this.chat.notifyRooms(c.org.id, [userId]);
    return { ok: true };
  }
}
