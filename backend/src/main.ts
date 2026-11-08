import 'reflect-metadata';
import type { PrismaClient } from '@prisma/client';
import { createApp } from './app';
import type { Auth } from './auth/auth';
import { AUTH } from './auth/auth.module';
import { ensureAdmins } from './auth/seed-admins';
import { config } from './config/config';
import { PrismaService } from './database/prisma.service';
import { prepareDatabase } from './database/startup';
import { logger } from './logging/logger';

async function bootstrap() {
  logger.info({ env: config.nodeEnv }, 'Starting Byte Bun API');
  await prepareDatabase();

  const app = await createApp();

  // The admins in src/auth/admins.ts exist from the first start on, without a manual seed step.
  // Only missing accounts are created; existing ones (and their authenticators) are not touched.
  const seeded = await ensureAdmins(app.get<Auth>(AUTH), app.get(PrismaService) as unknown as PrismaClient);
  for (const r of seeded.filter((x) => x.action === 'created')) logger.warn({ admin: r.email }, 'Admin account created (it was missing)');

  await app.listen(config.port, '0.0.0.0');
  logger.info({ port: config.port }, `API listening on port ${config.port}`);
}

bootstrap().catch((err: unknown) => {
  const e = err instanceof Error ? err : new Error(String(err));
  logger.fatal({ err: { message: e.message, stack: e.stack } }, 'API failed to start');
  process.exit(1);
});
