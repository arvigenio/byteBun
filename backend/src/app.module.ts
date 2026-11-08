import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import { AdminModule } from './admin/admin.module';
import { AdminSessionGuard } from './auth/admin-session';
import { AuthModule } from './auth/auth.module';
import { BookingModule } from './booking/booking.module';
import { ApiExceptionFilter } from './common/api-exception.filter';
import { ApiThrottlerGuard, rateLimitOptions } from './common/rate-limit';
import { APP_CONFIG, type AppConfig } from './config/config';
import { ConfigModule } from './config/config.module';
import { PrismaModule } from './database/prisma.module';
import { HealthModule } from './health/health.module';
import { LeadEmailsModule } from './leads/lead-emails.module';
import { LeadsModule } from './leads/leads.module';
import { RealtimeModule } from './realtime/realtime.module';

// Every route is under /api (see app.ts). New integrations (payments, chatbot, ...) are new
// modules added here. Admin sign-in itself (/api/auth/*) is Better Auth, mounted in app.ts.
@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    ThrottlerModule.forRootAsync({ inject: [APP_CONFIG], useFactory: (cfg: AppConfig) => rateLimitOptions(cfg) }),
    AuthModule,
    RealtimeModule,
    LeadEmailsModule,
    HealthModule,
    BookingModule,
    LeadsModule,
    AdminModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ApiThrottlerGuard },
    // Every /api/admin route requires a fully signed-in admin (auth/admin-session.ts).
    { provide: APP_GUARD, useClass: AdminSessionGuard },
    { provide: APP_FILTER, useClass: ApiExceptionFilter },
  ],
})
export class AppModule {}
