// The CLIENTS database client (prisma-clients/schema.prisma -> @bytebun/clients-db). Same
// PostgreSQL server as the admin database (PrismaService), separate database (CLIENTS_DB_NAME).
// Inject anywhere: constructor(private readonly db: ClientsDb).
import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { type Prisma, PrismaClient } from '@bytebun/clients-db';
import { APP_CONFIG, type AppConfig, type DbConfig } from '../config/config';
import { logger } from '../logging/logger';

export function clientsDbOptions(db: DbConfig, database: string) {
  const adapter = new PrismaPg({
    host: db.host,
    port: db.port,
    database,
    user: db.user,
    password: db.password,
    ssl: db.ssl,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 15_000,
    max: 10,
    idleTimeoutMillis: 30_000,
  });
  return {
    adapter,
    log: [
      { level: 'warn', emit: 'event' },
      { level: 'error', emit: 'event' },
    ],
  } satisfies Prisma.PrismaClientOptions;
}

export type ClientsTx = Prisma.TransactionClient;

@Injectable()
export class ClientsDb extends PrismaClient<ReturnType<typeof clientsDbOptions>> implements OnModuleInit, OnModuleDestroy {
  constructor(@Inject(APP_CONFIG) cfg: AppConfig) {
    super(clientsDbOptions(cfg.db, cfg.clients.dbName));
  }

  async onModuleInit() {
    this.$on('warn', (e) => logger.warn({ prisma: e.message, db: 'clients' }));
    this.$on('error', (e) => logger.error({ prisma: e.message, db: 'clients' }));
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}

/** A standalone client (tests, scripts). */
export const createClientsDb = (cfg: AppConfig) => new PrismaClient(clientsDbOptions(cfg.db, cfg.clients.dbName));
