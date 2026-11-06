// Startup sequence, run before Nest starts: wait for SQL Server, create the app database if
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

async function waitForSqlServer({ attempts = 20, baseDelayMs = 1_000, maxDelayMs = 10_000 } = {}): Promise<Client> {
  for (let attempt = 1; ; attempt++) {
    // A fresh client per attempt, so a failed connection pool is never reused.
    const master = createPrismaClient(config.db, 'master');
    try {
      await master.$queryRaw`SELECT 1 AS ok`;
      logger.info({ attempt }, 'SQL Server is reachable');
      return master;
    } catch (err) {
      await master.$disconnect().catch(() => {});
      if (attempt >= attempts) {
        throw new Error(`SQL Server did not become reachable after ${attempts} attempts: ${reason(err)}`);
      }
      const delay = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      logger.warn({ attempt, retryInMs: delay, reason: reason(err) }, 'SQL Server not ready yet, retrying');
      await sleep(delay);
    }
  }
}

async function ensureDatabase(master: Client) {
  const name = config.db.name;
  // The name is passed as a parameter; QUOTENAME makes it a safe identifier inside dynamic SQL.
  await master.$executeRaw`
    IF DB_ID(${name}) IS NULL
    BEGIN
      DECLARE @sql nvarchar(max) = N'CREATE DATABASE ' + QUOTENAME(${name});
      EXEC (@sql);
    END`;
  logger.info({ database: name }, 'Database exists');
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
  logger.info({ host: config.db.host, port: config.db.port }, 'Step 1/3: waiting for SQL Server');
  const master = await waitForSqlServer();
  try {
    logger.info('Step 2/3: making sure the application database exists');
    await ensureDatabase(master);
  } finally {
    await master.$disconnect();
  }
  logger.info('Step 3/3: applying database migrations');
  await runPrismaMigrateDeploy();
  logger.info('Migrations are up to date');
}
