import { Router } from 'express';
import { isDatabaseReachable } from '../db/prisma.js';

export const healthRouter = Router();

healthRouter.get('/', async (req, res) => {
  const dbUp = await isDatabaseReachable();
  res.status(dbUp ? 200 : 503).json({
    status: dbUp ? 'ok' : 'degraded',
    database: dbUp ? 'reachable' : 'unreachable',
    uptimeSeconds: Math.round(process.uptime()),
    time: new Date().toISOString(),
  });
});
