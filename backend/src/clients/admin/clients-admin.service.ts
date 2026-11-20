// Client management for the Byte Bun admin site: plans (promote / demote), deactivate /
// reactivate, delete (30-day soft delete) / restore, the permanent purge, and the audit log
// (billing.events: who, when, reason, for every change).
//
// It reads and writes the clients database through CLIENTS_ADMIN_DB: the admin site's own,
// limited login when CLIENTS_ADMIN_DB_USER is set (docs/CLIENTS-DB-ADMIN-USER.sql lists exactly
// what it may touch), else the app's. Cancelling customers' bookings goes through the booking
// engine (the app's login), so customers get the usual emails.
import { Inject, Injectable } from '@nestjs/common';
import { ApiError } from '../../common/api-error';
import { APP_CONFIG, type AppConfig } from '../../config/config';
import { logger } from '../../logging/logger';
import { BookingEngine } from '../booking/booking-engine';
import { BookingNotifications } from '../booking/notifications';
import { type ClientsDb } from '../clients-db';
import { syncEntitlements } from '../entitlements';

export const CLIENTS_ADMIN_DB = Symbol('CLIENTS_ADMIN_DB');
export const DELETE_GRACE_DAYS = 30;

const notFound = () => new ApiError(404, { error: 'not_found', message: 'That client does not exist.' });

export interface AdminActor {
  email: string;
}

