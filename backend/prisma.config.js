// Prisma CLI configuration (generate, migrate). The connection string is built from the
// DB_* environment variables; DATABASE_URL overrides it if you prefer to set one directly.
import { defineConfig } from 'prisma/config';
import { buildDatabaseUrl } from './src/db/url.js';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: {
    // May be undefined during `prisma generate` in a Docker build; that command doesn't connect.
    url: process.env.DATABASE_URL || buildDatabaseUrl(),
  },
});
