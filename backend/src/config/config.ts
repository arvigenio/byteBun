// Reads configuration from environment variables and validates it once at startup.
// If anything required is missing or invalid, the process exits with a clear message.
// Nest code gets it by injection (@Inject(APP_CONFIG)); code that runs before Nest starts
// (database startup, logger) imports `config` directly.
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
}

export const APP_CONFIG = Symbol('APP_CONFIG');

/** backend/ (this file is backend/src/config or backend/dist/config). */
export const backendRoot = path.resolve(__dirname, '../..');

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
  };

  if (problems.length) {
    console.error('\nConfiguration error. The API cannot start until these are fixed:\n');
    for (const p of problems) console.error(`  - ${p}`);
    console.error('\nSee .env.example for every variable and its meaning.\n');
    process.exit(1);
  }
  return Object.freeze(config);
}

export const config = loadConfig();
