// The signed-in client: who they are, their businesses, plan and apps, new business setup, and
// the team (members, roles, invitations).
//
//   GET    /api/client/config                       public: hosts, shared sign-in, surface
//   GET    /api/client/me                           user, businesses, active business (+plan, apps, role)
//   GET    /api/client/profile                      the signed-in person (email read-only)
//   PATCH  /api/client/profile          { firstName, lastName?, phone? }   (never the email)
//   PATCH  /api/client/business         { name }  the company name (owners, admins)
//   POST   /api/client/onboarding       { firstName, lastName?, businessName, slug, timeZone }  -> new business (free plan)
//   POST   /api/client/active-business  { organizationId }
//   GET    /api/client/team                         members + pending invitations
//   POST   /api/client/team/invitations { email, role }
//   DELETE /api/client/team/invitations/:id
//   PATCH  /api/client/team/members/:id { role }
//   DELETE /api/client/team/members/:id
//   GET    /api/client/invitations/:id              for the signed-in invitee
//   POST   /api/client/invitations/:id/accept
import crypto from 'node:crypto';
import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Req } from '@nestjs/common';
import { isAPIError } from 'better-auth/api';
import { fromNodeHeaders } from 'better-auth/node';
import type { Request } from 'express';
import type * as yup from 'yup';
import { ApiError } from '../common/api-error';
import { StrictRateLimit } from '../common/rate-limit';
import { YupValidationPipe } from '../common/yup-validation.pipe';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { logger } from '../logging/logger';
import { activeOrgSchema, businessNameSchema, fullName, inviteSchema, onboardingSchema, profileSchema, roleSchema } from './booking/schemas';
import type { ClientsAuth } from './clients-auth';
import { ClientsDb } from './clients-db';
import { CLIENTS_AUTH, ClientRoute, type ClientContext, getClientSession, orgStatus, resolveOrg } from './client-context';
import { APP_CATALOG, landingOf, loadEntitlements, startPlan } from './entitlements';
import { surfaceOf } from './hosts';
import { can, isRole, permissionsOf } from './roles';

const DEFAULT_HOURS = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startMinute: 9 * 60, endMinute: 17 * 60 }));

/** Better Auth errors -> our error shape. */
async function authCall<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (isAPIError(err)) {
      const status = (err as { statusCode?: number }).statusCode ?? 400;
      const message = (err.body as { message?: string } | undefined)?.message || 'That did not work. Please try again.';
      throw new ApiError(status >= 500 ? 400 : status, { error: 'auth_error', message });
    }
    throw err;
  }
}

const ctx = (req: Request) => req.client as ClientContext;

