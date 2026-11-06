import { Controller, Get, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { PrismaService } from '../database/prisma.service';

// GET /api/health -> 200 { status: 'ok', ... } or 503 when the database is unreachable.
// Used by the Docker healthcheck and the deploy script, so it is not rate limited.
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async check(@Res({ passthrough: true }) res: Response) {
    const dbUp = await this.prisma.isReachable();
    res.status(dbUp ? 200 : 503);
    return {
      status: dbUp ? 'ok' : 'degraded',
      database: dbUp ? 'reachable' : 'unreachable',
      uptimeSeconds: Math.round(process.uptime()),
      time: new Date().toISOString(),
    };
  }
}
