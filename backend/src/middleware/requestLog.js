import { logger } from '../logger.js';

// One log line per request: method, path, status, duration. No headers, query values, or bodies.
export function requestLog(req, res, next) {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    if (req.path === '/api/health' && res.statusCode === 200) return; // keep healthcheck noise out
    logger.info({ method: req.method, path: req.path, status: res.statusCode, ms: Math.round(ms) }, 'request');
  });
  next();
}
