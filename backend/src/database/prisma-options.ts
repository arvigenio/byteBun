import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, type Prisma } from '@prisma/client';
import type { DbConfig } from '../config/config';

// Prisma 7 talks to PostgreSQL through a driver adapter (built on the pg package).
// All Prisma queries, including $queryRaw tagged templates, are parameterized.
export function prismaOptions(db: DbConfig, database = db.name) {
  const adapter = new PrismaPg({
    host: db.host,
    port: db.port,
    database,
    user: db.user,
    password: db.password,
    ssl: db.ssl,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 15_000,
    max: 10,
    idleTimeoutMillis: 30_000,
  });
  return {
    adapter,
    log: [
      { level: 'warn', emit: 'event' },
      { level: 'error', emit: 'event' },
    ],
  } satisfies Prisma.PrismaClientOptions;
}

// A standalone client, e.g. for the `postgres` maintenance database during startup (outside Nest).
export const createPrismaClient = (db: DbConfig, database?: string) => new PrismaClient(prismaOptions(db, database));
