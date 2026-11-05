import fs from 'node:fs';
import path from 'node:path';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { config } from './config.js';
import { logger } from './logger.js';
import { prepareDatabase } from './db/startup.js';
import { disconnectPrisma, getPrisma } from './db/prisma.js';
import { apiNotFound, errorHandler } from './middleware/errors.js';
import { apiLimiter } from './middleware/rateLimit.js';
import { requestLog } from './middleware/requestLog.js';
import { healthRouter } from './routes/health.js';
import { leadsRouter } from './routes/leads.js';

export function createApp() {
  const app = express();

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

  // ---- API ----
  const api = express.Router();
  api.use(cors({ origin: config.frontendOrigins, methods: ['GET', 'POST'] }));
  api.use(express.json({ limit: '10kb' }));
  api.use(apiLimiter);
  api.use('/health', healthRouter);
  api.use('/leads', leadsRouter);
  // Future integrations (payments, chatbot, etc.) mount here as new routers.
  api.use(apiNotFound);
  app.use('/api', api);

  // ---- Website (production only; in development Vite serves it) ----
  if (config.isProd) {
    const indexHtml = path.join(config.staticDir, 'index.html');
    if (!fs.existsSync(indexHtml)) {
      logger.warn({ staticDir: config.staticDir }, 'No built frontend found; only the API will be served');
    } else {
      app.use(
        express.static(config.staticDir, {
          index: false,
          setHeaders(res, filePath) {
            // Vite fingerprints files in /assets, so they can be cached forever.
            if (filePath.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          },
        }),
      );
      // Single-page app fallback for any non-API GET request.
      app.get(/^(?!\/api(?:\/|$)).*/, (req, res) => {
        res.setHeader('Cache-Control', 'no-cache');
        res.sendFile(indexHtml);
      });
    }
  }

  app.use(errorHandler);
  return app;
}

async function start() {
  logger.info({ env: config.nodeEnv }, 'Starting Byte Bun API');
  await prepareDatabase();

  const prisma = getPrisma();
  prisma.$on('warn', (e) => logger.warn({ prisma: e.message }));
  prisma.$on('error', (e) => logger.error({ prisma: e.message }));
  await prisma.$connect();

  const server = createApp().listen(config.port, '0.0.0.0', () => {
    logger.info({ port: config.port }, `API listening on port ${config.port}`);
  });

  const shutdown = (signal) => {
    logger.info({ signal }, 'Shutting down');
    server.close(async () => {
      await disconnectPrisma().catch(() => {});
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

start().catch((err) => {
  logger.fatal({ err: { message: err.message, stack: err.stack } }, 'API failed to start');
  process.exit(1);
});
