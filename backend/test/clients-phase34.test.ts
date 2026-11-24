// Reminders (email / WhatsApp, plan rules, replaced on reschedule), no-show follow-up, and client
// management from the admin site (plan changes, deactivate / reactivate, delete / restore /
// purge, audit log).
import { newCheckInCode } from '../src/clients/booking/check-in';
import './env';
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import request from 'supertest';
import { outbox } from '../src/auth/mailer';
import { BookingNotifications, whatsappOutbox } from '../src/clients/booking/notifications';
import { RetentionJob } from '../src/clients/booking/retention';
import { addDays, dateToDb, fromLocal, todayIn } from '../src/clients/booking/time';
import { createClientsDb } from '../src/clients/clients-db';
import { syncEntitlements } from '../src/clients/entitlements';
import { config } from '../src/config/config';
import { browser, enroll, JOSUE, resetClients, resetState, startApp, type TestApp, waitForMail } from './helpers';

const ACCOUNTS = 'accounts.localhost:5173';
const BOOKINGS = 'bookings.localhost:5173';
let t: TestApp;
const db = createClientsDb(config);
let notifications: BookingNotifications;

before(async () => {
  t = await startApp();
  notifications = t.app.get(BookingNotifications);
});
after(async () => {
  await db.$disconnect();
  await t?.close();
});
beforeEach(async () => {
  await resetState(t.prisma);
  await resetClients(db);
  whatsappOutbox.length = 0;
});

function client(host = ACCOUNTS) {
  const agent = request.agent(t.server);
  const w = (r: request.Test) => r.set('Host', host).set('Origin', `http://${ACCOUNTS}`);
  return {
    get: (url: string) => w(agent.get(url)),
    post: (url: string, body?: object) => w(agent.post(url)).send(body ?? {}),
    put: (url: string, body?: object) => w(agent.put(url)).send(body ?? {}),
  };
}

async function newBusiness(email = 'owner@clinic.test') {
  const b = client();
  await b.post('/api/accounts/auth/email-otp/send-verification-otp', { email, type: 'sign-in' });
  const mail = await waitForMail((m) => [m.to].flat().includes(email) && m.subject.startsWith('Your Byte Bun sign-in code'));
  assert.equal((await b.post('/api/accounts/auth/sign-in/email-otp', { email, otp: /(\d{6})$/.exec(mail.subject)![1] })).status, 200);
  const res = await b.post('/api/client/onboarding', { firstName: 'Olivia', businessName: 'Smile Clinic', slug: 'smile-clinic', timeZone: 'America/Toronto' });
  assert.equal(res.status, 201);
  const svc = await b.post('/api/client/bookings/services', { name: 'Cleaning', durationMinutes: 30 });
  return { b, orgId: res.body.organizationId as string, serviceId: svc.body.id as number };
}

const setPlan = async (orgId: string, planCode: string) => {
  await db.subscription.update({ where: { organizationId: orgId }, data: { planCode } });
  await syncEntitlements(db, orgId);
};

/** An open slot at least `minDays` days from today. */
async function slotFrom(serviceId: number, minDays = 3) {
  const from = addDays(todayIn('America/Toronto'), minDays);
  const res = await request(t.server).get(`/api/public/bookings/smile-clinic/availability?serviceId=${serviceId}&from=${from}`).set('Host', BOOKINGS);
  const day = res.body.days.find((d: { status: string }) => d.status === 'open');
  return day.slots[0].startsAt as string;
}
const book = (serviceId: number, startsAt: string, extra: object = {}) =>
  request(t.server).post('/api/public/bookings/smile-clinic/book').set('Host', BOOKINGS).send({ serviceId, startsAt, name: 'Carl', email: 'carl@example.com', ...extra });
const mailsFor = (email: string) => outbox.filter((m) => [m.to].flat().includes(email));

