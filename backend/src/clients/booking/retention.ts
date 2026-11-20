// Free plan data rule: bookings are deleted `bookings.retention_days` (60) days after the
// appointment date, in the business's time zone. About 7 days before, owners get one email per
// deletion day with a CSV export link. Paid plans have no such limit (entitlements.ts removes it
// with bookings.unlimited), so upgrading stops deletion at once: the job only looks at
// businesses that currently have the limit.
//
// The same hourly run also removes deleted clients whose 30 days are over (clients-admin.service.ts).
// Runs hourly (and on start); tests call run() directly. Deleting a booking also deletes its
// queued notifications (cascade); customers left with no bookings are deleted too.
import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../../config/config';
import { logger } from '../../logging/logger';
import { ClientsAdminService } from '../admin/clients-admin.service';
import { ClientsDb } from '../clients-db';
import { BookingNotifications } from './notifications';
import { addDays, dateToDb, todayIn } from './time';

const HOUR = 3_600_000;
export const WARN_DAYS_BEFORE = 7;

@Injectable()
export class RetentionJob implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly db: ClientsDb,
    private readonly notifications: BookingNotifications,
    private readonly clientsAdmin: ClientsAdminService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  onModuleInit() {
    if (this.cfg.nodeEnv === 'test') return;
    setTimeout(() => void this.run(), 60_000);
    this.timer = setInterval(() => void this.run(), HOUR);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async run(now = new Date()) {
    const result = { deleted: 0, warned: 0, purged: 0 };
    try {
      // Deleted clients past their 30 days are removed for good.
      result.purged = await this.clientsAdmin.purgeExpired(now);
      const limited = await this.db.entitlement.findMany({ where: { key: 'limit:bookings.retention_days' } });
      for (const { organizationId, value } of limited) {
        if (value === null || value < 1) continue;
        const r = await this.runFor(organizationId, value, now);
        result.deleted += r.deleted;
        result.warned += r.warned;
      }
      if (result.deleted || result.warned || result.purged) logger.info(result, 'Free plan retention job');
      if (result.warned) this.notifications.kick();
    } catch (err) {
      logger.error({ reason: err instanceof Error ? err.message : String(err) }, 'Retention job failed');
    }
    return result;
  }

  private async runFor(organizationId: string, days: number, now: Date) {
    const settings = await this.db.bookingSettings.findUnique({ where: { organizationId }, select: { timeZone: true } });
    if (!settings) return { deleted: 0, warned: 0 };
    const today = todayIn(settings.timeZone, now);
    // A booking on date D is deleted on D + days.
    const lastKept = addDays(today, -days); // deleted: localDate <= lastKept
    const deleted = await this.db.$transaction(async (tx) => {
      const { count } = await tx.booking.deleteMany({ where: { organizationId, localDate: { lte: dateToDb(lastKept) } } });
      if (count) {
        await tx.customer.deleteMany({ where: { organizationId, bookings: { none: {} } } });
        await tx.billingEvent.create({ data: { organizationId, type: 'retention_deleted', data: { count, upTo: lastKept, days }, actor: 'system' } });
      }
      return count;
    });

    // Warn about each deletion day in the next WARN_DAYS_BEFORE days, once.
    let warned = 0;
    for (let i = 1; i <= WARN_DAYS_BEFORE; i++) {
      const deleteOn = addDays(today, i);
      const localDate = addDays(deleteOn, -days);
      const count = await this.db.booking.count({ where: { organizationId, localDate: dateToDb(localDate) } });
      if (!count) continue;
      const already = await this.db.notification.count({ where: { organizationId, kind: 'retention_warning', payload: { path: ['deleteOn'], equals: deleteOn } } });
      if (already) continue;
      const owners = await this.notifications.ownerEmails(this.db, organizationId, ['owner']);
      if (!owners.length) continue;
      await this.db.notification.createMany({
        data: owners.map((recipient) => ({ organizationId, kind: 'retention_warning', channel: 'email', recipient, sendAt: now, payload: { deleteOn, count, retentionDays: days } })),
      });
      warned++;
    }
    return { deleted, warned };
  }
}
