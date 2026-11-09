// Builds the HTTP app (used by main.ts, and by the tests in-process).
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { toNodeHandler } from 'better-auth/node';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { getAdminSession, isAdminApiPath } from './auth/admin-session';
import type { Auth } from './auth/auth';
import { AUTH } from './auth/auth.module';
import { requestMeta } from './auth/request-meta';
import { config } from './config/config';
import { PinoNestLogger } from './logging/logger';
import { requestLog } from './logging/request-log.middleware';
import { mountStaticSite } from './web/static-site';

export async function createApp({ serveStatic = config.isProd } = {}): Promise<NestExpressApplication> {
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
          // Cloudflare Web Analytics: Cloudflare injects its beacon script into pages it serves,
          // and the beacon reports to cloudflareinsights.com.
          // Google Tag Manager (public site, frontend/src/lib/gtm.js) and the Google Analytics 4
          // tag it loads: scripts from googletagmanager.com, hits to google-analytics.com.
          // Only these origins are added; everything else stays 'self' (live admin updates use
          // same-origin WebSockets). No 'unsafe-inline': GTM "Custom HTML" tags won't run.
          scriptSrc: ["'self'", 'https://static.cloudflareinsights.com', 'https://www.googletagmanager.com'],
          connectSrc: [
            "'self'",
            'https://cloudflareinsights.com',
            'https://www.googletagmanager.com',
            'https://*.google-analytics.com',
            'https://*.analytics.google.com',
          ],
          imgSrc: ["'self'", 'data:', 'https://www.googletagmanager.com', 'https://*.google-analytics.com'],
        },
      },
    }),
  );
  app.use(requestLog);
  app.use(requestMeta); // verified client IP for Better Auth's rate limits and the alert emails

  const auth = app.get<Auth>(AUTH);
  const http = app.getHttpAdapter().getInstance() as Express;

  // Admin API and sign-in: never cached, never indexed.
  http.use(['/api/auth', '/api/admin'], (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    next();
  });

  // Better Auth reads the raw request body itself, so it goes BEFORE express.json().
  http.all('/api/auth/*splat', toNodeHandler(auth));

  // Signed out (or only half signed in) -> 401 for anything under /api/admin, even routes that
  // don't exist. AdminSessionGuard checks again per route.
  http.use('/api/admin', async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!isAdminApiPath(req.originalUrl.split('?')[0])) return next();
      const admin = await getAdminSession(auth, req.headers, res);
      if (!admin) return res.status(401).json({ error: 'unauthorized', message: 'Please sign in.' });
      next();
    } catch (err) {
      next(err);
    }
  });

  app.use(express.json({ limit: '10kb' }));
  app.use(bodyParserErrors);
  app.enableCors({ origin: config.frontendOrigins, methods: ['GET', 'POST'] });

  app.setGlobalPrefix('api');
  if (serveStatic) mountStaticSite(app, config, auth);

  app.enableShutdownHooks(); // SIGTERM/SIGINT close the server and the database pool cleanly
  return app;
}

// Invalid or oversized JSON bodies, answered in the API's usual error shape.
function bodyParserErrors(err: { type?: string } | undefined, req: Request, res: Response, next: NextFunction) {
  if (err?.type === 'entity.too.large') return res.status(413).json({ error: 'payload_too_large', message: 'The message is too long.' });
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'invalid_json', message: 'The request could not be read.' });
  next(err);
}