describe('reminders', () => {
  it('free plan: 1 day before by email by default; custom times are refused', async () => {
    const { b, serviceId } = await newBusiness();
    const startsAt = await slotFrom(serviceId);
    assert.equal((await book(serviceId, startsAt)).status, 201);
    const rows = await db.notification.findMany({ where: { kind: 'reminder' } });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].sendAt.getTime(), new Date(startsAt).getTime() - 86_400_000);

    await notifications.flush(new Date(new Date(startsAt).getTime() - 3600_000));
    assert.ok(mailsFor('carl@example.com').some((m) => m.subject.startsWith('Reminder: Cleaning')));

    const custom = await b.put('/api/client/bookings/settings', { reminders: [{ offsetMinutes: 60, channel: 'email' }] });
    assert.equal(custom.status, 403);
    assert.equal((await b.put('/api/client/bookings/settings', { reminders: [{ offsetMinutes: 2880, channel: 'email' }, { offsetMinutes: 1440, channel: 'email' }] })).status, 200);
  });

  it('paid plan: WhatsApp reminder 1 hour before (n8n), replaced on reschedule, removed on cancel', async () => {
    const { b, orgId, serviceId } = await newBusiness();
    await setPlan(orgId, 'premium');
    const saved = await b.put('/api/client/bookings/settings', { reminders: [{ offsetMinutes: 60, channel: 'whatsapp' }, { offsetMinutes: 1440, channel: 'email' }] });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    const startsAt = await slotFrom(serviceId);
    assert.equal((await book(serviceId, startsAt, { phone: '+14165550100' })).status, 201);
    const [booking] = await b.get('/api/client/bookings/items').then((r) => r.body);
    let pending = await db.notification.findMany({ where: { kind: 'reminder', status: 'pending' }, orderBy: { sendAt: 'asc' } });
    assert.deepEqual(pending.map((p) => p.channel), ['email', 'whatsapp']);

    // Reschedule: old reminders cancelled, new ones planned for the new time.
    const later = await slotFrom(serviceId, 5);
    assert.equal((await b.post(`/api/client/bookings/items/${booking.id}/reschedule`, { startsAt: later })).status, 200);
    pending = await db.notification.findMany({ where: { kind: 'reminder', status: 'pending' } });
    assert.equal(pending.length, 2);
    assert.ok(pending.every((p) => p.sendAt < new Date(later) && p.sendAt > new Date(new Date(later).getTime() - 2 * 86_400_000)));

    await notifications.flush(new Date(new Date(later).getTime() - 30 * 60_000));
    const wa = whatsappOutbox.find((m) => m.kind === 'reminder');
    assert.ok(wa, 'WhatsApp reminder handed to n8n');
    assert.equal(wa.to, '+14165550100');
    assert.match(wa.text, /Reschedule or cancel: http/);

    // Cancel removes anything still pending.
    const third = await slotFrom(serviceId, 8);
    assert.equal((await b.post(`/api/client/bookings/items/${booking.id}/reschedule`, { startsAt: third })).status, 200);
    await b.post(`/api/client/bookings/items/${booking.id}/cancel`, { notify: false });
    assert.equal(await db.notification.count({ where: { kind: 'reminder', status: 'pending' } }), 0);
  });

  it('skips reminders already in the past (late bookings)', async () => {
    const { serviceId } = await newBusiness();
    const soon = await slotFrom(serviceId, 0);
    if (new Date(soon).getTime() - Date.now() < 86_400_000) {
      assert.equal((await book(serviceId, soon)).status, 201);
      assert.equal(await db.notification.count({ where: { kind: 'reminder' } }), 0);
    }
  });

  it('no-show: marks the booking and sends a "we missed you" email', async () => {
    const { b, orgId, serviceId } = await newBusiness();
    const date = addDays(todayIn('America/Toronto'), -1);
    const customer = await db.customer.create({ data: { organizationId: orgId, email: 'gone@x.test', name: 'Gone' } });
    const startsAt = fromLocal(date, 600, 'America/Toronto');
    const bk = await db.booking.create({ data: { organizationId: orgId, serviceId, customerId: customer.id, localDate: dateToDb(date), startsAt, endsAt: startsAt, blockedUntil: startsAt, manageNonce: 'n'.repeat(32), checkInCode: newCheckInCode() } });
    assert.equal((await b.post(`/api/client/bookings/items/${bk.id}/no-show`, { noShow: true })).status, 200);
    await notifications.flush();
    assert.ok(mailsFor('gone@x.test').some((m) => m.subject === 'We missed you at Smile Clinic'));
    assert.ok((await db.booking.findUnique({ where: { id: bk.id } }))!.noShowAt);
  });
});

