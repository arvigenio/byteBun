import './env';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import path from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createApp } from '../src/app';
import { outbox, type SentMail } from '../src/auth/mailer';
import { config } from '../src/config/config';
import { createPrismaClient } from '../src/database/prisma-options';
import { prepareDatabase } from '../src/database/startup';

export const ORIGIN = config.auth.url;
export const LOGIN_PATH = config.auth.loginPath;
export const JOSUE = 'josue.mapagdalita@bytebuntech.com';
export const ARVI = 'arvi.genio@bytebuntech.com';
export const SENDER = 'Byte Bun Admin <admin@bytebuntech.com>';
// A real browser's user agent (it appears in alert emails).
export const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export interface TestApp {
  app: NestExpressApplication;
  server: any;
  prisma: PrismaClient;
  close(): Promise<void>;
}

const backendRoot = path.resolve(__dirname, '../..');
const distRoot = path.resolve(__dirname, '..'); // dist-test

/** Runs one of the real CLI scripts (compiled) against the test database. */
export function runScript(name: 'seed-admins' | 'reset-2fa', ...args: string[]) {
  const r = spawnSync(process.execPath, [path.join(distRoot, 'src/scripts', `${name}.js`), ...args], {
    cwd: backendRoot,
    env: process.env,
    encoding: 'utf8',
    timeout: 120_000,
  });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

export async function startApp(): Promise<TestApp> {
  await prepareDatabase(); // create + migrate the test database
  const seed = runScript('seed-admins');
  if (seed.code !== 0) throw new Error(`seed failed: ${seed.stderr}\n${seed.stdout}`);
  const app = await createApp({ serveStatic: true });
  await app.init();
  const prisma = createPrismaClient(config.db) as unknown as PrismaClient;
  return {
    app,
    server: app.getHttpServer(),
    prisma,
    async close() {
      await settle();
      await prisma.$disconnect();
      await app.close();
    },
  };
}

/** Back to a clean slate: admins exist, nobody enrolled or signed in, no limits used, no mail. */
export async function resetState(prisma: PrismaClient) {
  await settle();
  await prisma.$executeRawUnsafe(
    'TRUNCATE auth_sessions, auth_verifications, auth_rate_limits, security_counters, auth_two_factors, auth_accounts, bookings, leads RESTART IDENTITY CASCADE',
  );
  await prisma.$executeRawUnsafe(`DELETE FROM auth_users WHERE email NOT IN ('${JOSUE}', '${ARVI}')`);
  await prisma.user.updateMany({ data: { twoFactorEnabled: false, banned: false, role: 'admin' } });
  outbox.length = 0;
}

export const clearRateLimits = (prisma: PrismaClient) => prisma.$executeRawUnsafe('TRUNCATE auth_rate_limits, security_counters');

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Lets fire-and-forget work (emails, alerts) finish. */
export const settle = (ms = 400) => sleep(ms);

export async function waitForMail(match: (m: SentMail) => boolean, timeoutMs = 4000): Promise<SentMail> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const found = outbox.find(match);
    if (found) return found;
    if (Date.now() > end) throw new Error(`No matching email. Outbox subjects: ${JSON.stringify(outbox.map((m) => m.subject))}`);
    await sleep(50);
  }
}

const recipients = (m: SentMail) => (Array.isArray(m.to) ? m.to : [m.to]);
export const mailsTo = (email: string) => outbox.filter((m) => recipients(m).includes(email));
// Alert subjects: "[Byte Bun Security] <title>: <admin name or address>"
export const alertMails = (title: string) => outbox.filter((m) => m.subject.startsWith(`[Byte Bun Security] ${title}: `));
export const codeMailsTo = (email: string) => mailsTo(email).filter((m) => m.subject.startsWith('Your Byte Bun Admin sign-in code'));
export const waitForAlert = (title: string, extra: (m: SentMail) => boolean = () => true) =>
  waitForMail((m) => m.subject.startsWith(`[Byte Bun Security] ${title}: `) && extra(m));

export function latestCode(email: string): string {
  const mails = codeMailsTo(email);
  const last = mails[mails.length - 1];
  if (!last) throw new Error(`No sign-in code email for ${email}`);
  return last.subject.match(/(\d{6})$/)![1];
}

