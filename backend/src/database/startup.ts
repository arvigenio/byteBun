// Startup sequence, run before Nest starts: wait for PostgreSQL, create the app database if
// missing, then apply pending Prisma migrations (prisma/migrations). Safe to run on every start.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { backendRoot, config } from '../config/config';
import { logger } from '../logging/logger';
import { buildDatabaseUrl } from './database-url';
import { createPrismaClient } from './prisma-options';

type Client = ReturnType<typeof createPrismaClient>;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const reason = (err: unknown) => (err instanceof Error ? err.message : String(err));

async function waitForPostgres({ attempts = 20, baseDelayMs = 1_000, maxDelayMs = 10_000 } = {}): Promise<Client> {
  for (let attempt = 1; ; attempt++) {
    // A fresh client per attempt, so a failed connection pool is never reused.
    const admin = createPrismaClient(config.db, 'postgres');
    try {
      await admin.$queryRaw`SELECT 1 AS ok`;
      logger.info({ attempt }, 'PostgreSQL is reachable');
      return admin;
    } catch (err) {
      await admin.$disconnect().catch(() => {});
      if (attempt >= attempts) {
        throw new Error(`PostgreSQL did not become reachable after ${attempts} attempts: ${reason(err)}`);
      }
      const delay = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      logger.warn({ attempt, retryInMs: delay, reason: reason(err) }, 'PostgreSQL not ready yet, retrying');
      await sleep(delay);
    }
  }
}

async function ensureDatabase(admin: Client) {
  const name = config.db.name;
  const rows = await admin.$queryRaw<unknown[]>`SELECT 1 FROM pg_database WHERE datname = ${name}`;
  if (rows.length === 0) {
    // CREATE DATABASE can't take a parameter. The name is safe to quote as an identifier:
    // config.ts only allows letters, numbers, and underscores.
    await admin.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
    logger.info({ database: name }, 'Database created');
  } else {
    logger.info({ database: name }, 'Database exists');
  }
}

function runPrismaMigrateDeploy(): Promise<void> {
  const prismaCli = path.join(path.dirname(require.resolve('prisma/package.json')), 'build/index.js');

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [prismaCli, 'migrate', 'deploy'], {
      cwd: backendRoot,
      env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL || buildDatabaseUrl() },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const forward = (level: 'info' | 'warn') => (chunk: Buffer) => {
      for (const line of chunk.toString().split(/\r?\n/)) if (line.trim()) logger[level]({ prisma: line.trim() });
    };
    child.stdout.on('data', forward('info'));
    child.stderr.on('data', forward('warn'));
    child.on('error', reject);
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`prisma migrate deploy exited with code ${code}`))));
  });
}

export async function prepareDatabase() {
  logger.info({ host: config.db.host, port: config.db.port }, 'Step 1/3: waiting for PostgreSQL');
  const admin = await waitForPostgres();
  try {
    logger.info('Step 2/3: making sure the application database exists');
    await ensureDatabase(admin);
  } finally {
    await admin.$disconnect();
  }
  logger.info('Step 3/3: applying database migrations');
  await runPrismaMigrateDeploy();
  logger.info('Migrations are up to date');
}