describe('admin site: client management', () => {
  async function admin() {
    const a = browser(t.server);
    await enroll(a, JOSUE);
    return a;
  }

  it('lists clients and changes plans (promote / demote) with an audit trail', async () => {
    const { b, orgId } = await newBusiness();
    const a = await admin();
    const list = await a.get('/api/admin/clients');
    assert.equal(list.status, 200);
    assert.equal(list.body[0].name, 'Smile Clinic');
    assert.equal(list.body[0].plan.code, 'free');

    const up = await a.post(`/api/admin/clients/${orgId}/plan`, { planCode: 'premium', addons: ['website_chatbot'], reason: 'Signed the package' });
    assert.equal(up.status, 200, JSON.stringify(up.body));
    assert.equal((await b.get('/api/client/me')).body.business.landing, 'portal');
    const down = await a.post(`/api/admin/clients/${orgId}/plan`, { planCode: 'free', addons: [] });
    assert.equal(down.status, 200);
    assert.equal((await b.get('/api/client/me')).body.business.limits['bookings.monthly'], 100);

    const events = await a.get(`/api/admin/clients/events?organizationId=${orgId}`);
    const changes = events.body.filter((e: { type: string }) => e.type === 'plan_changed');
    assert.equal(changes.length, 2);
    assert.equal(changes[1].actor, JOSUE);
    assert.equal(changes[1].reason, 'Signed the package');
    // Client accounts never reach the admin API.
    assert.equal((await b.get('/api/admin/clients')).status, 401);
  });

  it('deactivates (signed out, page unavailable, reminders paused) and reactivates', async () => {
    const { b, orgId, serviceId } = await newBusiness();
    assert.equal((await book(serviceId, await slotFrom(serviceId))).status, 201);
    const a = await admin();
    assert.equal((await a.post(`/api/admin/clients/${orgId}/deactivate`, {})).status, 400, 'reason required');
    const off = await a.post(`/api/admin/clients/${orgId}/deactivate`, { reason: 'Unpaid invoice' });
    assert.equal(off.status, 200, JSON.stringify(off.body));
    assert.equal((await b.get('/api/client/me')).status, 401, 'signed out');
    assert.equal((await request(t.server).get('/api/public/bookings/smile-clinic').set('Host', BOOKINGS)).body.status, 'unavailable');
    assert.equal(await db.notification.count({ where: { kind: 'reminder', status: 'paused' } }), 1);
    await notifications.flush();
    assert.ok(mailsFor('owner@clinic.test').some((m) => m.subject === 'Smile Clinic is deactivated'));

    assert.equal((await a.post(`/api/admin/clients/${orgId}/reactivate`, { reason: 'Paid' })).status, 200);
    assert.equal(await db.notification.count({ where: { kind: 'reminder', status: 'pending' } }), 1);
    assert.equal((await request(t.server).get('/api/public/bookings/smile-clinic').set('Host', BOOKINGS)).body.status, 'open');
  });

  it('deletes (type the name), tells customers, restores, and purges after 30 days', async () => {
    const { orgId, serviceId } = await newBusiness();
    assert.equal((await book(serviceId, await slotFrom(serviceId))).status, 201);
    const a = await admin();
    const csv = await a.get(`/api/admin/clients/${orgId}/export.csv`);
    assert.equal(csv.status, 200);
    assert.ok(csv.text.includes('carl@example.com'));

    const wrong = await a.post(`/api/admin/clients/${orgId}/delete`, { confirmName: 'Smile', reason: 'Closed' });
    assert.equal(wrong.status, 400);
    const del = await a.post(`/api/admin/clients/${orgId}/delete`, { confirmName: 'smile clinic', reason: 'Clinic closed', notifyCustomers: true });
    assert.equal(del.status, 200, JSON.stringify(del.body));
    assert.equal(del.body.status, 'deleted');
    await notifications.flush();
    assert.ok(mailsFor('carl@example.com').some((m) => m.subject.startsWith('Booking cancelled')));

    assert.equal((await a.post(`/api/admin/clients/${orgId}/restore`, { reason: 'Changed their mind' })).status, 200);
    assert.equal((await a.get(`/api/admin/clients/${orgId}`)).body.status, 'active');

    await a.post(`/api/admin/clients/${orgId}/delete`, { confirmName: 'Smile Clinic', reason: 'Closed for good' });
    const job = t.app.get(RetentionJob);
    assert.equal((await job.run(new Date(Date.now() + 29 * 86_400_000))).purged, 0);
    assert.equal((await job.run(new Date(Date.now() + 31 * 86_400_000))).purged, 1);
    assert.equal(await db.organization.count(), 0);
    assert.equal(await db.booking.count(), 0);
    assert.equal(await db.user.count({ where: { email: 'owner@clinic.test' } }), 0);
    assert.ok((await db.billingEvent.findMany({ where: { organizationId: orgId } })).some((e) => e.type === 'purged'), 'audit trail kept');
    assert.equal((await a.get(`/api/admin/clients/${orgId}`)).status, 404);
  });
});
