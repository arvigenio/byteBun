// Prisma CLI configuration for the CLIENTS database (the prisma-clients/ folder: schema.prisma,
// auth.prisma, billing.prisma, booking.prisma). Used with --config prisma.clients.config.ts (npm scripts).
// The connection string comes from the DB_* variables with CLIENTS_DB_NAME as the database;
// CLIENTS_DATABASE_URL overrides it.
import { defineConfig } from 'prisma/config';
import { buildDatabaseUrl } from './src/database/database-url';

export default defineConfig({
  schema: 'prisma-clients',
  migrations: { path: 'prisma-clients/migrations' },
  datasource: {
    url: process.env.CLIENTS_DATABASE_URL || buildDatabaseUrl({ ...process.env, DB_NAME: process.env.CLIENTS_DB_NAME || 'clients_db' }),
  },
});
