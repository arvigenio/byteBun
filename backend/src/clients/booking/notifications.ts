// Notification queue (booking.notifications): one row per message, with its send time, channel,
// status and attempts. Booking changes add rows inside their transaction; the worker below sends
// the due ones every few seconds (and right away after a change), retrying failures with backoff.
//
// Who gets what:
//   new booking   customer: confirmation           owners/admins: new booking alert
//   reschedule    customer: updated confirmation   owners/admins: reschedule alert
//   cancellation  customer: cancellation           owners/admins: cancellation alert
//   reminders     customer only (settings.reminders, reminders.ts): replaced on reschedule,
//                 removed on cancel, skipped when already in the past (late bookings)
//   no-show       customer: "we missed you" (when the business marks it, if enabled)
//   account       owners: deactivated / reactivated / deleted notices (admin site)
// Owners choose which alerts they get and on which channel (settings.owner_alerts). Messages are
// rendered at send time from the current booking, so they always show the latest details.
//
// WhatsApp (paid plans): the message is POSTed to WHATSAPP_WEBHOOK_URL for n8n to send. Without a
// webhook, without the plan feature, or without the customer's phone number, it goes as email.
import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { MAILER } from '../../auth/auth.module';
import type { Mail, Mailer } from '../../auth/mailer';
import { APP_CONFIG, type AppConfig } from '../../config/config';
import { logger } from '../../logging/logger';
import { ClientsDb, type ClientsTx } from '../clients-db';
import {
  accountNoticeMail,
  type BookingView,
  calendarFor,
  cancelledMail,
  cleanInstructions,
  confirmationMail,
  monthlyLimitMail,
  noShowMail,
  type OwnerAlertKind,
  ownerAlertMail,
  reminderMail,
  rescheduledMail,
  retentionWarningMail,
  whatsappText,
} from '../client-emails';
import { hasFeature, loadEntitlements } from '../entitlements';
import { checkInQrPng, checkInUrl, formatCheckInCode } from './check-in';
import { ManageTokens } from './manage-token';
import { allowedReminders, parseReminders } from './reminders';
import { dateFromDb, formatInZone, formatLocalDate } from './time';

export const MANAGE_TOKENS = Symbol('MANAGE_TOKENS');

/** Tests (NODE_ENV=test): WhatsApp messages land here instead of going to the n8n webhook. */
export const whatsappOutbox: { to: string; kind: string; text: string }[] = [];

type BookingEvent = 'new' | 'rescheduled' | 'cancelled';
const OWNER_ALERT_KEY: Record<BookingEvent, string> = { new: 'newBooking', rescheduled: 'reschedule', cancelled: 'cancellation' };
const CUSTOMER_KIND: Record<BookingEvent, string> = { new: 'confirmation', rescheduled: 'reschedule', cancelled: 'cancellation' };
const OWNER_KIND: Record<BookingEvent, string> = { new: 'owner_new', rescheduled: 'owner_reschedule', cancelled: 'owner_cancel' };
const MAX_ATTEMPTS = 5;
const POLL_MS = 15_000;

/** Owner alert preferences: { newBooking: ['email'], ... }. Missing = email on. */
export function ownerAlertChannels(ownerAlerts: unknown, key: string): string[] {
  const v = ownerAlerts && typeof ownerAlerts === 'object' ? (ownerAlerts as Record<string, unknown>)[key] : undefined;
  return Array.isArray(v) ? v.filter((c): c is string => c === 'email' || c === 'whatsapp') : ['email'];
}