@Controller('client')
export class AccountsController {
  constructor(
    private readonly db: ClientsDb,
    @Inject(CLIENTS_AUTH) private readonly auth: ClientsAuth,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  @Get('config')
  config(@Req() req: Request) {
    const c = this.cfg.clients;
    return { surface: surfaceOf(this.cfg, req.headers.host), accountsUrl: c.accountsUrl, bookingsUrl: c.bookingsUrl, portalUrl: c.portalUrl, sharedSignIn: !!c.cookieDomain };
  }

  @Get('me')
  async me(@Req() req: Request) {
    const session = await getClientSession(this.auth, req.headers, req.res);
    if (!session) throw new ApiError(401, { error: 'unauthorized', message: 'Please sign in.' });
    const active = await resolveOrg(this.db, session);
    const members = await this.db.member.findMany({ where: { userId: session.user.id }, include: { organization: true }, orderBy: { createdAt: 'asc' } });
    let business = null;
    if (active) {
      const e = await loadEntitlements(this.db, active.organizationId);
      const role = isRole(active.role) ? active.role : 'staff';
      const settings = await this.db.bookingSettings.findUnique({ where: { organizationId: active.organizationId }, select: { slug: true, businessName: true } });
      business = {
        id: active.organizationId,
        name: active.organization.name,
        slug: active.organization.slug,
        role,
        permissions: permissionsOf(role),
        status: await orgStatus(this.db, active.organizationId),
        plan: { code: e.planCode, name: e.planName },
        apps: APP_CATALOG.map((a) => ({ ...a, enabled: e.apps.includes(a.key) })),
        features: e.features,
        limits: e.limits,
        landing: landingOf(e),
        publicUrl: settings ? `${this.cfg.clients.bookingsUrl}/${settings.slug}` : null,
      };
    }
    return {
      user: session.user,
      businesses: members.map((m) => ({ id: m.organizationId, name: m.organization.name, role: m.role })),
      business,
    };
  }

  @Get('profile')
  @ClientRoute({ signedInOnly: true })
  async getProfile(@Req() req: Request) {
    const s = req.clientSession!;
    const u = await this.db.user.findUniqueOrThrow({ where: { id: s.user.id } });
    const member = await resolveOrg(this.db, s);
    return {
      email: u.email,
      firstName: u.firstName ?? '',
      lastName: u.lastName ?? '',
      phone: u.phone ?? '',
      business: member ? { id: member.organizationId, name: member.organization.name, canEdit: isRole(member.role) && can(member.role, 'team.manage') } : null,
    };
  }

  @Patch('profile')
  @ClientRoute({ signedInOnly: true })
  async profile(@Req() req: Request, @Body(new YupValidationPipe(profileSchema)) body: yup.InferType<typeof profileSchema>) {
    await this.db.user.update({
      where: { id: req.clientSession!.user.id },
      data: { firstName: body.firstName, lastName: body.lastName ?? null, phone: body.phone ?? null, name: fullName(body.firstName, body.lastName) },
    });
    return this.getProfile(req);
  }

  /** The company name: everywhere the business is named (portal, booking page, emails). */
  @Patch('business')
  @ClientRoute({ permission: 'team.manage' })
  async businessName(@Req() req: Request, @Body(new YupValidationPipe(businessNameSchema)) body: yup.InferType<typeof businessNameSchema>) {
    const { org } = ctx(req);
    await this.db.$transaction([
      this.db.organization.update({ where: { id: org.id }, data: { name: body.name } }),
      this.db.bookingSettings.updateMany({ where: { organizationId: org.id }, data: { businessName: body.name } }),
    ]);
    return { ok: true, name: body.name };
  }

  @Post('onboarding')
  @HttpCode(201)
  @StrictRateLimit()
  @ClientRoute({ signedInOnly: true })
  async onboarding(@Req() req: Request, @Body(new YupValidationPipe(onboardingSchema)) body: yup.InferType<typeof onboardingSchema>) {
    const s = req.clientSession!;
    const owned = await this.db.member.count({ where: { userId: s.user.id, role: 'owner' } });
    if (owned >= 5) throw new ApiError(409, { error: 'too_many_businesses', message: 'You already have 5 businesses. Contact Byte Bun to add more.' });
    const taken = await this.db.bookingSettings.findUnique({ where: { slug: body.slug } });
    if (taken || (await this.db.organization.findUnique({ where: { slug: body.slug } }))) {
      throw new ApiError(409, { error: 'validation_failed', message: 'That booking link is taken.', fields: { slug: 'That link is taken. Please choose another.' } });
    }
    const id = crypto.randomUUID();
    await this.db.$transaction(async (tx) => {
      await tx.user.update({ where: { id: s.user.id }, data: { firstName: body.firstName, lastName: body.lastName ?? null, name: fullName(body.firstName, body.lastName) } });
      await tx.organization.create({ data: { id, name: body.businessName, slug: body.slug } });
      await tx.member.create({ data: { id: crypto.randomUUID(), organizationId: id, userId: s.user.id, role: 'owner' } });
      await startPlan(tx, id, 'free', s.user.email);
      await tx.bookingSettings.create({ data: { organizationId: id, slug: body.slug, businessName: body.businessName, timeZone: body.timeZone, contactEmail: s.user.email } });
      await tx.weeklyHours.createMany({ data: DEFAULT_HOURS.map((h) => ({ ...h, organizationId: id })) });
      await tx.session.update({ where: { id: s.sessionId }, data: { activeOrganizationId: id } });
    });
    logger.info({ org: id, slug: body.slug }, 'Client business created (free plan)');
    return { ok: true, organizationId: id };
  }

  @Post('active-business')
  @HttpCode(200)
  @ClientRoute({ signedInOnly: true })
  async setActive(@Req() req: Request, @Body(new YupValidationPipe(activeOrgSchema)) body: yup.InferType<typeof activeOrgSchema>) {
    const s = req.clientSession!;
    const member = await this.db.member.findFirst({ where: { userId: s.user.id, organizationId: body.organizationId } });
    if (!member) throw new ApiError(404, { error: 'not_found', message: 'You are not a member of that business.' });
    await this.db.session.update({ where: { id: s.sessionId }, data: { activeOrganizationId: member.organizationId } });
    return { ok: true };
  }

  // ---- Team ----

  @Get('team')
  @ClientRoute({ permission: 'team.view' })
  async team(@Req() req: Request) {
    const { org } = ctx(req);
    const [members, invitations] = await Promise.all([
      this.db.member.findMany({ where: { organizationId: org.id }, include: { user: { select: { email: true, name: true } } }, orderBy: { createdAt: 'asc' } }),
      this.db.invitation.findMany({ where: { organizationId: org.id, status: 'pending', expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' } }),
    ]);
    return {
      members: members.map((m) => ({ id: m.id, userId: m.userId, email: m.user.email, name: m.user.name, role: m.role, since: m.createdAt })),
      invitations: invitations.map((i) => ({ id: i.id, email: i.email, role: i.role, expiresAt: i.expiresAt })),
      seats: ctx(req).entitlements.limits['bookings.staff'] ?? null,
    };
  }

  @Post('team/invitations')
  @HttpCode(201)
  @StrictRateLimit()
  @ClientRoute({ permission: 'team.manage' })
  async invite(@Req() req: Request, @Body(new YupValidationPipe(inviteSchema)) body: yup.InferType<typeof inviteSchema>) {
    const c = ctx(req);
    if (body.role === 'owner' && c.role !== 'owner') throw new ApiError(403, { error: 'forbidden', message: 'Only an owner can invite another owner.' });
    const existing = await this.db.member.findFirst({ where: { organizationId: c.org.id, user: { email: body.email } } });
    if (existing) throw new ApiError(409, { error: 'validation_failed', message: 'Already on the team.', fields: { email: 'This person is already on the team.' } });
    const seats = c.entitlements.limits['bookings.staff'];
    if (seats !== undefined) {
      const used = (await this.db.member.count({ where: { organizationId: c.org.id } })) + (await this.db.invitation.count({ where: { organizationId: c.org.id, status: 'pending', expiresAt: { gt: new Date() } } }));
      if (used >= seats) throw new ApiError(403, { error: 'not_in_plan', message: `Your plan includes ${seats} team members. Upgrade to add more.` });
    }
    const inv = await authCall(() =>
      this.auth.api.createInvitation({ headers: fromNodeHeaders(req.headers), body: { email: body.email, role: body.role, organizationId: c.org.id, resend: true } }),
    );
    return { ok: true, id: (inv as { id?: string })?.id ?? null };
  }

  @Delete('team/invitations/:id')
  @ClientRoute({ permission: 'team.manage' })
  async cancelInvite(@Req() req: Request, @Param('id') id: string) {
    const { count } = await this.db.invitation.updateMany({ where: { id, organizationId: ctx(req).org.id, status: 'pending' }, data: { status: 'canceled' } });
    if (!count) throw new ApiError(404, { error: 'not_found', message: 'That invitation does not exist.' });
    return { ok: true };
  }

  private async memberOf(req: Request, id: string) {
    const c = ctx(req);
    const m = await this.db.member.findFirst({ where: { id, organizationId: c.org.id } });
    if (!m) throw new ApiError(404, { error: 'not_found', message: 'That team member does not exist.' });
    if (m.role === 'owner' && c.role !== 'owner') throw new ApiError(403, { error: 'forbidden', message: 'Only an owner can change an owner.' });
    return m;
  }

  private async assertNotLastOwner(orgId: string, memberRole: string) {
    if (memberRole !== 'owner') return;
    const owners = await this.db.member.count({ where: { organizationId: orgId, role: 'owner' } });
    if (owners <= 1) throw new ApiError(409, { error: 'last_owner', message: 'A business needs at least one owner. Make someone else an owner first.' });
  }

  @Patch('team/members/:id')
  @ClientRoute({ permission: 'team.manage' })
  async setRole(@Req() req: Request, @Param('id') id: string, @Body(new YupValidationPipe(roleSchema)) body: yup.InferType<typeof roleSchema>) {
    const c = ctx(req);
    const m = await this.memberOf(req, id);
    if (body.role === 'owner' && c.role !== 'owner') throw new ApiError(403, { error: 'forbidden', message: 'Only an owner can make someone an owner.' });
    if (m.role === body.role) return { ok: true };
    await this.assertNotLastOwner(c.org.id, m.role);
    await this.db.member.update({ where: { id: m.id }, data: { role: body.role } });
    return { ok: true };
  }

  @Delete('team/members/:id')
  @ClientRoute({ permission: 'team.manage' })
  async removeMember(@Req() req: Request, @Param('id') id: string) {
    const c = ctx(req);
    const m = await this.memberOf(req, id);
    await this.assertNotLastOwner(c.org.id, m.role);
    await this.db.$transaction([
      this.db.member.delete({ where: { id: m.id } }),
      // Signed out of this business right away.
      this.db.session.updateMany({ where: { userId: m.userId, activeOrganizationId: c.org.id }, data: { activeOrganizationId: null } }),
    ]);
    return { ok: true };
  }

  // ---- Invitations (the invitee) ----

  private async invitationFor(req: Request, id: string) {
    const s = req.clientSession!;
    const inv = await this.db.invitation.findUnique({ where: { id }, include: { organization: true, inviter: { select: { name: true, email: true } } } });
    if (!inv || inv.status !== 'pending' || inv.expiresAt <= new Date()) throw new ApiError(404, { error: 'invalid_invitation', message: 'This invitation is not valid any more. Ask for a new one.' });
    if (inv.email.toLowerCase() !== s.user.email.toLowerCase()) {
      throw new ApiError(403, { error: 'wrong_account', message: `This invitation is for ${inv.email}. Sign in with that email address to accept it.` });
    }
    return inv;
  }

  @Get('invitations/:id')
  @ClientRoute({ signedInOnly: true })
  async invitation(@Req() req: Request, @Param('id') id: string) {
    const inv = await this.invitationFor(req, id);
    return { id: inv.id, businessName: inv.organization.name, role: inv.role, inviter: inv.inviter.name || inv.inviter.email };
  }

  @Post('invitations/:id/accept')
  @HttpCode(200)
  @ClientRoute({ signedInOnly: true })
  async accept(@Req() req: Request, @Param('id') id: string) {
    const inv = await this.invitationFor(req, id);
    if ((await orgStatus(this.db, inv.organizationId)) !== 'active') throw new ApiError(403, { error: 'account_unavailable', message: 'This business is currently unavailable.' });
    await authCall(() => this.auth.api.acceptInvitation({ headers: fromNodeHeaders(req.headers), body: { invitationId: id } }));
    await this.db.session.update({ where: { id: req.clientSession!.sessionId }, data: { activeOrganizationId: inv.organizationId } });
    return { ok: true };
  }
}
