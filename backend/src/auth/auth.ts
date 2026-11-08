// Admin sign-in with Better Auth. Passwordless, two steps, no sign-up:
//
//   1. POST /api/auth/email-otp/send-verification-otp  { email, type: "sign-in" }
//      Admins get a 6-digit code by email. Unknown emails get the same answer and nothing is sent.
//   2. POST /api/auth/sign-in/email-otp  { email, otp }
//      A correct code does NOT sign you in:
//       - authenticator already set up -> no session; a short-lived signed "two_factor" cookie
//         that only the authenticator/backup-code check accepts. Answer: { next: "authenticator" }
//       - first sign-in (or after a CLI reset) -> a setup-only session. Answer: { next: "setup" }
//   3a. POST /api/auth/two-factor/verify-totp         { code }  (authenticator app)
//   3b. POST /api/auth/two-factor/verify-backup-code  { code }  (lost phone; each code works once)
//      First sign-in: POST /api/auth/two-factor/enable {} returns the QR (totpURI) and backup
//      codes, then verify-totp confirms the first code.
//      Success creates a NEW session (the old one is deleted) marked secondFactorVerified.
//
// Why the second step can't be skipped:
//  - The two-factor plugin only challenges password sign-ins (/sign-in/email etc.), not Email OTP
//    (checked in better-auth 1.7.18's source). So the after hook below does the same thing for
//    /sign-in/email-otp: it deletes the session the email code created and issues the plugin's own
//    second-step cookie instead. The plugin's verify endpoints then create the real session.
//  - session.secondFactorVerified is set when a session row is CREATED, and only to true when the
//    creating request is /two-factor/verify-totp or /two-factor/verify-backup-code (those create a
//    session only after a correct code). Clients can't set it (input: false), and nothing updates it.
//  - Every admin route checks it (admin-session.guard.ts), plus role, twoFactorEnabled and banned.
//  - From the browser, only the handful of Better Auth endpoints the sign-in flow needs are
//    reachable; everything else (admin plugin API, password, impersonation, ...) answers 404.
import type { PrismaClient } from '@prisma/client';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { APIError, createAuthMiddleware, isAPIError } from 'better-auth/api';
import { deleteSessionCookie } from 'better-auth/cookies';
import { generateRandomString } from 'better-auth/crypto';
import { admin, emailOTP, twoFactor } from 'better-auth/plugins';
import type { AppConfig } from '../config/config';
import { logger } from '../logging/logger';
import { renderEmail } from './email-template';
import type { Mail, Mailer } from './mailer';
import { CLIENT_IP_HEADER, readRequestMeta, type RequestMeta } from './request-meta';
import { formatTime, type AlertEvent, type SecurityAlerts } from './security-alerts';
import { hitCounter } from './security-counter';

export const AUTH_BASE_PATH = '/api/auth';

const OTP_LENGTH = 6;
const OTP_EXPIRES_SECONDS = 5 * 60;
const OTP_ALLOWED_ATTEMPTS = 3;
/** Codes sent per email address (on top of Better Auth's per-IP limit). */
const OTP_SENDS_PER_EMAIL = { max: 3, windowMs: 10 * 60_000 };
/** How long the second step stays open after a correct email code. */
const SECOND_STEP_SECONDS = 10 * 60;
const TWO_FACTOR_COOKIE = 'two_factor'; // the plugin's cookie name (two-factor/constant.mjs)

// The only Better Auth endpoints the browser may call. Our own server code calls others through
// auth.api (e.g. the Security page), which has no HTTP request and isn't affected.
const BROWSER_PATHS = new Set([
  '/email-otp/send-verification-otp',
  '/sign-in/email-otp',
  '/two-factor/enable',
  '/two-factor/verify-totp',
  '/two-factor/verify-backup-code',
  '/get-session',
  '/sign-out',
]);

// Only sessions created by these endpoints count as fully signed in.
const SECOND_FACTOR_PATHS = new Set(['/two-factor/verify-totp', '/two-factor/verify-backup-code']);

