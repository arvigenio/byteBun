import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { BookingModule } from './booking/booking.module';
import { ApiExceptionFilter } from './common/api-exception.filter';
import { ApiThrottlerGuard, rateLimitOptions } from './common/rate-limit';
import { APP_CONFIG, type AppConfig } from './config/config';
import { ConfigModule } from './config/config.module';
import { PrismaModule } from './database/prisma.module';
import { HealthModule } from './health/health.module';
import { LeadsModule } from './leads/leads.module';

// Every route is under /api (see main.ts). New integrations (payments, chatbot, ...) are new
// modules added here.
@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    ThrottlerModule.forRootAsync({ inject: [APP_CONFIG], useFactory: (cfg: AppConfig) => rateLimitOptions(cfg) }),
    HealthModule,
    BookingModule,
    LeadsModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ApiThrottlerGuard },
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
  ],
})
export class AppModule {}
