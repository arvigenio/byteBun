import { Global, Module } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { PrismaService } from '../database/prisma.service';
import { createAuth } from './auth';
import { Mailer } from './mailer';
import { SecurityAlerts } from './security-alerts';

// Injection tokens: @Inject(AUTH) auth: Auth, @Inject(MAILER), @Inject(SECURITY_ALERTS).
export const AUTH = Symbol('AUTH');
export const MAILER = Symbol('MAILER');
export const SECURITY_ALERTS = Symbol('SECURITY_ALERTS');

@Global()
@Module({
  providers: [
    { provide: MAILER, inject: [APP_CONFIG], useFactory: (cfg: AppConfig) => new Mailer(cfg) },
    {
      provide: SECURITY_ALERTS,
      inject: [PrismaService, APP_CONFIG, MAILER],
      useFactory: (prisma: PrismaService, cfg: AppConfig, mailer: Mailer) => new SecurityAlerts(prisma as unknown as PrismaClient, cfg, mailer),
    },
    {
      provide: AUTH,
      inject: [APP_CONFIG, PrismaService, MAILER, SECURITY_ALERTS],
      useFactory: (cfg: AppConfig, prisma: PrismaService, mailer: Mailer, alerts: SecurityAlerts) =>
        createAuth({ cfg, prisma: prisma as unknown as PrismaClient, mailer, alerts }),
    },
  ],
  exports: [AUTH, MAILER, SECURITY_ALERTS],
})
export class AuthModule {}