export interface AuthDeps {
  cfg: AppConfig;
  prisma: PrismaClient;
  mailer: Mailer;
  alerts: SecurityAlerts;
}

/** Who a second-step request is for, read before the endpoint runs (it may consume the cookie). */
interface SecondStepUser {
  userId: string;
  email: string;
  enrolled: boolean;
  /** null: the request has the second-step cookie, not a session. */
  sessionVerified: boolean | null;
}

const normEmail = (v: unknown) => (typeof v === 'string' ? v.trim().toLowerCase().slice(0, 254) : '');

export function signInCodeMail(to: string, otp: string, meta: RequestMeta, when = new Date()): Mail {
  const minutes = OTP_EXPIRES_SECONDS / 60;
  const { html, text } = renderEmail({
    preheader: `Your code is ${otp}. It expires in ${minutes} minutes.`,
    label: 'Sign-in code',
    tone: 'info',
    title: 'Your sign-in code',
    intro: ['Enter this code on the sign-in page to continue. You will then be asked for the code from your authenticator app.'],
    code: otp,
    codeNote: `This code expires in ${minutes} minutes and works once.`,
    details: [
      ['Requested', formatTime(when)],
      ['IP', meta.ip],
      ['Location', meta.location],
      ['Browser', meta.userAgent],
    ],
    callout: {
      tone: 'warning',
      title: "Didn't request this?",
      text: "If this wasn't you, someone knows your email — they still can't get in without your authenticator, but tell the other admin.",
    },
    footer: 'Sent to Byte Bun administrators only. Never share this code; Byte Bun will never ask you for it.',
  });
  return { to, subject: `Your Byte Bun Admin sign-in code: ${otp}`, text, html };
}