/** A browser: keeps cookies, sends the Origin header like a real one. */
export function browser(server: any) {
  const agent = request.agent(server);
  const withOrigin = (t: request.Test) => t.set('Origin', ORIGIN).set('User-Agent', BROWSER_UA);
  return {
    agent,
    get: (url: string) => withOrigin(agent.get(url)),
    post: (url: string, body?: object) => withOrigin(agent.post(url)).send(body ?? {}),
    patch: (url: string, body?: object) => withOrigin(agent.patch(url)).send(body ?? {}),
    delete: (url: string) => withOrigin(agent.delete(url)),
  };
}
export type Browser = ReturnType<typeof browser>;

// ---- An authenticator app: RFC 6238 TOTP (SHA-1, 6 digits, 30 s), independent of Better Auth ----
function base32Decode(input: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of input.replace(/=+$/, '').toUpperCase()) {
    const idx = alphabet.indexOf(ch);
    if (idx < 0) throw new Error('bad base32');
    value = ((value << 5) | idx) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function totp(secretBase32: string, offsetSteps = 0, now = Date.now()): string {
  const counter = Math.floor(now / 1000 / 30) + offsetSteps;
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', base32Decode(secretBase32)).update(buf).digest();
  const o = h[h.length - 1] & 0xf;
  return ((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).toString().padStart(6, '0');
}

/** A 6-digit code that is NOT accepted right now (outside the -1..+1 windows, with margin). */
export function wrongTotp(secret: string): string {
  const valid = new Set([-2, -1, 0, 1, 2].map((o) => totp(secret, o)));
  for (let i = 0; ; i++) {
    const c = String((123456 + i * 7919) % 1_000_000).padStart(6, '0');
    if (!valid.has(c)) return c;
  }
}

export const secretFromUri = (uri: string) => new URL(uri).searchParams.get('secret')!;

// ---- Sign-in steps ----
export const requestCode = (b: Browser, email: string) => b.post('/api/auth/email-otp/send-verification-otp', { email, type: 'sign-in' });

export async function emailStep(b: Browser, email: string) {
  const before = codeMailsTo(email).length;
  const sent = await requestCode(b, email);
  if (sent.status !== 200) throw new Error(`send code: ${sent.status} ${JSON.stringify(sent.body)}`);
  const end = Date.now() + 4000;
  while (codeMailsTo(email).length <= before) {
    if (Date.now() > end) throw new Error(`no code email for ${email}`);
    await sleep(25);
  }
  return b.post('/api/auth/sign-in/email-otp', { email, otp: latestCode(email) });
}

/** First sign-in for an admin: email code -> QR setup -> first code. Returns the authenticator secret. */
export async function enroll(b: Browser, email: string) {
  const step1 = await emailStep(b, email);
  if (step1.body?.next !== 'setup') throw new Error(`expected setup, got ${step1.status} ${JSON.stringify(step1.body)}`);
  const enable = await b.post('/api/auth/two-factor/enable', {});
  if (enable.status !== 200) throw new Error(`enable: ${enable.status} ${JSON.stringify(enable.body)}`);
  const secret = secretFromUri(enable.body.totpURI);
  const verify = await b.post('/api/auth/two-factor/verify-totp', { code: totp(secret) });
  if (verify.status !== 200) throw new Error(`verify: ${verify.status} ${JSON.stringify(verify.body)}`);
  return { secret, backupCodes: enable.body.backupCodes as string[], enable, verify };
}

/** A later sign-in for an enrolled admin. */
export async function signIn(b: Browser, email: string, secret: string) {
  const step1 = await emailStep(b, email);
  if (step1.body?.next !== 'authenticator') throw new Error(`expected authenticator, got ${step1.status} ${JSON.stringify(step1.body)}`);
  const res = await b.post('/api/auth/two-factor/verify-totp', { code: totp(secret) });
  if (res.status !== 200) throw new Error(`verify: ${res.status} ${JSON.stringify(res.body)}`);
  return res;
}

export function setCookies(res: request.Response): string[] {
  return (res.headers['set-cookie'] as unknown as string[] | undefined) ?? [];
}