@Injectable()
export class BookingNotifications implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<number> | null = null;

  constructor(
    private readonly db: ClientsDb,
    @Inject(MAILER) private readonly mailer: Mailer,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    @Inject(MANAGE_TOKENS) private readonly tokens: ManageTokens,
  ) {}

  onModuleInit() {
    // Tests call flush() themselves.
    if (this.cfg.nodeEnv !== 'test') this.timer = setInterval(() => void this.flush(), POLL_MS);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Send soon (after a change), without waiting. */
  kick() {
    if (this.cfg.nodeEnv !== 'test') setImmediate(() => void this.flush());
  }

  whenLabel(b: { startsAt: Date; localDate: string; dateOnly: boolean }, timeZone: string) {
    if (b.dateOnly) return formatLocalDate(b.localDate);
    const f = formatInZone(b.startsAt, timeZone);
    return `${f.date}, ${f.time} (${f.zone})`;
  }

  /** Customer + owner messages for a booking change, and the booking's reminders. */
  async queueBookingEvent(tx: ClientsTx, bookingId: number, event: BookingEvent, payload: Record<string, unknown> = {}) {
    const booking = await tx.booking.findUniqueOrThrow({ where: { id: bookingId }, include: { customer: true } });
    const settings = await tx.bookingSettings.findUniqueOrThrow({ where: { organizationId: booking.organizationId } });
    const ents = await loadEntitlements(tx, booking.organizationId);
    const whatsappAlerts = hasFeature(ents, 'bookings.whatsapp_alerts');
    const now = new Date();
    const rows: { kind: string; channel: string; recipient: string; sendAt: Date; payload: object }[] = [];
    if (event !== 'cancelled' || payload.notifyCustomer !== false) rows.push({ kind: CUSTOMER_KIND[event], channel: 'email', recipient: booking.customer.email, sendAt: now, payload });
    const channels = ownerAlertChannels(settings.ownerAlerts, OWNER_ALERT_KEY[event]);
    if (channels.includes('email')) {
      for (const email of await this.ownerEmails(tx, booking.organizationId)) rows.push({ kind: OWNER_KIND[event], channel: 'email', recipient: email, sendAt: now, payload });
    }
    if (channels.includes('whatsapp') && whatsappAlerts && settings.alertPhone) rows.push({ kind: OWNER_KIND[event], channel: 'whatsapp', recipient: settings.alertPhone, sendAt: now, payload });

    if (event !== 'cancelled') {
      for (const r of allowedReminders(parseReminders(settings.reminders), ents)) {
        const sendAt = new Date(booking.startsAt.getTime() - r.offsetMinutes * 60_000);
        if (sendAt.getTime() <= now.getTime() + 60_000) continue; // already past: late booking
        const phone = r.channel === 'whatsapp' ? booking.customer.phone : null;
        rows.push({ kind: 'reminder', channel: phone ? 'whatsapp' : 'email', recipient: phone ?? booking.customer.email, sendAt, payload: { offsetMinutes: r.offsetMinutes } });
      }
    }
    if (rows.length) {
      await tx.notification.createMany({ data: rows.map((r) => ({ organizationId: booking.organizationId, bookingId, ...r })) });
    }
  }

  async queueNoShow(tx: ClientsTx, bookingId: number) {
    const b = await tx.booking.findUniqueOrThrow({ where: { id: bookingId }, include: { customer: true } });
    await tx.notification.create({ data: { organizationId: b.organizationId, bookingId, kind: 'no_show', channel: 'email', recipient: b.customer.email, sendAt: new Date() } });
  }

  async queueAccountNotice(tx: ClientsTx | ClientsDb, organizationId: string, kind: 'deactivated' | 'reactivated' | 'deleted', payload: Record<string, unknown>) {
    const emails = await this.ownerEmails(tx, organizationId, ['owner']);
    if (emails.length) {
      await tx.notification.createMany({ data: emails.map((recipient) => ({ organizationId, kind: 'account_notice', channel: 'email', recipient, sendAt: new Date(), payload: { kind, ...payload } })) });
    }
  }

  async queueLimitWarning(tx: ClientsTx, organizationId: string, used: number, limit: number) {
    const emails = await this.ownerEmails(tx, organizationId, ['owner']);
    if (emails.length) {
      await tx.notification.createMany({
        data: emails.map((recipient) => ({ organizationId, kind: 'limit_warning', channel: 'email', recipient, sendAt: new Date(), payload: { used, limit } })),
      });
    }
  }

  /** Pending messages for a booking that are no longer wanted (reminders after a change). */
  cancelPending(tx: ClientsTx, bookingId: number) {
    return tx.notification.updateMany({ where: { bookingId, status: 'pending', kind: { in: ['reminder'] } }, data: { status: 'cancelled' } });
  }

  async ownerEmails(tx: ClientsTx | ClientsDb, organizationId: string, roles = ['owner', 'admin']) {
    const members = await tx.member.findMany({ where: { organizationId, role: { in: roles } }, include: { user: { select: { email: true } } } });
    return [...new Set(members.map((m) => m.user.email))];
  }

  /** Sends every due message (due by `now`; tests pass a later time). Returns how many were handled. */
  flush(now?: Date): Promise<number> {
    if (this.running) return this.running.then(() => this.flush(now));
    this.running = this.sendDue(now).finally(() => (this.running = null));
    return this.running;
  }

  private async sendDue(now?: Date): Promise<number> {
    let handled = 0;
    const until = now ?? new Date();
    try {
      for (;;) {
        const claimed = await this.db.$queryRaw<{ id: number }[]>`
          UPDATE booking.notifications SET status = 'sending', attempts = attempts + 1
          WHERE id IN (
            SELECT id FROM booking.notifications
            WHERE status = 'pending' AND send_at <= ${until}
            ORDER BY send_at LIMIT 25 FOR UPDATE SKIP LOCKED)
          RETURNING id`;
        if (!claimed.length) return handled;
        for (const { id } of claimed) {
          await this.sendOne(id, until);
          handled++;
        }
      }
    } catch (err) {
      logger.error({ reason: err instanceof Error ? err.message : String(err) }, 'Notification worker failed');
      return handled;
    }
  }

  private async sendOne(id: number, now: Date) {
    const n = await this.db.notification.findUniqueOrThrow({ where: { id } });
    const skip = () => this.db.notification.update({ where: { id }, data: { status: 'skipped' } });
    try {
      // A reminder for a booking that was cancelled or has already started: drop it.
      if (n.kind === 'reminder' && n.bookingId) {
        const b = await this.db.booking.findUnique({ where: { id: n.bookingId }, select: { status: true, startsAt: true } });
        if (!b || b.status !== 'confirmed' || b.startsAt <= now) return void (await skip());
      }
      if (n.channel === 'whatsapp') {
        if (await this.sendWhatsapp(n)) {
          await this.db.notification.update({ where: { id }, data: { status: 'sent', sentAt: new Date(), lastError: null } });
          return;
        }
        // No WhatsApp possible: owners already get email alerts if they chose them.
        if (n.kind.startsWith('owner_')) return void (await skip());
      }
      const mail = await this.render(n);
      if (!mail) return void (await skip());
      await this.mailer.send(mail);
      const fellBack = n.channel === 'whatsapp' ? { channel: 'email', recipient: [mail.to].flat()[0] } : {};
      await this.db.notification.update({ where: { id }, data: { status: 'sent', sentAt: new Date(), lastError: null, ...fellBack } });
    } catch (err) {
      const reason = (err instanceof Error ? err.message : String(err)).slice(0, 500);
      const retry = n.attempts < MAX_ATTEMPTS;
      await this.db.notification.update({
        where: { id },
        data: { status: retry ? 'pending' : 'failed', lastError: reason, sendAt: new Date(Date.now() + 2 ** n.attempts * 60_000) },
      });
      logger.warn({ notificationId: id, kind: n.kind, attempts: n.attempts, retry, reason }, 'Notification not sent');
    }
  }

  /**
   * true = handed to n8n. false = WhatsApp not possible (no webhook, not in the plan, no booking):
   * the caller falls back to email. Throws when the webhook fails (retried with backoff).
   */
  private async sendWhatsapp(n: { id: number; kind: string; organizationId: string; bookingId: number | null; recipient: string }): Promise<boolean> {
    const url = this.cfg.clients.whatsappWebhookUrl;
    const testing = this.cfg.nodeEnv === 'test';
    if ((!url && !testing) || !n.bookingId) return false;
    // Owner alerts and customer messages are separate plan features.
    const feature = n.kind.startsWith('owner_') ? 'bookings.whatsapp_alerts' : 'bookings.whatsapp';
    if (!hasFeature(await loadEntitlements(this.db, n.organizationId), feature)) return false;
    const view = await this.bookingView(n.bookingId);
    if (!view) return false;
    const { v } = view;
    const text = whatsappText(n.kind, v);
    if (testing) {
      if (!url) return false;
      whatsappOutbox.push({ to: n.recipient, kind: n.kind, text });
      return true;
    }
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(this.cfg.clients.whatsappWebhookSecret && { 'X-Bytebun-Secret': this.cfg.clients.whatsappWebhookSecret }) },
      body: JSON.stringify({
        type: 'whatsapp_message',
        notificationId: n.id,
        kind: n.kind,
        to: n.recipient,
        text,
        business: v.brand.businessName,
        bookingId: v.bookingId,
        service: v.serviceName,
        when: { date: v.dateLabel, time: v.timeLabel, zone: v.zone },
        manageUrl: v.canChange ? v.manageUrl : null,
        meetingUrl: v.location.type === 'online' ? v.location.meetingUrl : null,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`WhatsApp webhook answered ${res.status}`);
    return true;
  }

  private async render(n: { kind: string; organizationId: string; bookingId: number | null; recipient: string; payload: unknown }): Promise<Mail | null> {
    const payload = (n.payload ?? {}) as Record<string, unknown>;
    const c = this.cfg.clients;
    const businessName = async () => (await this.db.bookingSettings.findUnique({ where: { organizationId: n.organizationId } }))?.businessName ?? 'Your business';
    if (n.kind === 'limit_warning') {
      return monthlyLimitMail(this.cfg, n.recipient, { businessName: await businessName(), used: Number(payload.used), limit: Number(payload.limit), upgradeUrl: `${c.bookingsUrl}/app/plan` });
    }
    if (n.kind === 'retention_warning') {
      return retentionWarningMail(this.cfg, n.recipient, {
        businessName: await businessName(),
        count: Number(payload.count),
        deleteOn: String(payload.deleteOn),
        retentionDays: Number(payload.retentionDays),
        exportUrl: `${c.bookingsUrl}/api/client/bookings/export.csv`,
        upgradeUrl: `${c.bookingsUrl}/app/plan`,
      });
    }
    if (n.kind === 'account_notice') {
      return accountNoticeMail(this.cfg, n.recipient, {
        businessName: await businessName(),
        kind: payload.kind as 'deactivated' | 'reactivated' | 'deleted',
        reason: (payload.reason as string) ?? null,
        deleteAfter: payload.deleteAfter as string | undefined,
      });
    }
    if (!n.bookingId) return null;
    const view = await this.bookingView(n.bookingId);
    if (!view) return null;
    const { v, slug } = view;
    const dashboard = `${c.bookingsUrl}/app`;
    switch (n.kind) {
      case 'confirmation':
        return confirmationMail(this.cfg, v);
      case 'reschedule':
        return rescheduledMail(this.cfg, v, String(payload.previous ?? ''));
      case 'cancellation':
        return cancelledMail(this.cfg, v, { by: String(payload.by ?? 'business'), reason: (payload.reason as string) ?? null, bookAgainUrl: `${c.bookingsUrl}/${slug}` });
      case 'reminder':
        return reminderMail(this.cfg, v);
      case 'no_show':
        return noShowMail(this.cfg, v, `${c.bookingsUrl}/${slug}`);
      case 'owner_new':
      case 'owner_reschedule':
      case 'owner_cancel': {
        // A WhatsApp owner alert has a phone number as recipient: no email version.
        if (!n.recipient.includes('@')) return null;
        const kind: OwnerAlertKind = n.kind === 'owner_new' ? 'new' : n.kind === 'owner_reschedule' ? 'rescheduled' : 'cancelled';
        return ownerAlertMail(this.cfg, n.recipient, kind, v, dashboard, { previous: payload.previous as string | undefined, by: payload.by as string | undefined });
      }
      default:
        return null;
    }
  }

  /** Everything a booking email shows, from the current data. */
  async bookingView(bookingId: number): Promise<{ v: BookingView; slug: string } | null> {
    const b = await this.db.booking.findUnique({ where: { id: bookingId }, include: { service: true, customer: true } });
    if (!b) return null;
    const s = await this.db.bookingSettings.findUnique({ where: { organizationId: b.organizationId } });
    if (!s) return null;
    const ents = await loadEntitlements(this.db, b.organizationId);
    const tz = s.timeZone;
    const f = formatInZone(b.startsAt, tz);
    const localDate = dateFromDb(b.localDate);
    const cutoff = s.changeCutoffHours ? b.startsAt.getTime() - s.changeCutoffHours * 3_600_000 : b.startsAt.getTime();
    const canChange = b.status === 'confirmed' && Date.now() < (b.dateOnly ? b.endsAt.getTime() : cutoff);
    const manageUrl = this.tokens.url(b.id, b.manageNonce);
    const instructions = [
      ...(cleanInstructions(s.privateInstructions) ? [{ title: 'Instructions', html: cleanInstructions(s.privateInstructions)! }] : []),
      ...(cleanInstructions(b.service.instructions) ? [{ title: b.service.name, html: cleanInstructions(b.service.instructions)! }] : []),
    ];
    const where =
      b.service.locationType === 'online' ? b.service.meetingUrl || 'Online meeting' : b.service.locationType === 'phone' ? 'Phone call' : b.service.address || s.businessName;
    const calendar = calendarFor({
      uid: `client-booking-${b.id}@bytebuntech.com`,
      sequence: b.sequence,
      title: `${b.service.name} · ${s.businessName}`,
      description: [
        `${b.service.name} with ${s.businessName}.`,
        ...(b.service.locationType === 'online' && b.service.meetingUrl ? [`Join: ${b.service.meetingUrl}`] : []),
        `Reschedule or cancel: ${manageUrl}`,
      ].join('\n'),
      location: where,
      start: b.startsAt,
      end: b.endsAt,
      allDay: b.dateOnly ? localDate : null,
    });
    return {
      slug: s.slug,
      v: {
        bookingId: b.id,
        brand: { businessName: s.businessName, primaryColor: s.primaryColor, poweredBy: !hasFeature(ents, 'bookings.full_branding'), replyTo: s.contactEmail, phone: s.phone },
        customerName: b.customer.name,
        customerEmail: b.customer.email,
        customerPhone: b.customer.phone,
        serviceName: b.service.name,
        dateLabel: b.dateOnly ? formatLocalDate(localDate) : f.date,
        timeLabel: b.dateOnly ? null : f.time,
        zone: f.zone,
        location: { type: b.service.locationType, address: b.service.address, meetingUrl: b.service.meetingUrl },
        // Attendance: only in-person appointments are checked in at a front desk.
        checkIn:
          b.service.locationType === 'in_person' && b.status === 'confirmed'
            ? { code: formatCheckInCode(b.checkInCode), qrPng: await checkInQrPng(checkInUrl(this.cfg.clients.bookingsUrl, b.checkInCode)) }
            : null,
        instructions,
        manageUrl,
        canChange,
        calendar,
        note: b.note,
      },
    };
  }
}
