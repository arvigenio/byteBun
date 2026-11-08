// "Is this request from a fully signed-in admin?" Used by the API guard and by the page gate
// for /admin/* in web/static-site.ts.
import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { fromNodeHeaders } from 'better-auth/node';
import type { Request, Response } from 'express';
import type { IncomingHttpHeaders } from 'node:http';
import { ApiError } from '../common/api-error';
import type { Auth } from './auth';
import { AUTH } from './auth.module';

export type AuthSession = NonNullable<Awaited<ReturnType<Auth['api']['getSession']>>>;

export interface AdminSession {
  user: AuthSession['user'];
  session: AuthSession['session'];
}

/**
 * The session, only if ALL of these hold:
 *  - the user's role is admin and they aren't banned
 *  - they have an authenticator set up (twoFactorEnabled)
 *  - this session was created by a correct authenticator or backup code (secondFactorVerified)
 * Session refresh cookies (sliding expiry) are copied onto `res` when given.
 */
export async function getAdminSession(auth: Auth, headers: IncomingHttpHeaders, res?: Response): Promise<AdminSession | null> {
  const { headers: out, response } = await auth.api.getSession({
    headers: fromNodeHeaders(headers),
    query: { disableCookieCache: true },
    returnHeaders: true,
  });
  const setCookies = out.getSetCookie?.() ?? [];
  if (res && setCookies.length && !res.headersSent) res.append('Set-Cookie', setCookies);
  if (!response) return null;
  const { user, session } = response;
  if (user.role !== 'admin' || user.banned || user.twoFactorEnabled !== true || session.secondFactorVerified !== true) return null;
  return { user, session };
}

export const isAdminApiPath = (path: string) => path === '/api/admin' || path.startsWith('/api/admin/');

declare module 'express-serve-static-core' {
  interface Request {
    admin?: AdminSession;
  }
}

/**
 * Global guard: every route under /api/admin requires a fully signed-in admin, so a new admin
 * controller is protected without anyone remembering to add a decorator. Other routes (the
 * public lead form, booking slots, health) are untouched.
 */
@Injectable()
export class AdminSessionGuard implements CanActivate {
  constructor(@Inject(AUTH) private readonly auth: Auth) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const req = context.switchToHttp().getRequest<Request>();
    if (!isAdminApiPath(req.path)) return true;
    const admin = await getAdminSession(this.auth, req.headers, context.switchToHttp().getResponse<Response>());
    if (!admin) throw new ApiError(401, { error: 'unauthorized', message: 'Please sign in.' });
    req.admin = admin;
    return true;
  }
}
