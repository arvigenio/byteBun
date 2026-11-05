// Reads configuration from environment variables and validates it once at startup.
// If anything required is missing or invalid, the process exits with a clear message.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const env = process.env;
const problems = [];

function required(name) {
  const value = env[name]?.trim();
  if (!value) problems.push(`${name} is required but not set.`);
  return value ?? '';
}

function int(name, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    problems.push(`${name} must be a whole number between ${min} and ${max} (got "${raw}").`);
    return fallback;
  }
  return value;
}

function bool(name, fallback) {
  const raw = env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw);
}

const nodeEnv = env.NODE_ENV?.trim() || 'development';
const isProd = nodeEnv === 'production';

const dbName = required('DB_NAME');
// The database name is used as an identifier when creating the database, so restrict it.
if (dbName && !/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(dbName)) {
  problems.push('DB_NAME may only contain letters, numbers, and underscores, and must not start with a number.');
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

export const config = Object.freeze({
  nodeEnv,
  isProd,
  port: int('API_PORT', 4000, { min: 1, max: 65535 }),
  frontendOrigins,
  // Number of reverse proxies in front of the app, so req.ip is the real client IP.
  trustProxy: trustProxyRaw ? (/^\d+$/.test(trustProxyRaw) ? Number(trustProxyRaw) : trustProxyRaw) : isProd ? 1 : false,
  logLevel: env.LOG_LEVEL?.trim() || 'info',
  staticDir: path.resolve(env.STATIC_DIR?.trim() || path.join(here, '../../frontend/dist')),
  db: {
    host: required('DB_HOST'),
    port: int('DB_PORT', 1433, { min: 1, max: 65535 }),
    name: dbName,
    user: required('DB_USER'),
    password: required('DB_PASSWORD'),
    trustServerCertificate: bool('DB_TRUST_SERVER_CERT', true),
  },
  leadsRateLimit: {
    max: int('LEADS_RATE_LIMIT_MAX', 5, { min: 1 }),
    windowMs: int('LEADS_RATE_LIMIT_WINDOW_MINUTES', 15, { min: 1 }) * 60_000,
  },
  integrations: {
    n8nWebhookUrl,
  },
});

if (problems.length) {
  console.error('\nConfiguration error. The API cannot start until these are fixed:\n');
  for (const p of problems) console.error(`  - ${p}`);
  console.error('\nSee .env.example for every variable and its meaning.\n');
  process.exit(1);
}
