// The client apps (accounts, Bookings, client portal): their own database (ClientsDb), their own
// sign-in (CLIENTS_AUTH), and their API under /api/client (signed-in clients) and /api/public
// (booking pages, manage links). Better Auth itself is mounted in app.ts at /api/accounts/auth.
import { Global, Module } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { MAILER } from '../auth/auth.module';
import type { Mailer } from '../auth/mailer';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { PrismaService } from '../database/prisma.service';
import { AccountsController } from './accounts.controller';
import { ClientsAdminController } from './admin/clients-admin.controller';
import { CLIENTS_ADMIN_DB, ClientsAdminService } from './admin/clients-admin.service';
import { BookingAdminController } from './booking/booking-admin.controller';
import { BookingEngine } from './booking/booking-engine';
import { ManageTokens } from './booking/manage-token';
import { BookingNotifications, MANAGE_TOKENS } from './booking/notifications';
import { EventClaims, EventScannersController, ScannerController } from './booking/event-scanners';
import { EventCheckIns, EventLive, EventMails, EventsAdminController, PublicEventsController } from './booking/events';
import { EventRetentionJob } from './booking/event-retention';
import { PlacesController } from './booking/places.controller';
import { PublicBookingController } from './booking/public-booking.controller';
import { RetentionJob } from './booking/retention';
import { createClientsAuth } from './clients-auth';
import { ClientsDb, clientsDbOptions } from './clients-db';
import { PrismaClient as ClientsPrismaClient } from '@bytebun/clients-db';
import { CLIENTS_AUTH, ClientGuard } from './client-context';

@Global()
@Module({
  controllers: [AccountsController, BookingAdminController, PublicBookingController, EventsAdminController, PublicEventsController, EventScannersController, ScannerController, PlacesController, ClientsAdminController],
  providers: [
    ClientsDb,
    ClientGuard,
    BookingNotifications,
    EventMails,
    EventLive,
    EventCheckIns,
    EventClaims,
    BookingEngine,
    RetentionJob,
    EventRetentionJob,
    ClientsAdminService,
    {
      // The admin site's own, limited login to the clients database when configured
      // (CLIENTS_ADMIN_DB_USER, docs/CLIENTS-DB-ADMIN-USER.sql); else the app's connection.
      provide: CLIENTS_ADMIN_DB,
      inject: [APP_CONFIG, ClientsDb],
      useFactory: (cfg: AppConfig, db: ClientsDb) =>
        cfg.clients.adminDbUser
          ? new ClientsPrismaClient(clientsDbOptions({ ...cfg.db, user: cfg.clients.adminDbUser, password: cfg.clients.adminDbPassword }, cfg.clients.dbName))
          : db,
    },
    { provide: MANAGE_TOKENS, inject: [APP_CONFIG], useFactory: (cfg: AppConfig) => new ManageTokens(cfg) },
    {
      provide: CLIENTS_AUTH,
      inject: [APP_CONFIG, ClientsDb, MAILER, PrismaService],
      useFactory: (cfg: AppConfig, db: ClientsDb, mailer: Mailer, prisma: PrismaService) => createClientsAuth({ cfg, db, mailer, counters: prisma as unknown as PrismaClient }),
    },
  ],
  exports: [ClientsDb, CLIENTS_AUTH, BookingNotifications, BookingEngine],
})
export class ClientsModule {}
