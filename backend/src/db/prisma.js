import { PrismaClient } from '@prisma/client';
import { PrismaMssql } from '@prisma/adapter-mssql';
import { config } from '../config.js';

// Prisma 7 talks to SQL Server through a driver adapter (built on the mssql package).
// All Prisma queries, including $queryRaw tagged templates, are parameterized.
export function createPrismaClient(database = config.db.name) {
  const adapter = new PrismaMssql({
    server: config.db.host,
    port: config.db.port,
    database,
    user: config.db.user,
    password: config.db.password,
    connectionTimeout: 5_000,
    requestTimeout: 15_000,
    pool: { max: 10, min: 0, idleTimeoutMillis: 30_000 },
    options: {
      encrypt: true,
      trustServerCertificate: config.db.trustServerCertificate,
    },
  });
  return new PrismaClient({ adapter, log: [{ level: 'warn', emit: 'event' }, { level: 'error', emit: 'event' }] });
}

// The application client, connected to the app database. Created lazily after startup checks.
let client;

export function getPrisma() {
  if (!client) client = createPrismaClient();
  return client;
}

export async function disconnectPrisma() {
  if (client) await client.$disconnect();
  client = undefined;
}

export async function isDatabaseReachable() {
  try {
    await getPrisma().$queryRaw`SELECT 1 AS ok`;
    return true;
  } catch {
    return false;
  }
}
