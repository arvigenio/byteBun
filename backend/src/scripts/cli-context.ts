// Shared setup for the admin command-line scripts: a database client and the auth instance,
// outside Nest. Run them in the api container, e.g.  docker compose exec api npm run seed:admins
import type { PrismaClient } from '@prisma/client';
import { createAuth } from '../auth/auth';
import { Mailer } from '../auth/mailer';
import { SecurityAlerts } from '../auth/security-alerts';
import { config } from '../config/config';
import { createPrismaClient } from '../database/prisma-options';

export function createCliContext() {
  const prisma = createPrismaClient(config.db) as unknown as PrismaClient;
  const mailer = new Mailer(config);
  const alerts = new SecurityAlerts(prisma, config, mailer);
  const auth = createAuth({ cfg: config, prisma, mailer, alerts });
  return { prisma, mailer, alerts, auth, config };
}

export async function runCli(main: () => Promise<number | void>) {
  try {
    process.exitCode = (await main()) ?? 0;
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  }
}