export function createAuth({ cfg, prisma, mailer, alerts }: AuthDeps) {
  const secondStepUsers = new WeakMap<Request, SecondStepUser | null>();

  const alert = (event: AlertEvent, email: string, meta: RequestMeta) => alerts.notify(event, { email, ...meta });

  return betterAuth({
    appName: 'Byte Bun Admin',
    baseURL: cfg.auth.url,
    basePath: AUTH_BASE_PATH,
    secret: cfg.auth.secret,
    trustedOrigins: [cfg.auth.url],
    database: prismaAdapter(prisma, { provider: 'postgresql' }),
    telemetry: { enabled: false },
    logger: {
      level: 'warn',
      log: (level, message) => (level === 'error' ? logger.error({ source: 'better-auth' }, message) : logger.warn({ source: 'better-auth' }, message)),
    },

    // No passwords anywhere: no password sign-in, sign-up, reset or change.
    emailAndPassword: { enabled: false },

    session: {
      expiresIn: 12 * 60 * 60, // 12 hours
      updateAge: 60 * 60, // refreshed at most hourly while in use
      additionalFields: {
        secondFactorVerified: { type: 'boolean', required: false, defaultValue: false, input: false },
      },
    },

    rateLimit: {
      enabled: true, // also in development and tests, so the limits are exercised
      storage: 'database',
      window: 60,
      max: 100,
      customRules: {
        '/email-otp/send-verification-otp': { window: 10 * 60, max: 3 },
        '/sign-in/email-otp': { window: 5 * 60, max: 5 },
        '/two-factor/verify-totp': { window: 5 * 60, max: 5 },
        '/two-factor/verify-backup-code': { window: 5 * 60, max: 5 },
        '/two-factor/enable': { window: 5 * 60, max: 5 },
      },
    },

    advanced: {
      cookiePrefix: 'bb-admin',
      useSecureCookies: cfg.isProd,
      defaultCookieAttributes: { httpOnly: true, sameSite: 'strict', secure: cfg.isProd },
      // Set by request-meta.ts from the verified client IP (never from a raw client header).
      ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
    },

    databaseHooks: {
      user: {
        // Accounts only come from `npm run seed:admins` (server-side). Never from a request.
        create: { before: async (_user, ctx) => (ctx?.request ? false : undefined) },
      },
      session: {
        create: {
          before: async (session, ctx) => ({
            data: { ...session, secondFactorVerified: !!ctx?.request && SECOND_FACTOR_PATHS.has(ctx.path) },
          }),
        },
        update: {
          // Nothing may flip the flag on an existing session.
          before: async (data) => {
            if (!('secondFactorVerified' in data)) return;
            const { secondFactorVerified: _ignored, ...rest } = data as Record<string, unknown>;
            return { data: rest };
          },
        },
      },
    },

    plugins: [
      emailOTP({
        otpLength: OTP_LENGTH,
        expiresIn: OTP_EXPIRES_SECONDS,
        allowedAttempts: OTP_ALLOWED_ATTEMPTS,
        disableSignUp: true, // unknown emails never get a code or an account
        storeOTP: 'hashed',
        // Called only for existing users. Returns at once (sending happens in the background), so
        // known and unknown emails take the same time to answer.
        async sendVerificationOTP({ email, otp, type }, ctx) {
          if (type !== 'sign-in') return;
          const meta = readRequestMeta(ctx?.request?.headers ?? ctx?.headers);
          void (async () => {
            const user = await prisma.user.findUnique({ where: { email }, select: { role: true, banned: true } });
            if (user?.role !== 'admin' || user.banned) return;
            await mailer.send(signInCodeMail(email, otp, meta));
          })().catch((err: unknown) => logger.error({ reason: err instanceof Error ? err.message : String(err) }, 'Sign-in code email failed'));
        },
      }),
      twoFactor({
        issuer: 'Byte Bun Admin',
        allowPasswordless: true, // there are no passwords; TOTP is managed with the session instead
        twoFactorCookieMaxAge: SECOND_STEP_SECONDS,
        backupCodeOptions: { amount: 10, length: 10 },
      }),
      admin({ defaultRole: 'user', adminRoles: ['admin'] }),
    ],

    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (!ctx.request) return; // our own server-side auth.api calls

        if (!BROWSER_PATHS.has(ctx.path)) throw new APIError('NOT_FOUND', { message: 'Not found' });

        if (ctx.path === '/email-otp/send-verification-otp') {
          if (ctx.body?.type !== 'sign-in') throw new APIError('BAD_REQUEST', { message: 'Unsupported code type.' });
          const email = normEmail(ctx.body?.email);
          // Counted for every address alike, so this limit doesn't reveal which emails exist.
          if (email) {
            const hit = await hitCounter(prisma, `otp-send:${email}`, OTP_SENDS_PER_EMAIL.windowMs);
            if (hit.count > OTP_SENDS_PER_EMAIL.max) {
              throw new APIError('TOO_MANY_REQUESTS', { message: 'Too many codes requested. Please wait a few minutes and try again.' });
            }
          }
          return;
        }

        if (ctx.path === '/two-factor/enable') {
          const who = await secondStepUser(ctx);
          // Setup is only for a setup-only session of an admin with no authenticator yet.
          if (!who || who.sessionVerified === null || who.enrolled) {
            throw new APIError('FORBIDDEN', { message: 'Authenticator setup is not available.' });
          }
          return { context: { body: { ...(ctx.body ?? {}), method: 'totp', password: undefined, issuer: undefined } } };
        }

        if (SECOND_FACTOR_PATHS.has(ctx.path)) {
          secondStepUsers.set(ctx.request, await secondStepUser(ctx));
          // Remember-this-device is not offered: every sign-in needs the authenticator.
          return { context: { body: { ...(ctx.body ?? {}), trustDevice: false, disableSession: false } } };
        }
      }),

      after: createAuthMiddleware(async (ctx) => {
        if (!ctx.request) return;
        const returned = ctx.context.returned;
        const error = isAPIError(returned) ? returned : null;
        const code = (error?.body as { code?: string } | undefined)?.code;
        const meta = readRequestMeta(ctx.request.headers);

        switch (ctx.path) {
          case '/email-otp/send-verification-otp': {
            if (error) return;
            const email = normEmail(ctx.body?.email);
            void prisma.user
              .findUnique({ where: { email }, select: { role: true } })
              .then((u) => alert(u?.role === 'admin' ? 'code_requested' : 'unknown_email', email, meta))
              .catch(() => {});
            return;
          }

          case '/sign-in/email-otp': {
            const email = normEmail(ctx.body?.email);
            if (error) {
              if (code === 'TOO_MANY_ATTEMPTS') alert('email_code_locked', email, meta);
              else if (code === 'INVALID_OTP' || code === 'OTP_EXPIRED') alert('wrong_email_code', email, meta);
              return;
            }
            const created = ctx.context.newSession;
            if (!created) return;
            alert('email_code_ok', created.user.email, meta);

            if (!created.user.twoFactorEnabled) {
              // First sign-in: keep the session, but it can only set up the authenticator.
              return ctx.json({ next: 'setup' });
            }

            // Authenticator already set up: replace the session with the plugin's second-step
            // challenge, exactly as the plugin does for password sign-ins.
            deleteSessionCookie(ctx, true);
            await ctx.context.internalAdapter.deleteSession(created.session.token);
            ctx.context.setNewSession(null);
            const cookie = ctx.context.createAuthCookie(TWO_FACTOR_COOKIE, { maxAge: SECOND_STEP_SECONDS });
            const identifier = `2fa-${generateRandomString(20)}`;
            const expiresAt = new Date(Date.now() + SECOND_STEP_SECONDS * 1000);
            await ctx.context.internalAdapter.createVerificationValue({ value: created.user.id, identifier, expiresAt });
            await ctx.context.internalAdapter.createVerificationValue({ value: '0', identifier: `2fa-attempts-${identifier}`, expiresAt });
            await ctx.setSignedCookie(cookie.name, identifier, ctx.context.secret, cookie.attributes);
            return ctx.json({ next: 'authenticator' });
          }

          case '/two-factor/verify-totp':
          case '/two-factor/verify-backup-code': {
            const who = secondStepUsers.get(ctx.request) ?? null;
            const email = who?.email ?? 'unknown';
            const isBackup = ctx.path === '/two-factor/verify-backup-code';
            if (error) {
              if (code === 'INVALID_CODE' || code === 'INVALID_BACKUP_CODE') alert(isBackup ? 'wrong_backup_code' : 'wrong_authenticator_code', email, meta);
              else if (code === 'TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE' || code === 'ACCOUNT_TEMPORARILY_LOCKED') alert('second_step_locked', email, meta);
              return;
            }
            // No new session = a code check that signs nobody in (nothing changes).
            if (!ctx.context.newSession) return ctx.json({ ok: true, signedIn: false });
            if (isBackup) alert('backup_code_used', email, meta);
            else if (who && !who.enrolled) alert('authenticator_enrolled', email, meta);
            alert('signed_in', email, meta);
            return ctx.json({ ok: true, signedIn: true });
          }
        }
      }),
    },
  });

  // The user a second-step request is about: from the session if there is one, else from the
  // plugin's second-step cookie (same order as the plugin's verifyTwoFactor).
  async function secondStepUser(ctx: {
    context: any;
    getSignedCookie: (name: string, secret: string) => Promise<string | null | false>;
  }): Promise<SecondStepUser | null> {
    const ia = ctx.context.internalAdapter;
    const token = await ctx.getSignedCookie(ctx.context.authCookies.sessionToken.name, ctx.context.secret);
    if (token) {
      const found = await ia.findSession(token);
      if (found && new Date(found.session.expiresAt) > new Date()) {
        return {
          userId: found.user.id,
          email: found.user.email,
          enrolled: !!found.user.twoFactorEnabled,
          sessionVerified: !!found.session.secondFactorVerified,
        };
      }
    }
    const cookie = ctx.context.createAuthCookie(TWO_FACTOR_COOKIE);
    const identifier = await ctx.getSignedCookie(cookie.name, ctx.context.secret);
    if (!identifier) return null;
    const pending = await ia.findVerificationValue(identifier);
    if (!pending) return null;
    const user = await ia.findUserById(pending.value);
    return user ? { userId: user.id, email: user.email, enrolled: !!user.twoFactorEnabled, sessionVerified: null } : null;
  }
}

export type Auth = ReturnType<typeof createAuth>;
