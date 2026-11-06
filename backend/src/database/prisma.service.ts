import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { logger } from '../logging/logger';
import { prismaOptions } from './prisma-options';

// The application's database client, connected to the app database. Inject it anywhere:
// constructor(private readonly prisma: PrismaService).
@Injectable()
export class PrismaService extends PrismaClient<ReturnType<typeof prismaOptions>> implements OnModuleInit, OnModuleDestroy {
  constructor(@Inject(APP_CONFIG) cfg: AppConfig) {
    super(prismaOptions(cfg.db));
  }

  async onModuleInit() {
    this.$on('warn', (e) => logger.warn({ prisma: e.message }));
    this.$on('error', (e) => logger.error({ prisma: e.message }));
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  async isReachable(): Promise<boolean> {
    try {
      await this.$queryRaw`SELECT 1 AS ok`;
      return true;
    } catch {
      return false;
    }
  }
}
