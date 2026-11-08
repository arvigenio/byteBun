import fs from 'node:fs';
import path from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import express, { type NextFunction, type Request, type Response } from 'express';
import { getAdminSession } from '../auth/admin-session';
import type { Auth } from '../auth/auth';
import { type AppConfig, COMMON_LOGIN_PATHS } from '../config/config';
import { logger } from '../logging/logger';

const isApiPath = (p: string) => p === '/api' || p.startsWith('/api/');
const isAdminPage = (p: string) => p === '/admin' || p.startsWith('/admin/');

// Plain 404: the same body as any missing file, nothing that hints at an admin area.
const notFound = (res: Response) => res.status(404).type('text/plain').set('Cache-Control', 'no-store').send('Not Found');

/** /login, /signin, /admin/login, /wp-login.php, ... (and their sub-paths) always answer 404. */
export function isCommonLoginPath(p: string): boolean {
  const lower = p.toLowerCase().replace(/\/+$/, '') || '/';
  if (lower === '/admin.html') return true; // the built admin page is only served at the paths below
  return COMMON_LOGIN_PATHS.some((c) => c !== '/admin' && (lower === c || lower.startsWith(`${c}/`))) || lower === '/admin/login';
}

// Production only (in development Vite serves the site): the built frontend, plus the
// single-page-app fallback so /get-started etc. load index.html. /api is left to Nest.
//
// The admin app (frontend/admin.html) is a separate bundle, served only at:
//  - LOGIN_PATH (the secret sign-in page), to anyone; it never appears in the public site's code
//  - /admin/*, only to a fully signed-in admin. Anyone else gets a plain 404, not a redirect to
//    the sign-in page (that would reveal it).
export function mountStaticSite(app: NestExpressApplication, cfg: AppConfig, auth: Auth) {
  const indexHtml = path.join(cfg.staticDir, 'index.html');
  const adminHtml = path.join(cfg.staticDir, 'admin.html');
  if (!fs.existsSync(indexHtml)) {
    logger.warn({ staticDir: cfg.staticDir }, 'No built frontend found; only the API will be served');
    return;
  }
  const hasAdmin = fs.existsSync(adminHtml);
  if (!hasAdmin) logger.warn({ staticDir: cfg.staticDir }, 'No built admin page (admin.html) found; the admin area is unavailable');

  const sendAdmin = (res: Response) =>
    res.set({ 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', 'Referrer-Policy': 'no-referrer' }).sendFile(adminHtml);

  app.use(async (req: Request, res: Response, next: NextFunction) => {
    if (isApiPath(req.path)) return next();
    if (isCommonLoginPath(req.path)) return notFound(res);
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();

    const p = req.path.replace(/\/+$/, '') || '/';
    if (p === cfg.auth.loginPath) return hasAdmin ? sendAdmin(res) : notFound(res);
    if (isAdminPage(p)) {
      try {
        const admin = hasAdmin ? await getAdminSession(auth, req.headers, res) : null;
        return admin ? sendAdmin(res) : notFound(res);
      } catch (err) {
        return next(err);
      }
    }
    next();
  });

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
