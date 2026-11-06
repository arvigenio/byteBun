import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { config } from './config/config';
import { prepareDatabase } from './database/startup';
import { logger, PinoNestLogger } from './logging/logger';
import { requestLog } from './logging/request-log.middleware';
import { mountStaticSite } from './web/static-site';

async function bootstrap() {
  logger.info({ env: config.nodeEnv }, 'Starting Byte Bun API');
  await prepareDatabase();

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: new PinoNestLogger(),
    bodyParser: false, // our own JSON parser below, with a 10 kB limit
  });

  // Behind a reverse proxy (Nginx, Caddy, Traefik), so req.ip and rate limits see the real client.
  if (config.trustProxy) app.set('trust proxy', config.trustProxy);

  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          // HTTPS upgrades are the reverse proxy's job; this keeps local http testing working.
          upgradeInsecureRequests: null,
        },
      },
    }),
  );
  app.use(requestLog);
  app.use(express.json({ limit: '10kb' }));
  app.use(bodyParserErrors);
  app.enableCors({ origin: config.frontendOrigins, methods: ['GET', 'POST'] });

  app.setGlobalPrefix('api');
  if (config.isProd) mountStaticSite(app, config);

  app.enableShutdownHooks(); // SIGTERM/SIGINT close the server and the database pool cleanly
  await app.listen(config.port, '0.0.0.0');
  logger.info({ port: config.port }, `API listening on port ${config.port}`);
}

// Invalid or oversized JSON bodies, answered in the API's usual error shape.
function bodyParserErrors(err: { type?: string } | undefined, req: Request, res: Response, next: NextFunction) {
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'payload_too_large', message: 'The message is too long.' });
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'invalid_json', message: 'The request could not be read.' });
  next(err);
}

bootstrap().catch((err: unknown) => {
  const e = err instanceof Error ? err : new Error(String(err));
  logger.fatal({ err: { message: e.message, stack: e.stack } }, 'API failed to start');
  process.exit(1);
});
