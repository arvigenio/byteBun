// Who is calling the client API, for which business, and may they? Every /api/client route
// declares what it needs with @ClientRoute(...), and ClientGuard checks, in this order:
//   1. signed in (client session cookie, clients-auth.ts)              else 401
//   2. a member of the active business (session.activeOrganizationId)  else 409 no_business
//   3. the business is active (not deactivated/deleted from the admin)  else 403 account_unavailable
//   4. entitlement: the plan includes the app (and feature)             else 403 not_in_plan
//   5. role: the member's role has the permission (roles.ts)            else 403 forbidden
// The result is on req.client for the handler.
import { applyDecorators, type CanActivate, type ExecutionContext, Inject, Injectable, SetMetadata, UseGuards } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { fromNodeHeaders } from 'better-auth/node';
import type { Request, Response } from 'express';
import type { IncomingHttpHeaders } from 'node:http';
import { ApiError } from '../common/api-error';
import type { ClientsAuth } from './clients-auth';
import { ClientsDb } from './clients-db';
import { type Entitlements, hasApp, hasFeature, loadEntitlements } from './entitlements';
import { isRole, permissionsFor, seesAllEvents, type Permission, type Role } from './roles';

export const CLIENTS_AUTH = Symbol('CLIENTS_AUTH');

export interface ClientUser {
  id: string;
  email: string;
  name: string;
}

export interface ClientSessionInfo {
  user: ClientUser;
  sessionId: string;
  activeOrganizationId: string | null;
}

export interface ClientContext extends ClientSessionInfo {
  org: { id: string; name: string; slug: string };
  role: Role;
  /** Staff on a custom role (Team page). */
  customRole: { id: number; name: string } | null;
  /** What they may do (the built-in role's or the custom role's). */
  permissions: Permission[];
  /** Owners and admins: every event. Everyone else: only the events they're assigned to. */
  allEvents: boolean;
  entitlements: Entitlements;
}

declare module 'express-serve-static-core' {
  interface Request {
    client?: ClientContext;
    clientSession?: ClientSessionInfo;
  }
}

/** The signed-in client user, or null. Copies sliding-session cookies onto `res`. */
export async function getClientSession(auth: ClientsAuth, headers: IncomingHttpHeaders, res?: Response): Promise<ClientSessionInfo | null> {
  const { headers: out, response } = await auth.api.getSession({ headers: fromNodeHeaders(headers), returnHeaders: true });
  const setCookies = out.getSetCookie?.() ?? [];
  if (res && setCookies.length && !res.headersSent) res.append('Set-Cookie', setCookies);
  if (!response) return null;
  const s = response.session as typeof response.session & { activeOrganizationId?: string | null };
  return {
    user: { id: response.user.id, email: response.user.email, name: response.user.name },
    sessionId: s.id,
    activeOrganizationId: s.activeOrganizationId ?? null,
  };
}

export const unavailable = () =>
  new ApiError(403, { error: 'account_unavailable', message: 'This account is currently unavailable. Please contact Byte Bun support.' });

/** The business to work in: the active one if still a member, else the first membership. */
export async function resolveOrg(db: ClientsDb, s: ClientSessionInfo) {
  const members = await db.member.findMany({ where: { userId: s.user.id }, include: { organization: true }, orderBy: { createdAt: 'asc' } });
  const member = members.find((m) => m.organizationId === s.activeOrganizationId) ?? members[0];
  if (!member) return null;
  if (member.organizationId !== s.activeOrganizationId) {
    await db.session.update({ where: { id: s.sessionId }, data: { activeOrganizationId: member.organizationId } }).catch(() => {});
  }
  return member;
}

export async function orgStatus(db: ClientsDb, organizationId: string) {
  return (await db.accountStatus.findUnique({ where: { organizationId } }))?.status ?? 'active';
}

interface RouteNeeds {
  /** Signed in is enough (no business yet), e.g. onboarding. */
  signedInOnly?: boolean;
  app?: string;
  feature?: string;
  permission?: Permission;
}
const NEEDS = 'bytebun:client-route';

/** Marks a route as a client API route and states what it needs. */
export const ClientRoute = (needs: RouteNeeds = {}) => applyDecorators(SetMetadata(NEEDS, needs), UseGuards(ClientGuard));

@Injectable()
export class ClientGuard implements CanActivate {
  constructor(
    @Inject(CLIENTS_AUTH) private readonly auth: ClientsAuth,
    private readonly db: ClientsDb,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const needs = this.reflector.getAllAndOverride<RouteNeeds>(NEEDS, [context.getHandler(), context.getClass()]) ?? {};
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();

    const session = await getClientSession(this.auth, req.headers, res);
    if (!session) throw new ApiError(401, { error: 'unauthorized', message: 'Please sign in.' });
    req.clientSession = session;
    if (needs.signedInOnly) return true;

    const member = await resolveOrg(this.db, session);
    if (!member) throw new ApiError(409, { error: 'no_business', message: 'Set up your business first.' });
    if ((await orgStatus(this.db, member.organizationId)) !== 'active') throw unavailable();

    const entitlements = await loadEntitlements(this.db, member.organizationId);
    if (needs.app && !hasApp(entitlements, needs.app)) {
      throw new ApiError(403, { error: 'not_in_plan', message: 'Your plan does not include this app.' });
    }
    if (needs.feature && !hasFeature(entitlements, needs.feature)) {
      throw new ApiError(403, { error: 'not_in_plan', message: 'Your plan does not include this feature. Upgrade to use it.' });
    }
    const role: Role = isRole(member.role) ? member.role : 'staff';
    const customRole = role === 'staff' && member.teamRoleId ? await this.db.teamRole.findUnique({ where: { id: member.teamRoleId } }) : null;
    const permissions = permissionsFor(role, customRole);
    if (needs.permission && !permissions.includes(needs.permission)) {
      throw new ApiError(403, { error: 'forbidden', message: 'Your role does not allow this. Ask an owner or admin.' });
    }
    // Events: everyone except owners and admins works only on the events they're assigned to.
    const allEvents = seesAllEvents(role);
    const eventId = /^\/api\/client\/bookings\/events\/(\d+)(\/|$)/.exec(req.path)?.[1];
    if (eventId && !allEvents) {
      const assigned = await this.db.eventMember.findUnique({ where: { eventId_userId: { eventId: Number(eventId), userId: session.user.id } } });
      if (!assigned) throw new ApiError(404, { error: 'not_found', message: 'That event does not exist, or you aren’t assigned to it.' });
    }
    req.client = {
      ...session,
      activeOrganizationId: member.organizationId,
      org: { id: member.organization.id, name: member.organization.name, slug: member.organization.slug },
      role,
      customRole: customRole ? { id: customRole.id, name: customRole.name } : null,
      permissions,
      allEvents,
      entitlements,
    };
    return true;
  }
}