@Injectable()
export class ClientsAdminService {
  constructor(
    @Inject(CLIENTS_ADMIN_DB) private readonly db: ClientsDb,
    private readonly engine: BookingEngine,
    private readonly notifications: BookingNotifications,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  /** Owner-level admins may delete. OWNER_ADMIN_EMAILS, or every admin when it isn't set. */
  isOwnerAdmin(email: string) {
    const list = this.cfg.clients.ownerAdminEmails;
    return !list.length || list.includes(email.toLowerCase());
  }

  private async org(id: string) {
    const org = await this.db.organization.findUnique({ where: { id } });
    if (!org) throw notFound();
    const status = await this.db.accountStatus.findUnique({ where: { organizationId: id } });
    if (status?.status === 'purged') throw notFound();
    return { org, status: status?.status ?? 'active', statusRow: status };
  }

  private event(organizationId: string, type: string, actor: AdminActor, reason: string | null, data: object = {}) {
    return this.db.billingEvent.create({ data: { organizationId, type, actor: actor.email, reason, data } });
  }

  /** Every member is signed out (they can't get back in while the business isn't active). */
  private async signOutMembers(organizationId: string) {
    const members = await this.db.member.findMany({ where: { organizationId }, select: { userId: true } });
    const { count } = await this.db.session.deleteMany({ where: { userId: { in: members.map((m) => m.userId) } } });
    return count;
  }

  private pauseNotifications(organizationId: string) {
    return this.db.notification.updateMany({ where: { organizationId, status: 'pending' }, data: { status: 'paused' } });
  }

  /** Paused messages go out again; reminders whose time has passed are skipped. */
  private async resumeNotifications(organizationId: string) {
    const now = new Date();
    await this.db.notification.updateMany({ where: { organizationId, status: 'paused', kind: 'reminder', sendAt: { lte: now } }, data: { status: 'skipped' } });
    await this.db.notification.updateMany({ where: { organizationId, status: 'paused' }, data: { status: 'pending' } });
  }

  async list(filter: { q?: string; status?: string; plan?: string }) {
    const [orgs, statuses, subs, settings, owners] = await Promise.all([
      this.db.organization.findMany({ orderBy: { createdAt: 'desc' }, take: 1000 }),
      this.db.accountStatus.findMany(),
      this.db.subscription.findMany({ include: { plan: { select: { name: true } }, addons: { select: { addonCode: true } } } }),
      this.db.bookingSettings.findMany({ select: { organizationId: true, slug: true, timeZone: true } }),
      this.db.member.findMany({ where: { role: 'owner' }, include: { user: { select: { email: true, name: true } } }, orderBy: { createdAt: 'asc' } }),
    ]);
    const by = <T extends { organizationId: string }>(rows: T[]) => new Map(rows.map((r) => [r.organizationId, r]));
    const st = by(statuses);
    const sb = by(subs);
    const se = by(settings);
    const q = filter.q?.trim().toLowerCase();
    return orgs
      .map((o) => {
        const sub = sb.get(o.id);
        const own = owners.filter((m) => m.organizationId === o.id);
        return {
          id: o.id,
          name: o.name,
          slug: se.get(o.id)?.slug ?? o.slug,
          createdAt: o.createdAt,
          status: st.get(o.id)?.status ?? 'active',
          deleteAfter: st.get(o.id)?.deleteAfter ?? null,
          plan: sub ? { code: sub.planCode, name: sub.plan.name, status: sub.status } : null,
          addons: sub?.addons.map((a) => a.addonCode) ?? [],
          owners: own.map((m) => ({ email: m.user.email, name: m.user.name })),
          publicUrl: se.get(o.id) ? `${this.cfg.clients.bookingsUrl}/${se.get(o.id)!.slug}` : null,
        };
      })
      .filter((c) => c.status !== 'purged')
      .filter((c) => !filter.status || c.status === filter.status)
      .filter((c) => !filter.plan || c.plan?.code === filter.plan)
      .filter((c) => !q || c.name.toLowerCase().includes(q) || c.slug.includes(q) || c.owners.some((o) => o.email.includes(q)));
  }

  async catalog() {
    const [plans, addons] = await Promise.all([this.db.plan.findMany({ orderBy: { sort: 'asc' } }), this.db.addon.findMany({ orderBy: { code: 'asc' } })]);
    return { plans, addons };
  }

  async detail(id: string) {
    const { org, status, statusRow } = await this.org(id);
    const now = new Date();
    const monthAgo = new Date(now.getTime() - 30 * 86_400_000);
    const [sub, entitlements, members, settings, events, bookings30, upcoming, services] = await Promise.all([
      this.db.subscription.findUnique({ where: { organizationId: id }, include: { plan: true, addons: { include: { addon: true } } } }),
      this.db.entitlement.findMany({ where: { organizationId: id }, orderBy: { key: 'asc' } }),
      this.db.member.findMany({ where: { organizationId: id }, include: { user: { select: { email: true, name: true } } }, orderBy: { createdAt: 'asc' } }),
      this.db.bookingSettings.findUnique({ where: { organizationId: id } }),
      this.db.billingEvent.findMany({ where: { organizationId: id }, orderBy: { createdAt: 'desc' }, take: 100 }),
      this.db.booking.count({ where: { organizationId: id, createdAt: { gte: monthAgo } } }),
      this.db.booking.count({ where: { organizationId: id, status: 'confirmed', startsAt: { gt: now } } }),
      this.db.service.count({ where: { organizationId: id, active: true } }),
    ]);
    return {
      id: org.id,
      name: org.name,
      createdAt: org.createdAt,
      status,
      statusReason: statusRow?.reason ?? null,
      statusChangedAt: statusRow?.changedAt ?? null,
      deleteAfter: statusRow?.deleteAfter ?? null,
      subscription: sub && { planCode: sub.planCode, planName: sub.plan.name, status: sub.status, currency: sub.currency, startedAt: sub.startedAt, addons: sub.addons.map((a) => ({ code: a.addonCode, name: a.addon.name })) },
      entitlements: entitlements.map((e) => ({ key: e.key, value: e.value })),
      members: members.map((m) => ({ email: m.user.email, name: m.user.name, role: m.role, since: m.createdAt })),
      booking: settings && { slug: settings.slug, timeZone: settings.timeZone, publicUrl: `${this.cfg.clients.bookingsUrl}/${settings.slug}`, phone: settings.phone, contactEmail: settings.contactEmail },
      stats: { bookingsLast30Days: bookings30, upcoming, activeServices: services },
      events,
    };
  }

  async events(organizationId?: string, limit = 200) {
    const rows = await this.db.billingEvent.findMany({ where: organizationId ? { organizationId } : {}, orderBy: { createdAt: 'desc' }, take: Math.min(Math.max(limit, 1), 500) });
    const names = new Map((await this.db.organization.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.organizationId))] } }, select: { id: true, name: true } })).map((o) => [o.id, o.name]));
    return rows.map((r) => ({ ...r, organizationName: names.get(r.organizationId) ?? null }));
  }

  /** Promote / demote: the plan and its add-ons. Entitlements follow right away. */
  async changePlan(id: string, body: { planCode: string; addons: string[]; reason: string | null }, actor: AdminActor) {
    const { status } = await this.org(id);
    if (status === 'deleted') throw new ApiError(409, { error: 'deleted', message: 'Restore the client before changing its plan.' });
    const plan = await this.db.plan.findUnique({ where: { code: body.planCode } });
    if (!plan || !plan.active) throw new ApiError(400, { error: 'validation_failed', message: 'Choose a plan.', fields: { planCode: 'Unknown plan.' } });
    const addons = [...new Set(body.addons)];
    const known = await this.db.addon.findMany({ where: { code: { in: addons }, active: true } });
    if (known.length !== addons.length) throw new ApiError(400, { error: 'validation_failed', message: 'Unknown add-on.', fields: { addons: 'Unknown add-on.' } });
    const before = await this.db.subscription.findUnique({ where: { organizationId: id }, include: { addons: true } });
    await this.db.$transaction(async (tx) => {
      const sub = await tx.subscription.upsert({
        where: { organizationId: id },
        create: { organizationId: id, planCode: plan.code, status: status === 'active' ? 'active' : 'paused' },
        update: { planCode: plan.code },
      });
      await tx.subscriptionAddon.deleteMany({ where: { subscriptionId: sub.id } });
      if (addons.length) await tx.subscriptionAddon.createMany({ data: addons.map((addonCode) => ({ subscriptionId: sub.id, addonCode })) });
      await tx.billingEvent.create({
        data: {
          organizationId: id,
          type: 'plan_changed',
          actor: actor.email,
          reason: body.reason,
          data: { from: before?.planCode ?? null, to: plan.code, addonsFrom: before?.addons.map((a) => a.addonCode) ?? [], addonsTo: addons },
        },
      });
      await syncEntitlements(tx, id);
    });
    logger.info({ org: id, plan: plan.code, by: actor.email }, 'Client plan changed');
    return this.detail(id);
  }

  async deactivate(id: string, body: { reason: string; notifyOwner: boolean }, actor: AdminActor) {
    const { status } = await this.org(id);
    if (status !== 'active') throw new ApiError(409, { error: 'not_active', message: `This client is ${status}.` });
    await this.db.accountStatus.upsert({
      where: { organizationId: id },
      create: { organizationId: id, status: 'deactivated', reason: body.reason, changedBy: actor.email },
      update: { status: 'deactivated', reason: body.reason, changedBy: actor.email, changedAt: new Date(), deleteAfter: null },
    });
    await this.db.subscription.updateMany({ where: { organizationId: id }, data: { status: 'paused' } });
    await this.pauseNotifications(id);
    const sessions = await this.signOutMembers(id);
    await this.event(id, 'deactivated', actor, body.reason, { sessionsEnded: sessions });
    if (body.notifyOwner) await this.notifications.queueAccountNotice(this.db, id, 'deactivated', { reason: body.reason });
    this.notifications.kick();
    logger.warn({ org: id, by: actor.email }, 'Client deactivated');
    return this.detail(id);
  }

  async reactivate(id: string, body: { reason: string | null; notifyOwner: boolean }, actor: AdminActor) {
    const { status } = await this.org(id);
    if (status !== 'deactivated') throw new ApiError(409, { error: 'not_deactivated', message: status === 'deleted' ? 'Use Restore for a deleted client.' : 'This client is already active.' });
    await this.db.accountStatus.update({ where: { organizationId: id }, data: { status: 'active', reason: body.reason, changedBy: actor.email, changedAt: new Date() } });
    await this.db.subscription.updateMany({ where: { organizationId: id }, data: { status: 'active' } });
    await this.resumeNotifications(id);
    await this.event(id, 'reactivated', actor, body.reason);
    if (body.notifyOwner) await this.notifications.queueAccountNotice(this.db, id, 'reactivated', { reason: body.reason });
    this.notifications.kick();
    return this.detail(id);
  }

  /** Soft delete: blocked at once, data removed for good after DELETE_GRACE_DAYS. Owner-level admins only. */
  async remove(id: string, body: { confirmName: string; reason: string; notifyCustomers: boolean; notifyOwner: boolean }, actor: AdminActor) {
    if (!this.isOwnerAdmin(actor.email)) throw new ApiError(403, { error: 'forbidden', message: 'Only owner-level admins can delete clients.' });
    const { org, status } = await this.org(id);
    if (status === 'deleted') throw new ApiError(409, { error: 'deleted', message: 'This client is already deleted.' });
    const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase();
    if (norm(body.confirmName) !== norm(org.name)) {
      throw new ApiError(400, { error: 'validation_failed', message: 'Type the business name exactly to confirm.', fields: { confirmName: `Type “${org.name}” to confirm.` } });
    }
    const deleteAfter = new Date(Date.now() + DELETE_GRACE_DAYS * 86_400_000);
    await this.db.accountStatus.upsert({
      where: { organizationId: id },
      create: { organizationId: id, status: 'deleted', reason: body.reason, changedBy: actor.email, deleteAfter },
      update: { status: 'deleted', reason: body.reason, changedBy: actor.email, changedAt: new Date(), deleteAfter },
    });
    await this.db.subscription.updateMany({ where: { organizationId: id }, data: { status: 'cancelled' } });
    await this.pauseNotifications(id);
    const sessions = await this.signOutMembers(id);
    let cancelled = 0;
    if (body.notifyCustomers) {
      const upcoming = await this.db.booking.findMany({ where: { organizationId: id, status: 'confirmed', endsAt: { gt: new Date() } }, select: { id: true } });
      for (const b of upcoming) {
        await this.engine.cancel(id, b.id, { by: 'system', reason: `${org.name} has stopped taking online bookings.`, notifyCustomer: true });
        cancelled++;
      }
    }
    await this.event(id, 'deleted', actor, body.reason, { deleteAfter: deleteAfter.toISOString(), customersNotified: cancelled, sessionsEnded: sessions });
    if (body.notifyOwner) await this.notifications.queueAccountNotice(this.db, id, 'deleted', { reason: body.reason, deleteAfter: deleteAfter.toISOString().slice(0, 10) });
    this.notifications.kick();
    logger.warn({ org: id, by: actor.email, deleteAfter }, 'Client deleted (soft)');
    return this.detail(id);
  }

  /** Undo a delete during the grace period. The subscription starts again on the same plan. */
  async restore(id: string, body: { reason: string | null }, actor: AdminActor) {
    const { status, statusRow } = await this.org(id);
    if (status !== 'deleted' || !statusRow?.deleteAfter || statusRow.deleteAfter <= new Date()) throw new ApiError(409, { error: 'not_restorable', message: 'Only a deleted client within its 30 days can be restored.' });
    await this.db.accountStatus.update({ where: { organizationId: id }, data: { status: 'active', reason: body.reason, changedBy: actor.email, changedAt: new Date(), deleteAfter: null } });
    await this.db.subscription.updateMany({ where: { organizationId: id }, data: { status: 'active' } });
    await syncEntitlements(this.db, id);
    await this.resumeNotifications(id);
    await this.event(id, 'restored', actor, body.reason);
    this.notifications.kick();
    return this.detail(id);
  }

  /** Permanent removal of clients deleted more than DELETE_GRACE_DAYS ago (retention job, hourly). */
  async purgeExpired(now = new Date()) {
    const due = await this.db.accountStatus.findMany({ where: { status: 'deleted', deleteAfter: { lte: now } } });
    for (const { organizationId: id } of due) {
      const members = await this.db.member.findMany({ where: { organizationId: id }, select: { userId: true } });
      await this.db.$transaction(async (tx) => {
        await tx.notification.deleteMany({ where: { organizationId: id } });
        await tx.booking.deleteMany({ where: { organizationId: id } });
        await tx.customer.deleteMany({ where: { organizationId: id } });
        await tx.service.deleteMany({ where: { organizationId: id } });
        await tx.blockedDate.deleteMany({ where: { organizationId: id } });
        await tx.breakPeriod.deleteMany({ where: { organizationId: id } });
        await tx.weeklyHours.deleteMany({ where: { organizationId: id } });
        await tx.bookingSettings.deleteMany({ where: { organizationId: id } });
        await tx.entitlement.deleteMany({ where: { organizationId: id } });
        await tx.subscription.deleteMany({ where: { organizationId: id } }); // add-ons cascade
        await tx.organization.delete({ where: { id } }); // members and invitations cascade
        // People who belonged only to this business have nothing left: remove their account too.
        await tx.user.deleteMany({ where: { id: { in: members.map((m) => m.userId) }, members: { none: {} } } });
        await tx.accountStatus.update({ where: { organizationId: id }, data: { status: 'purged', changedAt: now, changedBy: 'system' } });
        // The audit trail (billing.events) is kept.
        await tx.billingEvent.create({ data: { organizationId: id, type: 'purged', actor: 'system', data: {} } });
      });
      logger.warn({ org: id }, 'Client permanently removed');
    }
    return due.length;
  }
}
