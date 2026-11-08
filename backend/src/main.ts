import 'reflect-metadata';
import { createApp } from './app';
import { config } from './config/config';
import { prepareDatabase } from './database/startup';
import { logger } from './logging/logger';

async function bootstrap() {
  logger.info({ env: config.nodeEnv }, 'Starting Byte Bun API');
  await prepareDatabase();

  const app = await createApp();
  await app.listen(config.port, '0.0.0.0');
  logger.info({ port: config.port }, `API listening on port ${config.port}`);
}

bootstrap().catch((err: unknown) => {
  const e = err instanceof Error ? err : new Error(String(err));
  logger.fatal({ err: { message: e.message, stack: e.stack } }, 'API failed to start');
  process.exit(1);
});
