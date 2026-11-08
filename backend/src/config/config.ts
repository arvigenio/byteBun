// Reads configuration from environment variables and validates it once at startup.
// If anything required is missing or invalid, the process exits with a clear message.
// Nest code gets it by injection (@Inject(APP_CONFIG)); code that runs before Nest starts
// (database startup, logger) imports `config` directly.
import fs from 'node:fs';
import path from 'node:path';

export interface DbConfig {
  host: string;
  port: number;
  name: string;
  user: string;
  password: string;
  /** Connect over TLS (needed for most managed PostgreSQL hosts; off for the Compose db). */
  ssl: boolean;
}

export interface AppConfig {
  nodeEnv: string;
  isProd: boolean;
  port: number;
  frontendOrigins: string[];
  /** Number of reverse proxies in front of the app (Express "trust proxy"), so req.ip is the real client IP. */
  trustProxy: number | string | false;
  logLevel: string;
  /** Built frontend (production only). */
  staticDir: string;
  db: DbConfig;
  leadsRateLimit: { max: number; windowMs: number };
  integrations: { n8nWebhookUrl: string };
  auth: AuthConfig;
  mail: MailConfig;
  booking: BookingConfig;
}

export interface AuthConfig {
  /** Signs cookies and encrypts authenticator secrets. Changing it signs everyone out and breaks enrolled authenticators. */
  secret: string;
  /** Public origin the admin site is served from, e.g. https://bytebuntech.com (also the only trusted origin). */
  url: string;
  /** The secret sign-in page, e.g. /bb-portal-7k2q9x. Never linked from anywhere. */
  loginPath: string;
  /** Who receives security alerts. */
  alertEmails: string[];
  /** Optional: security alerts are also POSTed here as JSON (n8n). */
  alertWebhookUrl: string;
}

export interface MailConfig {
  /** Empty in development: emails are written to the log instead of sent. */
  host: string;
  port: number;
  user: string;
  pass: string;
  /** Admin emails (sign-in codes, security alerts, lead notifications). */
  from: string;
  /** Emails to leads (booking confirmation, reminder, changes). */
  leadsFrom: string;
  /** Where leads' replies go (empty = the leadsFrom address). */
  leadsReplyTo: string;
  /**
   * Development/testing only: every email goes here instead of its real recipients (they are
   * shown in the subject). Ignored in production.
   */
  testingAddress: string;
}

export interface BookingConfig {
  /** Public site URL, for the reschedule/cancel links in emails, e.g. https://bytebuntech.com. */
  siteUrl: string;
  /** Optional fixed video-call link (Zoom, Meet, ...) shown in emails and calendar events. */
  meetingUrl: string;
}

export const APP_CONFIG = Symbol('APP_CONFIG');

/** backend/ (this file is backend/src/config or backend/dist/config). */
// The nearest folder above this file with a package.json: backend/ from dist/config (app) and
// from dist-test/src/config (tests).
export const backendRoot = (() => {
  for (let dir = __dirname; ; dir = path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    if (path.dirname(dir) === dir) return path.resolve(__dirname, '../..');
  }
})();

