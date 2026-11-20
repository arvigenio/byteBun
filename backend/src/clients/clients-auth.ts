// Client sign-in (accounts.bytebuntech.com): Better Auth on the CLIENTS database, separate from
// the admin sign-in (src/auth/auth.ts: other database, other cookies, other secret).
//
//   POST /api/accounts/auth/email-otp/send-verification-otp  { email, type: "sign-in" }
//   POST /api/accounts/auth/sign-in/email-otp                { email, otp }
//   GET  /api/accounts/auth/get-session
//   POST /api/accounts/auth/sign-out
//
// Passwordless: a 6-digit emailed code, nothing else. A new email gets an account on first
// sign-in (then /welcome creates their business). One account per email across every app:
// adding an app later adds it to the same account.
//
// The session cookie is shared by accounts / bookings / clientportal (CLIENT_COOKIE_DOMAIN,
// e.g. .bytebuntech.com), so one sign-in works in every client app. Cookie names start with
// "bb-client" and never collide with the admin site's "bb-admin" cookies.
//
// Organizations (Better Auth organization plugin): a business = an organization, with members
// (owner | admin | staff, roles.ts) and invitations. The browser may only call the four
// endpoints above; everything else goes through our own API (/api/client/*), which checks the
// entitlement and the role first and then calls auth.api server-side.
import crypto from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { emailOTP, organization } from 'better-auth/plugins';
import { CLIENT_IP_HEADER } from '../auth/request-meta';
import type { Mailer } from '../auth/mailer';
import { hitCounter } from '../auth/security-counter';
import type { AppConfig } from '../config/config';
import { logger } from '../logging/logger';
import type { ClientsDb } from './clients-db';
import { invitationMail, signInCodeMail } from './client-emails';
import { limitOf, loadEntitlements } from './entitlements';
import { orgAccessControl, orgRoles } from './roles';

export const CLIENTS_AUTH_BASE_PATH = '/api/accounts/auth';

const OTP_LENGTH = 6;
const OTP_EXPIRES_SECONDS = 10 * 60;
const BROWSER_PATHS = new Set(['/email-otp/send-verification-otp', '/sign-in/email-otp', '/get-session', '/sign-out']);
const OTP_SENDS_PER_EMAIL = { max: 5, windowMs: 15 * 60_000 };

const normEmail = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase().slice(0, 254) : '');

export interface ClientsAuthDeps {
  cfg: AppConfig;
  db: ClientsDb;
  mailer: Mailer;
  /** Admin database: its security_counters table also counts codes per client email. */
  counters: PrismaClient;
}

/** Separate signing key for client cookies, derived from BETTER_AUTH_SECRET. */
const deriveSecret = (secret: string) => crypto.createHmac('sha256', secret).update('bytebun:clients-auth:v1').digest('base64url');

export function createClientsAuth({ cfg, db, mailer, counters }: ClientsAuthDeps) {
  const c = cfg.clients;
  return betterAuth({
    appName: 'Byte Bun Accounts',
    baseURL: c.accountsUrl,
    basePath: CLIENTS_AUTH_BASE_PATH,
    secret: deriveSecret(cfg.auth.secret),
    trustedOrigins: [c.accountsUrl, c.bookingsUrl, c.portalUrl],
    database: prismaAdapter(db, { provider: 'postgresql' }),
    telemetry: { enabled: false },
    logger: {
      level: 'warn',
      log: (level, message) => (level === 'error' ? logger.error({ source: 'clients-auth' }, message) : logger.warn({ source: 'clients-auth' }, message)),
    },
    emailAndPassword: { enabled: false },
    session: {
      expiresIn: 30 * 24 * 60 * 60, // 30 days
      updateAge: 24 * 60 * 60,
    },
    rateLimit: {
      enabled: !cfg.rateLimitsDisabled,
      storage: 'database',
      window: 60,
      max: 100,
      customRules: {
        '/email-otp/send-verification-otp': { window: 10 * 60, max: 5 },
        '/sign-in/email-otp': { window: 5 * 60, max: 8 },
      },
    },
    advanced: {
      cookiePrefix: 'bb-client',
      useSecureCookies: cfg.isProd,
      crossSubDomainCookies: c.cookieDomain ? { enabled: true, domain: c.cookieDomain } : { enabled: false },
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax', secure: cfg.isProd },
      ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
    },
    plugins: [
      emailOTP({
        otpLength: OTP_LENGTH,
        expiresIn: OTP_EXPIRES_SECONDS,
        allowedAttempts: 5,
        disableSignUp: false, // first sign-in creates the account
        storeOTP: 'hashed',
        async sendVerificationOTP({ email, otp, type }) {
          if (type !== 'sign-in') return;
          mailer.sendInBackground(signInCodeMail(cfg, email, otp, OTP_EXPIRES_SECONDS / 60));
        },
      }),
      organization({
        ac: orgAccessControl,
        roles: orgRoles,
        creatorRole: 'owner',
        invitationExpiresIn: 7 * 24 * 60 * 60,
        cancelPendingInvitationsOnReInvite: true,
        // Staff seats per plan (limit bookings.staff).
        membershipLimit: async (_user, org) => {
          const e = await loadEntitlements(db, org.id);
          return limitOf(e, 'bookings.staff') ?? 1000;
        },
        async sendInvitationEmail(data) {
          mailer.sendInBackground(
            invitationMail(cfg, {
              to: data.email,
              businessName: data.organization.name,
              inviterName: data.inviter.user.name || data.inviter.user.email,
              role: data.role,
              url: `${c.accountsUrl}/invite/${encodeURIComponent(data.id)}`,
            }),
          );
        },
      }),
    ],
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (!ctx.request) return; // our own server-side auth.api calls
        if (!BROWSER_PATHS.has(ctx.path)) throw new APIError('NOT_FOUND', { message: 'Not found' });
        if (ctx.path === '/email-otp/send-verification-otp') {
          if (ctx.body?.type !== 'sign-in') throw new APIError('BAD_REQUEST', { message: 'Unsupported code type.' });
          const email = normEmail(ctx.body?.email);
          if (email && !cfg.rateLimitsDisabled) {
            const hit = await hitCounter(counters, `client-otp-send:${email}`, OTP_SENDS_PER_EMAIL.windowMs);
            if (hit.count > OTP_SENDS_PER_EMAIL.max) {
              throw new APIError('TOO_MANY_REQUESTS', { message: 'Too many codes requested. Please wait a few minutes and try again.' });
            }
          }
        }
      }),
    },
  });
}

export type ClientsAuth = ReturnType<typeof createClientsAuth>;
