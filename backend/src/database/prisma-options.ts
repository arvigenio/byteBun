import { PrismaMssql } from '@prisma/adapter-mssql';
import { PrismaClient, type Prisma } from '@prisma/client';
import type { DbConfig } from '../config/config';

// Prisma 7 talks to SQL Server through a driver adapter (built on the mssql package).
// All Prisma queries, including $queryRaw tagged templates, are parameterized.
export function prismaOptions(db: DbConfig, database = db.name) {
  const adapter = new PrismaMssql({
    server: db.host,
    port: db.port,
    database,
    user: db.user,
    password: db.password,
    connectionTimeout: 5_000,
    requestTimeout: 15_000,
    pool: { max: 10, min: 0, idleTimeoutMillis: 30_000 },
    options: {
      encrypt: true,
      trustServerCertificate: db.trustServerCertificate,
    },
  });
  return {
    adapter,
    log: [
      { level: 'warn', emit: 'event' },
      { level: 'error', emit: 'event' },
    ],
  } satisfies Prisma.PrismaClientOptions;
}

// A standalone client, e.g. for the `master` database during startup (outside Nest).
export const createPrismaClient = (db: DbConfig, database?: string) => new PrismaClient(prismaOptions(db, database));
