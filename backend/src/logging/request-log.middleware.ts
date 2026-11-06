import type { NextFunction, Request, Response } from 'express';
import { logger } from './logger';

// One log line per request: method, path, status, duration. No headers, query values, or bodies.
export function requestLog(req: Request, res: Response, next: NextFunction) {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    if (req.path === '/api/health' && res.statusCode === 200) return; // keep healthcheck noise out
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    logger.info({ method: req.method, path: req.path, status: res.statusCode, ms: Math.round(ms) }, 'request');
  });
  next();
}
