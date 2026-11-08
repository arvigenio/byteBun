import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { seoPlugin } from './seo-plugin.js';

// Inside Docker the API is reachable by its service name; outside Docker, on localhost.
const apiTarget = process.env.VITE_API_PROXY_TARGET || 'http://localhost:4000';

// Development only: the same page rules production has (backend/src/web/static-site.ts).
//  - LOGIN_PATH serves the admin app (the sign-in page)
//  - /admin/* serves it only to a fully signed-in admin, else a plain 404
//  - common login paths (/login, /admin/login, ...) and /admin.html are a plain 404
// LOGIN_PATH is read here at dev-server start only; it is never put into any bundle.
function adminPagesPlugin() {
  const loginPath = (process.env.LOGIN_PATH || '/bb-admin-portal').replace(/\/+$/, '');
  // Keep in step with COMMON_LOGIN_PATHS in backend/src/config/config.ts.
  const common = ['/login', '/log-in', '/signin', '/sign-in', '/logon', '/auth', '/administrator', '/dashboard', '/portal', '/wp-admin', '/wp-login.php', '/user', '/users', '/account', '/panel', '/cpanel', '/backend', '/manage', '/console'];
  const isCommon = (p) => {
    const lower = p.toLowerCase();
    return lower === '/admin.html' || lower === '/admin/login' || common.some((c) => lower === c || lower.startsWith(`${c}/`));
  };
  const notFound = (res) => {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/plain');
    res.end('Not Found');
  };

  return {
    name: 'bytebun-admin-pages',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const p = new URL(req.url, 'http://dev').pathname.replace(/\/+$/, '') || '/';
        if (/^\/(api|@|src|node_modules|assets)(\/|$)/.test(p) || p.startsWith('/@')) return next();
        if (isCommon(p)) return notFound(res);
        const adminPage = p === '/admin' || p.startsWith('/admin/');
        if (p !== loginPath && !adminPage) return next();
        if (adminPage) {
          const me = await fetch(`${apiTarget}/api/admin/me`, { headers: { cookie: req.headers.cookie ?? '' } }).catch(() => null);
          if (me?.status !== 200) return notFound(res);
        }
        try {
          const html = await server.transformIndexHtml(req.url, fs.readFileSync(path.resolve(server.config.root, 'admin.html'), 'utf8'));
          res.setHeader('Content-Type', 'text/html');
          res.setHeader('Cache-Control', 'no-store');
          res.setHeader('X-Robots-Tag', 'noindex, nofollow');
          res.end(html);
        } catch (err) {
          next(err);
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), seoPlugin(), adminPagesPlugin()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    // Windows bind mounts don't forward file-change events into containers, so poll instead.
    watch: { usePolling: true, interval: 300 },
    proxy: {
      // ws: live admin updates (Socket.IO at /api/realtime).
      '/api': { target: apiTarget, changeOrigin: false, ws: true },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Two separate apps: the public site, and the admin app (its own bundle, so none of the
    // admin code is downloaded by visitors).
    rollupOptions: {
      input: {
        main: path.resolve(import.meta.dirname, 'index.html'),
        admin: path.resolve(import.meta.dirname, 'admin.html'),
      },
    },
  },
});