function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const problems: string[] = [];

  const required = (name: string): string => {
    const value = env[name]?.trim();
    if (!value) problems.push(`${name} is required but not set.`);
    return value ?? '';
  };

  const int = (name: string, fallback: number, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}): number => {
    const raw = env[name]?.trim();
    if (!raw) return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < min || value > max) {
      problems.push(`${name} must be a whole number between ${min} and ${max} (got "${raw}").`);
      return fallback;
    }
    return value;
  };

  const bool = (name: string, fallback: boolean): boolean => {
    const raw = env[name]?.trim().toLowerCase();
    if (!raw) return fallback;
    return ['1', 'true', 'yes', 'on'].includes(raw);
  };

  const nodeEnv = env.NODE_ENV?.trim() || 'development';
  const isProd = nodeEnv === 'production';

  const dbName = required('DB_NAME');
  // The database name is used as an identifier when creating the database, so restrict it.
  if (dbName && !/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(dbName)) {
    problems.push('DB_NAME may only contain letters, numbers, and underscores (at most 63), and must not start with a number.');
  }

  const frontendOrigins = required('FRONTEND_ORIGIN')
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean);

  const n8nWebhookUrl = env.N8N_WEBHOOK_URL?.trim() || '';
  if (n8nWebhookUrl && !/^https?:\/\//i.test(n8nWebhookUrl)) {
    problems.push('N8N_WEBHOOK_URL must start with http:// or https:// (or be left empty).');
  }

  const trustProxyRaw = env.TRUST_PROXY?.trim();

  // ---- Admin sign-in ----
  // Development and tests get working defaults; production must set real values.
  const devDefault = (name: string, fallback: string) => (isProd ? required(name) : env[name]?.trim() || fallback);

  const authSecret = devDefault('BETTER_AUTH_SECRET', 'dev-only-secret-do-not-use-in-production-0123456789');
  if (authSecret && authSecret.length < 32) problems.push('BETTER_AUTH_SECRET must be at least 32 characters (generate one with: openssl rand -base64 32).');

  const authUrl = devDefault('BETTER_AUTH_URL', frontendOrigins[0] || 'http://localhost:5173').replace(/\/$/, '');
  if (authUrl && !/^https?:\/\/[^/]+$/i.test(authUrl)) problems.push('BETTER_AUTH_URL must be an origin like https://bytebuntech.com (no path).');
  if (isProd && authUrl && !authUrl.startsWith('https://')) problems.push('BETTER_AUTH_URL must use https:// in production.');

  const loginPath = devDefault('LOGIN_PATH', '/bb-admin-portal').replace(/\/$/, '');
  if (loginPath && !isValidLoginPath(loginPath)) {
    problems.push('LOGIN_PATH must look like /bb-portal-7k2q9x: one segment of 8-64 letters, numbers, - or _, and not a common path such as /login or /admin.');
  }

  const alertEmails = (env.ALERT_EMAILS ?? (isProd ? '' : 'josue.mapagdalita@bytebuntech.com,arvi.genio@bytebuntech.com'))
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (isProd && !alertEmails.length) problems.push('ALERT_EMAILS is required (comma-separated addresses that receive security alerts).');
  for (const e of alertEmails) if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) problems.push(`ALERT_EMAILS contains an invalid address: "${e}".`);

  const alertWebhookUrl = env.SECURITY_ALERT_WEBHOOK_URL?.trim() || '';
  if (alertWebhookUrl && !/^https?:\/\//i.test(alertWebhookUrl)) problems.push('SECURITY_ALERT_WEBHOOK_URL must start with http:// or https:// (or be left empty).');

  // SMTP is required in production. In development it's optional (emails go to the log).
  const smtpHost = isProd ? required('SMTP_HOST') : env.SMTP_HOST?.trim() || '';

  const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  let testingAddress = env.TESTING_EMAIL_ADDRESS?.trim().toLowerCase() || '';
  if (testingAddress && !isEmail(testingAddress)) problems.push(`TESTING_EMAIL_ADDRESS is not a valid email address: "${testingAddress}".`);
  if (testingAddress && isProd) {
    console.warn('TESTING_EMAIL_ADDRESS is ignored in production: emails go to their real recipients.');
    testingAddress = '';
  }
  const leadsReplyTo = env.LEADS_REPLY_TO?.trim() || '';
  if (leadsReplyTo && !isEmail(leadsReplyTo.replace(/^.*<([^>]+)>\s*$/, '$1'))) problems.push('LEADS_REPLY_TO must be an email address (or left empty).');

  const siteUrl = (env.SITE_URL?.trim() || (isProd ? 'https://bytebuntech.com' : frontendOrigins[0] || 'http://localhost:5173')).replace(/\/+$/, '');
  if (!/^https?:\/\/[^/]+$/i.test(siteUrl)) problems.push('SITE_URL must be an origin like https://bytebuntech.com (no path).');
  const meetingUrl = env.CALL_MEETING_URL?.trim() || '';
  if (meetingUrl && !/^https:\/\//i.test(meetingUrl)) problems.push('CALL_MEETING_URL must start with https:// (or be left empty).');

  const config: AppConfig = {
    nodeEnv,
    isProd,
    port: int('API_PORT', 4000, { min: 1, max: 65535 }),
    frontendOrigins,
    trustProxy: trustProxyRaw ? (/^\d+$/.test(trustProxyRaw) ? Number(trustProxyRaw) : trustProxyRaw) : isProd ? 1 : false,
    logLevel: env.LOG_LEVEL?.trim() || 'info',
    staticDir: path.resolve(env.STATIC_DIR?.trim() || path.join(backendRoot, '../frontend/dist')),
    db: {
      host: required('DB_HOST'),
      port: int('DB_PORT', 5432, { min: 1, max: 65535 }),
      name: dbName,
      user: required('DB_USER'),
      password: required('DB_PASSWORD'),
      ssl: bool('DB_SSL', false),
    },
    leadsRateLimit: {
      max: int('LEADS_RATE_LIMIT_MAX', 5, { min: 1 }),
      windowMs: int('LEADS_RATE_LIMIT_WINDOW_MINUTES', 15, { min: 1 }) * 60_000,
    },
    integrations: { n8nWebhookUrl },
    auth: { secret: authSecret, url: authUrl, loginPath, alertEmails, alertWebhookUrl },
    mail: {
      host: smtpHost,
      port: int('SMTP_PORT', 587, { min: 1, max: 65535 }),
      user: smtpHost ? required('SMTP_USER') : '',
      pass: smtpHost ? required('SMTP_PASS') : '',
      from: env.MAIL_FROM?.trim() || 'Byte Bun Admin <admin@bytebuntech.com>',
      leadsFrom: env.LEADS_MAIL_FROM?.trim() || 'Byte Bun Tech <admin@bytebuntech.com>',
      leadsReplyTo,
      testingAddress,
    },
    booking: { siteUrl, meetingUrl },
  };

  if (problems.length) {
    console.error('\nConfiguration error. The API cannot start until these are fixed:\n');
    for (const p of problems) console.error(`  - ${p}`);
    console.error('\nSee .env.example for every variable and its meaning.\n');
    process.exit(1);
  }
  return Object.freeze(config);
}

// Paths scanners try first. They always answer a plain 404 (web/static-site.ts), and the secret
// login path may not be one of them.
export const COMMON_LOGIN_PATHS = [
  '/login', '/log-in', '/signin', '/sign-in', '/logon', '/auth', '/admin', '/administrator', '/dashboard',
  '/portal', '/wp-admin', '/wp-login.php', '/user', '/users', '/account', '/panel', '/cpanel', '/backend', '/manage', '/console',
];

export function isValidLoginPath(p: string): boolean {
  if (!/^\/[A-Za-z0-9_-]{8,64}$/.test(p)) return false;
  const lower = p.toLowerCase();
  if (COMMON_LOGIN_PATHS.includes(lower)) return false;
  return !['/api', '/assets', '/get-started', '/admin'].some((reserved) => lower.startsWith(reserved));
}

export const config = loadConfig();
