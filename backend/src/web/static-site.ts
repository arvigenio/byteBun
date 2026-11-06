import fs from 'node:fs';
import path from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import express, { type NextFunction, type Request, type Response } from 'express';
import type { AppConfig } from '../config/config';
import { logger } from '../logging/logger';

const isApiPath = (p: string) => p === '/api' || p.startsWith('/api/');

// Production only (in development Vite serves the site): the built frontend, plus the
// single-page-app fallback so /get-started etc. load index.html. /api is left to Nest.
export function mountStaticSite(app: NestExpressApplication, cfg: AppConfig) {
  const indexHtml = path.join(cfg.staticDir, 'index.html');
  if (!fs.existsSync(indexHtml)) {
    logger.warn({ staticDir: cfg.staticDir }, 'No built frontend found; only the API will be served');
    return;
  }

  app.use(
    express.static(cfg.staticDir, {
      index: false,
      setHeaders(res, filePath) {
        // Vite fingerprints files in /assets, so they can be cached forever.
        if (filePath.includes(`${path.sep}assets${path.sep}`)) res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      },
    }),
  );
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET' || isApiPath(req.path)) return next();
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(indexHtml);
  });
}
