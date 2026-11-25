// Events without a bigger-event voucher (50 participants or fewer, free or paid to attend) are
// deleted automatically 3 months after they end; the business agrees to this when creating one
// (events.retentionAgreedAt). Owners and admins get a reminder 7, 3 and 1 days before, and on the
// day the complete event (CSV + JSON) by email, then it's deleted (registrations, scanners,
// claimables and claims go with it: database cascade).
//
// A voucher (or Byte Bun raising the event's limit) stops it: those events have participantLimit.
// Runs hourly (and a minute after start); tests call run(now) directly.
import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { MAILER } from '../../auth/auth.module';
import type { Mailer } from '../../auth/mailer';
import { APP_CONFIG, type AppConfig } from '../../config/config';
import { logger } from '../../logging/logger';
import { eventArchivedMail, eventRetentionReminderMail } from '../client-emails';
import { ClientsDb } from '../clients-db';
import { eventCsv, eventExportData, retentionOf } from './events';
import { todayIn } from './time';

const HOUR = 3_600_000;
/** Reminders: this many days before the deletion day. */
export const RETENTION_REMINDERS = [7, 3, 1];

const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

@Injectable()
export class EventRetentionJob implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly db: ClientsDb,
    @Inject(MAILER) private readonly mailer: Mailer,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  onModuleInit() {
    if (this.cfg.nodeEnv === 'test') return;
    setTimeout(() => void this.run(), 90_000);
    this.timer = setInterval(() => void this.run(), HOUR);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** The owners' and admins' email addresses. */
  private async recipients(organizationId: string) {
    const members = await this.db.member.findMany({ where: { organizationId, role: { in: ['owner', 'admin'] } }, include: { user: { select: { email: true } } } });
    return [...new Set(members.map((m) => m.user.email))];
  }

  async run(now = new Date()) {
    const result = { reminded: 0, deleted: 0 };
    try {
      // Agreed, voucher-less events that ended at least 80 days ago: 3 months is 89+ days, so
      // this covers the first reminder (7 days before) with room to spare.
      const events = await this.db.event.findMany({ where: { participantLimit: null, retentionAgreedAt: { not: null }, endsAt: { lte: new Date(now.getTime() - 80 * 86_400_000) } } });
      const zones = new Map<string, string>();
      for (const e of events) {
        if (!zones.has(e.organizationId)) {
          const s = await this.db.bookingSettings.findUnique({ where: { organizationId: e.organizationId }, select: { timeZone: true } });
          zones.set(e.organizationId, s?.timeZone ?? 'UTC');
        }
        const { applies, deleteOn } = retentionOf(e, zones.get(e.organizationId)!);
        if (!applies || !deleteOn) continue;
        const today = todayIn(e.timeZone || zones.get(e.organizationId)!, now);
        const daysLeft = daysBetween(today, deleteOn);
        if (daysLeft <= 0) {
          if (await this.archiveAndDelete(e.organizationId, e.id)) result.deleted++;
          continue;
        }
        // The reminders due now (one email even if several were missed), each sent once.
        const due = RETENTION_REMINDERS.filter((d) => daysLeft <= d && !e.retentionNotices.includes(d));
        if (!due.length) continue;
        const settings = await this.db.bookingSettings.findUnique({ where: { organizationId: e.organizationId }, select: { businessName: true } });
        for (const to of await this.recipients(e.organizationId)) {
          this.mailer.sendInBackground(
            eventRetentionReminderMail(this.cfg, { to, businessName: settings?.businessName ?? '', eventTitle: e.title, deleteOn, daysLeft, eventUrl: `${this.cfg.clients.bookingsUrl}/app/events/${e.id}` }),
          );
        }
        await this.db.event.update({ where: { id: e.id }, data: { retentionNotices: { set: [...e.retentionNotices, ...due] } } });
        result.reminded++;
      }
      if (result.reminded || result.deleted) logger.info(result, 'Event retention job');
    } catch (err) {
      logger.error({ reason: err instanceof Error ? err.message : String(err) }, 'Event retention job failed');
    }
    return result;
  }

  /** The complete event to the owners and admins (CSV + JSON), then it's deleted. */
  private async archiveAndDelete(organizationId: string, eventId: number) {
    const d = await eventExportData(this.db, organizationId, eventId);
    const settings = await this.db.bookingSettings.findUnique({ where: { organizationId }, select: { businessName: true } });
    const recipients = await this.recipients(organizationId);
    for (const to of recipients) {
      // Sent before deleting (awaited), so the data is out of our hands first.
      await this.mailer.send(
        eventArchivedMail(this.cfg, { to, businessName: settings?.businessName ?? '', eventTitle: d.json.event.title, file: d.file, csv: eventCsv(d), json: JSON.stringify(d.json, null, 2), registrations: d.json.event.totals.registered }),
      );
    }
    await this.db.$transaction([
      this.db.event.delete({ where: { id: eventId } }),
      this.db.billingEvent.create({ data: { organizationId, type: 'event_retention_deleted', actor: 'system', data: { eventId, title: d.json.event.title, emailedTo: recipients.length } } }),
    ]);
    logger.info({ organizationId, eventId }, 'Event deleted by retention (data emailed)');
    return true;
  }
}
