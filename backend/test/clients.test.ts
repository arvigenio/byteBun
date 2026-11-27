// Client apps: sign-in (accounts), new business, entitlement + role checks, Bookings settings,
// the public booking page, double-booking protection, limits, emails, and the manage link.
import { newCheckInCode } from '../src/clients/booking/check-in';
import './env';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import sharp from 'sharp';
import { PaymentReviewJob } from '../src/clients/booking/event-payments';
import request from 'supertest';
import { BookingNotifications } from '../src/clients/booking/notifications';
import { EventRetentionJob } from '../src/clients/booking/event-retention';
import { RetentionJob } from '../src/clients/booking/retention';
import { addDays, dateToDb, fromLocal, todayIn, toLocal } from '../src/clients/booking/time';
import { syncEntitlements } from '../src/clients/entitlements';
import { createClientsDb } from '../src/clients/clients-db';
import { outbox } from '../src/auth/mailer';
import { config } from '../src/config/config';
import { resetClients, resetState, sleep, startApp, type TestApp, waitForMail } from './helpers';

const ACCOUNTS = 'accounts.localhost:5173';
const BOOKINGS = 'bookings.localhost:5173';
const ORIGIN = 'http://accounts.localhost:5173';

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
});

/** A browser on the client hosts (cookies kept). */
function client(host = ACCOUNTS) {
  const agent = request.agent(t.server);
  const w = (r: request.Test) => r.set('Host', host).set('Origin', ORIGIN);
  return {
    get: (url: string) => w(agent.get(url)),
    post: (url: string, body?: object) => w(agent.post(url)).send(body ?? {}),
    put: (url: string, body?: object) => w(agent.put(url)).send(body ?? {}),
    patch: (url: string, body?: object) => w(agent.patch(url)).send(body ?? {}),
    delete: (url: string) => w(agent.delete(url)),
    /** Multipart: chain .field() and .attach(). */
    multipart: (method: 'post' | 'patch', url: string) => w(agent[method](url)),
  };
}
type Client = ReturnType<typeof client>;

async function signIn(email: string): Promise<Client> {
  const b = client();
  const sent = await b.post('/api/accounts/auth/email-otp/send-verification-otp', { email, type: 'sign-in' });
  assert.equal(sent.status, 200, JSON.stringify(sent.body));
  const mail = await waitForMail((m) => [m.to].flat().includes(email) && m.subject.startsWith('Your Byte Bun sign-in code'));
  const otp = /(\d{6})$/.exec(mail.subject)![1];
  const res = await b.post('/api/accounts/auth/sign-in/email-otp', { email, otp });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return b;
}

async function newBusiness(email = 'owner@clinic.test', slug = 'smile-clinic') {
  const b = await signIn(email);
  const res = await b.post('/api/client/onboarding', { firstName: 'Olivia', lastName: 'Owner', businessName: 'Smile Clinic', slug, timeZone: 'America/Toronto' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return { b, orgId: res.body.organizationId as string };
}

async function addService(b: Client, body: object = {}) {
  const res = await b.post('/api/client/bookings/services', { name: 'Cleaning', durationMinutes: 30, bufferMinutes: 0, locationType: 'in_person', address: '1 Main St, Toronto', ...body });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.id as number;
}

async function openSlots(slug: string, serviceId: number) {
  const res = await request(t.server).get(`/api/public/bookings/${slug}/availability?serviceId=${serviceId}`).set('Host', BOOKINGS);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return (res.body.days as { date: string; status: string; slots: { startsAt: string; remaining: number }[]; spotsLeft: number | null }[]).filter((d) => d.status === 'open');
}

/** The first open day after today: today may have few slots left, depending on when tests run. */
async function openDay(slug: string, serviceId: number) {
  const today = todayIn('America/Toronto');
  const days = await openSlots(slug, serviceId);
  return days.find((d) => d.date > today) ?? days[0];
}

const book = (slug: string, body: object) =>
  request(t.server)
    .post(`/api/public/bookings/${slug}/book`)
    .set('Host', BOOKINGS)
    .send({ name: 'Carl Customer', email: 'carl@example.com', ...body });

const mailsFor = (email: string) => outbox.filter((m) => [m.to].flat().includes(email));

describe('accounts', () => {
  it('signs up with an email code, creates a business on the free plan, and lands in Bookings', async () => {
    const anon = client();
    assert.equal((await anon.get('/api/client/me')).status, 401);

    const b = await signIn('new@clinic.test');
    const before = await b.get('/api/client/me');
    assert.equal(before.status, 200);
    assert.equal(before.body.business, null);
    // Bookings API needs a business first.
    assert.equal((await b.get('/api/client/bookings/overview')).body.error, 'no_business');

    const res = await b.post('/api/client/onboarding', { firstName: 'Nina', lastName: 'Reyes', businessName: 'Nina Dental', slug: 'nina-dental', timeZone: 'America/Vancouver' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const me = await b.get('/api/client/me');
    assert.equal(me.body.business.name, 'Nina Dental');
    assert.equal(me.body.business.role, 'owner');
    assert.equal(me.body.business.plan.code, 'free');
    assert.equal(me.body.business.landing, 'bookings');
    assert.equal(me.body.business.limits['bookings.monthly'], 100);
    assert.equal(me.body.business.limits['bookings.services'], 5);
    assert.equal(me.body.business.publicUrl, 'http://bookings.localhost:5173/nina-dental');
    assert.equal(me.body.user.name, 'Nina Reyes');
  });

  it('refuses reserved and taken booking links', async () => {
    const b = await signIn('a@clinic.test');
    const reserved = await b.post('/api/client/onboarding', { firstName: 'A', businessName: 'App', slug: 'manage', timeZone: 'UTC' });
    assert.equal(reserved.status, 400);
    assert.ok(reserved.body.fields.slug);
    await newBusiness('owner@clinic.test', 'taken-link');
    const taken = await b.post('/api/client/onboarding', { firstName: 'A', businessName: 'Other', slug: 'taken-link', timeZone: 'UTC' });
    assert.equal(taken.status, 409);
  });

  it('only exposes the sign-in endpoints of Better Auth to browsers', async () => {
    const b = await signIn('x@clinic.test');
    const res = await b.post('/api/accounts/auth/organization/create', { name: 'Hack', slug: 'hack-co' });
    assert.equal(res.status, 404);
  });
});

describe('entitlements and roles (checked by the API)', () => {
  it('blocks staff from settings, and everyone when the plan lacks the app', async () => {
    const { b, orgId } = await newBusiness();
    // Invite staff and accept.
    const inv = await b.post('/api/client/team/invitations', { email: 'sam@clinic.test', role: 'staff' });
    assert.equal(inv.status, 201, JSON.stringify(inv.body));
    const invMail = await waitForMail((m) => [m.to].flat().includes('sam@clinic.test') && /invite\//.test(m.text));
    const invId = /invite\/([^\s)]+)/.exec(invMail.text)![1];
    const staff = await signIn('sam@clinic.test');
    const accept = await staff.post(`/api/client/invitations/${invId}/accept`);
    assert.equal(accept.status, 200, JSON.stringify(accept.body));
    const me = await staff.get('/api/client/me');
    assert.equal(me.body.business.role, 'staff');

    assert.equal((await staff.get('/api/client/bookings/items')).status, 200);
    const denied = await staff.put('/api/client/bookings/settings', { phone: '555' });
    assert.equal(denied.status, 403);
    assert.equal(denied.body.error, 'forbidden');
    assert.equal((await staff.post('/api/client/team/invitations', { email: 'z@clinic.test', role: 'staff' })).status, 403);

    // Remove the Bookings app from the plan: every Bookings route answers not_in_plan.
    await db.entitlement.delete({ where: { organizationId_key: { organizationId: orgId, key: 'app:bookings' } } });
    const noApp = await b.get('/api/client/bookings/overview');
    assert.equal(noApp.status, 403);
    assert.equal(noApp.body.error, 'not_in_plan');
  });

  it('keeps the last owner, and admins cannot touch owners', async () => {
    const { b } = await newBusiness();
    const team = await b.get('/api/client/team');
    const ownerId = team.body.members[0].id;
    const demote = await b.patch(`/api/client/team/members/${ownerId}`, { role: 'staff' });
    assert.equal(demote.status, 409);
    assert.equal(demote.body.error, 'last_owner');
  });

  it('blocks a deactivated business everywhere', async () => {
    const { b, orgId } = await newBusiness();
    await addService(b);
    await db.accountStatus.create({ data: { organizationId: orgId, status: 'deactivated', reason: 'test' } });
    const api = await b.get('/api/client/bookings/overview');
    assert.equal(api.status, 403);
    assert.equal(api.body.error, 'account_unavailable');
    const page = await request(t.server).get('/api/public/bookings/smile-clinic').set('Host', BOOKINGS);
    assert.equal(page.body.status, 'unavailable');
    assert.deepEqual(page.body.services, []);
  });
});

describe('bookings', () => {
  it('shows only public details on the booking page', async () => {
    const { b } = await newBusiness();
    await addService(b, { name: 'Video consult', locationType: 'online', meetingUrl: 'https://meet.example.com/secret-room', instructions: '<p>Gate code 4321</p>' });
    await b.put('/api/client/bookings/settings', { privateInstructions: '<p>Park at the back</p>', pageInstructions: '<p>Please <strong>arrive 5 minutes early</strong>.</p><script>alert(1)</script><img src=x onerror=alert(1)>' });
    const page = await request(t.server).get('/api/public/bookings/smile-clinic').set('Host', BOOKINGS);
    assert.equal(page.status, 200);
    const text = JSON.stringify(page.body);
    assert.ok(!text.includes('secret-room'));
    assert.ok(!text.includes('4321'));
    assert.ok(!text.includes('Park at the back'));
    assert.equal(page.body.business.instructions, '<p>Please <strong>arrive 5 minutes early</strong>.</p>');
    assert.equal(page.body.branding.poweredBy, true);
  });

  it('books a slot, emails the customer (with private details) and the owner, and frees it on cancel', async () => {
    const { b } = await newBusiness();
    const serviceId = await addService(b, { instructions: '<p>Gate code <strong>4321</strong></p>' });
    const day = await openDay('smile-clinic', serviceId);
    assert.ok(day, 'an open day');
    const slot = day.slots[0].startsAt;

    const res = await book('smile-clinic', { serviceId, startsAt: slot });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    await notifications.flush();
    const confirm = mailsFor('carl@example.com').find((m) => m.subject.startsWith('Booking confirmed'));
    assert.ok(confirm, 'confirmation sent');
    assert.ok(confirm.text.includes('4321'), 'private instructions in the email');
    assert.ok(confirm.attachments?.[0].content.includes('BEGIN:VEVENT'));
    assert.ok(/bookings\.localhost:5173\/manage#t=/.test(confirm.text));
    assert.ok(mailsFor('owner@clinic.test').some((m) => m.subject.startsWith('New booking')));

    // The slot is full now (1 booker per slot).
    const again = await book('smile-clinic', { serviceId, startsAt: slot, email: 'dana@example.com', name: 'Dana' });
    assert.equal(again.status, 409);
    assert.equal(again.body.error, 'slot_taken');

    // Owner cancels: the customer is told, the slot is free again.
    const list = await b.get('/api/client/bookings/items');
    assert.equal(list.body.length, 1);
    const cancel = await b.post(`/api/client/bookings/items/${list.body[0].id}/cancel`, { reason: 'Dentist is sick', notify: true });
    assert.equal(cancel.status, 200);
    await notifications.flush();
    assert.ok(mailsFor('carl@example.com').some((m) => m.subject.startsWith('Booking cancelled') && m.text.includes('Dentist is sick')));
    const after = await book('smile-clinic', { serviceId, startsAt: slot, email: 'dana@example.com', name: 'Dana' });
    assert.equal(after.status, 201);
  });

  it('never double-books the last place when two people book at once', async () => {
    const { b } = await newBusiness();
    const serviceId = await addService(b);
    const day = await openDay('smile-clinic', serviceId);
    const slot = day.slots[0].startsAt;
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) => book('smile-clinic', { serviceId, startsAt: slot, email: `p${i}@example.com`, name: `Person ${i}` })),
    );
    const statuses = results.map((r) => r.status).sort();
    assert.deepEqual(statuses, [201, 409, 409, 409, 409, 409]);
    assert.equal(await db.booking.count({ where: { status: 'confirmed' } }), 1);
  });

  it('holds several bookers per slot and respects the daily maximum', async () => {
    const { b } = await newBusiness();
    const serviceId = await addService(b);
    assert.equal((await b.put('/api/client/bookings/settings', { bookersPerSlot: 2, maxPerDay: 3 })).status, 200);
    const day = await openDay('smile-clinic', serviceId);
    const [s1, s2] = day.slots;
    assert.equal(s1.remaining, 2);
    assert.equal((await book('smile-clinic', { serviceId, startsAt: s1.startsAt, email: 'a@x.test' })).status, 201);
    assert.equal((await book('smile-clinic', { serviceId, startsAt: s1.startsAt, email: 'b@x.test' })).status, 201);
    assert.equal((await book('smile-clinic', { serviceId, startsAt: s1.startsAt, email: 'c@x.test' })).status, 409);
    assert.equal((await book('smile-clinic', { serviceId, startsAt: s2.startsAt, email: 'c@x.test' })).status, 201);
    // Day is now at 3 = max.
    const days = await openSlots('smile-clinic', serviceId);
    assert.ok(!days.some((d) => d.date === day.date));
  });

  it('date-only mode: customers pick a day and see spots left', async () => {
    const { b } = await newBusiness();
    const serviceId = await addService(b);
    await b.put('/api/client/bookings/settings', { mode: 'date', maxPerDay: 2 });
    const day = await openDay('smile-clinic', serviceId);
    assert.equal(day.spotsLeft, 2);
    assert.equal((await book('smile-clinic', { serviceId, date: day.date })).status, 201);
    const [again] = (await openSlots('smile-clinic', serviceId)).filter((d) => d.date === day.date);
    assert.equal(again.spotsLeft, 1);
  });

  it('warns before blocking a date with bookings, then cancels them with notice', async () => {
    const { b } = await newBusiness();
    const serviceId = await addService(b);
    const day = await openDay('smile-clinic', serviceId);
    assert.equal((await book('smile-clinic', { serviceId, startsAt: day.slots[0].startsAt })).status, 201);
    const ask = await b.post('/api/client/bookings/blocked-dates', { startDate: day.date, reason: 'Holiday' });
    assert.equal(ask.status, 409);
    assert.equal(ask.body.conflicts.length, 1);
    const done = await b.post('/api/client/bookings/blocked-dates', { startDate: day.date, reason: 'Holiday', existing: 'cancel' });
    assert.equal(done.status, 201, JSON.stringify(done.body));
    assert.equal(done.body.cancelled, 1);
    assert.ok(!(await openSlots('smile-clinic', serviceId)).some((d) => d.date === day.date));
  });

  it('blocks a time window on a date: only those slots go, and only overlapping bookings conflict', async () => {
    const { b } = await newBusiness();
    const serviceId = await addService(b);
    // A day with at least 4 slots (late in the day, today may have fewer).
    const day = (await openSlots('smile-clinic', serviceId)).find((d) => d.slots.length >= 4)!;
    const minuteOf = (iso: string) => toLocal(new Date(iso), 'America/Toronto').minute;
    const [first, second, , fourth] = day.slots.map((s) => s.startsAt);
    assert.equal((await book('smile-clinic', { serviceId, startsAt: fourth })).status, 201);
    // Block the first two slots (30 min each): the booking at the fourth slot doesn't overlap.
    const window = { startMinute: minuteOf(first), endMinute: minuteOf(second) + 30 };
    const done = await b.post('/api/client/bookings/blocked-dates', { startDate: day.date, ...window, reason: 'Staff meeting' });
    assert.equal(done.status, 201, JSON.stringify(done.body));
    assert.equal(done.body.startMinute, window.startMinute);
    const [after] = (await openSlots('smile-clinic', serviceId)).filter((d) => d.date === day.date);
    const left = after.slots.map((s) => s.startsAt);
    assert.ok(!left.includes(first) && !left.includes(second), 'blocked slots gone');
    assert.ok(left.length >= 1, 'the rest of the day stays open');
    assert.equal((await book('smile-clinic', { serviceId, startsAt: first })).body.error, 'unavailable');
    // A window over the booked slot asks first.
    const ask = await b.post('/api/client/bookings/blocked-dates', { startDate: day.date, startMinute: minuteOf(fourth), endMinute: minuteOf(fourth) + 30 });
    assert.equal(ask.status, 409);
    assert.equal(ask.body.conflicts.length, 1);
    const bad = await b.post('/api/client/bookings/blocked-dates', { startDate: day.date, startMinute: 600 });
    assert.equal(bad.status, 400);
  });

  it('blocks time off for one service only', async () => {
    const { b } = await newBusiness();
    const cleaning = await addService(b, { name: 'Cleaning' });
    const whitening = await addService(b, { name: 'Whitening' });
    const day = await openDay('smile-clinic', cleaning);
    const done = await b.post('/api/client/bookings/blocked-dates', { startDate: day.date, serviceId: whitening, reason: 'Dentist away' });
    assert.equal(done.status, 201, JSON.stringify(done.body));
    assert.equal(done.body.service.name, 'Whitening');
    assert.ok(!(await openSlots('smile-clinic', whitening)).some((d) => d.date === day.date), 'whitening is off that day');
    assert.ok((await openSlots('smile-clinic', cleaning)).some((d) => d.date === day.date), 'cleaning still open');
    const list = await b.get('/api/client/bookings/blocked-dates');
    assert.equal(list.body[0].service.id, whitening);
  });

  it('free plan: stops at the monthly limit (cancelled bookings count) and warns the owner', async () => {
    const { b, orgId } = await newBusiness();
    const serviceId = await addService(b);
    await db.entitlement.update({ where: { organizationId_key: { organizationId: orgId, key: 'limit:bookings.monthly' } }, data: { value: 2 } });
    const all = (await openSlots('smile-clinic', serviceId)).flatMap((d) => d.slots.map((s) => s.startsAt));
    const first = await book('smile-clinic', { serviceId, startsAt: all[0] });
    assert.equal(first.status, 201);
    const list = await b.get('/api/client/bookings/items');
    await b.post(`/api/client/bookings/items/${list.body[0].id}/cancel`, { notify: false });
    assert.equal((await book('smile-clinic', { serviceId, startsAt: all[1] })).status, 201);
    const third = await book('smile-clinic', { serviceId, startsAt: all[2] });
    assert.equal(third.status, 409);
    assert.equal(third.body.error, 'monthly_limit');
    const page = await request(t.server).get('/api/public/bookings/smile-clinic').set('Host', BOOKINGS);
    assert.equal(page.body.status, 'month_full');
    assert.equal(page.body.services.length, 1, 'services still listed');
    const cal = await request(t.server).get(`/api/public/bookings/smile-clinic/availability?serviceId=${serviceId}`).set('Host', BOOKINGS);
    assert.equal(cal.body.status, 'month_full');
    assert.ok(cal.body.days.length > 0, 'the calendar still shows');
    assert.ok(cal.body.days.every((d: { status: string; slots: unknown[] }) => d.status === 'closed' && d.slots.length === 0), 'every day disabled');
    await notifications.flush();
    assert.ok(mailsFor('owner@clinic.test').some((m) => /limit is reached/.test(m.subject)));
  });

  it('limits active services on the free plan', async () => {
    const { b } = await newBusiness();
    for (const name of ['A', 'B', 'C', 'D', 'E']) await addService(b, { name });
    const sixth = await b.post('/api/client/bookings/services', { name: 'F', durationMinutes: 30 });
    assert.equal(sixth.status, 403);
    assert.equal(sixth.body.error, 'not_in_plan');
  });
});

describe('manage link (customer, no login)', () => {
  async function booked() {
    const { b } = await newBusiness();
    const serviceId = await addService(b);
    const days = await openSlots('smile-clinic', serviceId);
    assert.equal((await book('smile-clinic', { serviceId, startsAt: days[0].slots[0].startsAt })).status, 201);
    await notifications.flush();
    const mail = mailsFor('carl@example.com').find((m) => m.subject.startsWith('Booking confirmed'))!;
    const token = /manage#t=(\d+\.[A-Za-z0-9_-]{43})/.exec(mail.text)![1];
    return { b, serviceId, days, token };
  }
  const manage = (method: 'get' | 'post', path: string, token: string, body?: object) =>
    request(t.server)[method](`/api/public/manage-booking${path}`).set('Host', BOOKINGS).set('X-Booking-Token', token).send(body);

  it('reschedules to a valid slot and cancels; the link then stops working for changes', async () => {
    const { days, token } = await booked();
    const view = await manage('get', '', token);
    assert.equal(view.status, 200);
    assert.equal(view.body.state, 'changeable');
    const target = days[1]?.slots[0] ?? days[0].slots[1];
    const moved = await manage('post', '/reschedule', token, { startsAt: target.startsAt });
    assert.equal(moved.status, 200, JSON.stringify(moved.body));
    await notifications.flush();
    assert.ok(mailsFor('carl@example.com').some((m) => m.subject.startsWith('Booking moved')));
    assert.ok(mailsFor('owner@clinic.test').some((m) => m.subject.startsWith('Booking rescheduled')));

    const bad = await manage('post', '/reschedule', token, { startsAt: new Date(Date.now() + 3600_000).toISOString() });
    assert.equal(bad.status, 400);

    assert.equal((await manage('post', '/cancel', token)).status, 200);
    const afterCancel = await manage('get', '', token);
    assert.equal(afterCancel.body.state, 'cancelled');
    assert.equal((await manage('post', '/cancel', token)).status, 404);
  });

  it('refuses tampered tokens and changes inside the cutoff', async () => {
    const { b, token } = await booked();
    const tampered = token.slice(0, -2) + (token.endsWith('AA') ? 'BB' : 'AA');
    assert.equal((await manage('get', '', tampered)).status, 404);
    await b.put('/api/client/bookings/settings', { changeCutoffHours: 24 * 14, phone: '+1 416 555 0100' });
    const view = await manage('get', '', token);
    assert.equal(view.body.state, 'cutoff');
    const cancel = await manage('post', '/cancel', token);
    assert.equal(cancel.status, 409);
    assert.ok(cancel.body.message.includes('+1 416 555 0100'));
  });
});

describe('client hosts', () => {
  it('serves the client app on client hosts and keeps the main site elsewhere', async () => {
    const page = await request(t.server).get('/smile-clinic').set('Host', BOOKINGS);
    assert.equal(page.status, 200);
    assert.match(page.text, /client app/i);
    const signIn = await request(t.server).get('/sign-in').set('Host', ACCOUNTS);
    assert.equal(signIn.status, 200);
    // On the main host, /sign-in stays a plain 404 (admin rules).
    assert.equal((await request(t.server).get('/sign-in')).status, 404);
    await sleep(10);
  });
});

describe('free plan retention (60 days after the appointment)', () => {
  /** A booking N days in the past, inserted directly (the API only books future times). */
  async function pastBooking(orgId: string, serviceId: number, daysAgo: number, email: string, note: string | null = null) {
    const date = addDays(todayIn('America/Toronto'), -daysAgo);
    const customer = await db.customer.upsert({
      where: { organizationId_email: { organizationId: orgId, email } },
      create: { organizationId: orgId, email, name: email.split('@')[0] },
      update: {},
    });
    const startsAt = fromLocal(date, 600, 'America/Toronto');
    return db.booking.create({
      data: { organizationId: orgId, serviceId, customerId: customer.id, localDate: dateToDb(date), startsAt, endsAt: startsAt, blockedUntil: startsAt, manageNonce: 'x'.repeat(32), checkInCode: newCheckInCode(), note },
    });
  }

  it('deletes bookings past 60 days, warns 7 days ahead once, and keeps everything on paid plans', async () => {
    const { b, orgId } = await newBusiness();
    const serviceId = await addService(b);
    await pastBooking(orgId, serviceId, 61, 'old@x.test');
    await pastBooking(orgId, serviceId, 60, 'edge@x.test');
    await pastBooking(orgId, serviceId, 55, 'soon@x.test'); // deleted in 5 days
    await pastBooking(orgId, serviceId, 10, 'recent@x.test');
    const job = t.app.get(RetentionJob);

    const r = await job.run();
    assert.equal(r.deleted, 2);
    const left = await db.booking.findMany({ include: { customer: true } });
    assert.deepEqual(left.map((x) => x.customer.email).sort(), ['recent@x.test', 'soon@x.test']);
    assert.equal(await db.customer.count({ where: { email: 'old@x.test' } }), 0, 'customers without bookings are removed too');

    await notifications.flush();
    const warn = mailsFor('owner@clinic.test').filter((m) => /will be deleted on/.test(m.subject));
    assert.equal(warn.length, 1);
    assert.match(warn[0].subject, /^1 booking will be deleted on /);
    assert.ok(warn[0].text.includes('/api/client/bookings/export.csv'));
    // Running again doesn't warn twice.
    await job.run();
    await notifications.flush();
    assert.equal(mailsFor('owner@clinic.test').filter((m) => /will be deleted on/.test(m.subject)).length, 1);

    // Upgrade: deletion stops immediately.
    await db.subscription.update({ where: { organizationId: orgId }, data: { planCode: 'bookings' } });
    await syncEntitlements(db, orgId);
    await pastBooking(orgId, serviceId, 90, 'ancient@x.test');
    assert.equal((await job.run()).deleted, 0);
    assert.equal(await db.booking.count(), 3);
  });

  it('exports every booking as CSV for owners and admins', async () => {
    const { b, orgId } = await newBusiness();
    const serviceId = await addService(b);
    await pastBooking(orgId, serviceId, 3, 'csv@x.test', '=HYPERLINK("evil")');
    const res = await b.get('/api/client/bookings/export.csv');
    assert.equal(res.status, 200);
    assert.match(res.headers['content-type'], /text\/csv/);
    assert.ok(res.text.includes('"csv@x.test"'));
    assert.ok(res.text.includes(`"'=HYPERLINK(""evil"")"`), 'formulas are neutralized');
  });
});

describe('account details', () => {
  it('updates names and phone but never the email; owners and admins rename the company', async () => {
    const { b } = await newBusiness();
    const before = await b.get('/api/client/profile');
    assert.equal(before.status, 200);
    assert.deepEqual([before.body.firstName, before.body.lastName, before.body.email], ['Olivia', 'Owner', 'owner@clinic.test']);
    assert.equal(before.body.business.canEdit, true);

    const ok = await b.patch('/api/client/profile', { firstName: 'Liv', lastName: 'Santos', phone: '+1 416 555 0100' });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.lastName, 'Santos');
    assert.equal((await b.get('/api/client/me')).body.user.name, 'Liv Santos');

    const email = await b.patch('/api/client/profile', { firstName: 'Liv', email: 'new@clinic.test' });
    assert.equal(email.status, 400);
    assert.ok(email.body.fields.email);
    assert.equal((await db.user.count({ where: { email: 'owner@clinic.test' } })), 1);

    const renamed = await b.patch('/api/client/business', { name: 'Smile Dental Group' });
    assert.equal(renamed.status, 200);
    const page = await request(t.server).get('/api/public/bookings/smile-clinic').set('Host', BOOKINGS);
    assert.equal(page.body.business.name, 'Smile Dental Group');
    assert.equal((await b.get('/api/client/me')).body.business.name, 'Smile Dental Group');
  });

  it('staff can edit their own details but not the company name', async () => {
    const { b } = await newBusiness();
    await b.post('/api/client/team/invitations', { email: 'sam@clinic.test', role: 'staff' });
    const invMail = await waitForMail((m) => [m.to].flat().includes('sam@clinic.test') && /invite\//.test(m.text));
    const staff = await signIn('sam@clinic.test');
    assert.equal((await staff.post(`/api/client/invitations/${/invite\/([^\s)]+)/.exec(invMail.text)![1]}/accept`)).status, 200);
    assert.equal((await staff.patch('/api/client/profile', { firstName: 'Sam' })).status, 200);
    assert.equal((await staff.get('/api/client/profile')).body.business.canEdit, false);
    assert.equal((await staff.patch('/api/client/business', { name: 'Hacked' })).status, 403);
  });
});

describe('event retention (no voucher: deleted 3 months after the event)', () => {
  it('reminds 7, 3 and 1 days before, then emails the CSV and JSON and deletes; vouchered events stay', async () => {
    const { b, orgId } = await newBusiness();
    const yesterday = addDays(todayIn('America/Toronto'), -1);
    const made = await b.post('/api/client/bookings/events', { retentionAgreed: true, title: 'Past talk', slug: 'past-talk', kind: 'free', date: yesterday, startMinute: 600, endMinute: 660, format: 'onsite', address: '1 Main St', published: true });
    assert.equal(made.status, 201, JSON.stringify(made.body));
    assert.equal(made.body.retention.applies, true);
    const deleteOn = made.body.retention.deleteOn as string;
    assert.equal(deleteOn.slice(5, 7), String(((Number(yesterday.slice(5, 7)) + 2) % 12) + 1).padStart(2, '0'), '3 months later');
    // The event is over (registration closed): the attendee is added directly.
    await db.eventTicket.create({ data: { eventId: made.body.id, organizationId: orgId, name: 'Kay Kept', email: 'kay@x.test', phone: '+1 416 555 0100', code: newCheckInCode(), status: 'confirmed', confirmedAt: new Date() } });
    // A vouchered event the same day: never deleted.
    await db.eventVoucher.create({ data: { organizationId: orgId, code: 'MN4P7QRT', participants: 300, createdBy: 'admin@bytebuntech.com' } });
    const kept = await b.post('/api/client/bookings/events', { title: 'Big past', slug: 'big-past', kind: 'free', date: addDays(yesterday, -1), startMinute: 600, endMinute: 660, format: 'onsite', address: 'x', voucherCode: 'MN4P7QRT' });
    assert.equal(kept.status, 201, JSON.stringify(kept.body));
    assert.equal(kept.body.retention.applies, false);

    const job = t.app.get(EventRetentionJob);
    const at = (daysBefore: number) => new Date(`${addDays(deleteOn, -daysBefore)}T17:00:00Z`);
    assert.equal((await job.run(at(10))).reminded, 0, 'too early');
    assert.equal((await job.run(at(7))).reminded, 1);
    await waitForMail((m) => [m.to].flat().includes('owner@clinic.test') && /“Past talk” is deleted in 7 days/.test(m.subject));
    assert.equal((await job.run(at(7))).reminded, 0, 'once');
    assert.equal((await job.run(at(3))).reminded, 1);
    assert.equal((await job.run(at(1))).reminded, 1);
    await waitForMail((m) => [m.to].flat().includes('owner@clinic.test') && /is deleted tomorrow/.test(m.subject));

    const done = await job.run(at(0));
    assert.equal(done.deleted, 1);
    const archive = await waitForMail((m) => [m.to].flat().includes('owner@clinic.test') && /Event deleted: “Past talk”/.test(m.subject));
    const csv = archive.attachments?.find((x) => x.filename.endsWith('.csv'));
    const json = archive.attachments?.find((x) => x.filename.endsWith('.json'));
    assert.ok(csv && String(csv.content).includes('kay@x.test'), 'the CSV has the attendees');
    assert.ok(json && JSON.parse(String(json.content)).attendees.length === 1, 'the JSON has everything');
    const zipped = archive.attachments?.find((x) => x.filename.endsWith('.zip'));
    assert.ok(zipped && Buffer.isBuffer(zipped.content) && zipped.content.toString('latin1').includes('event.xlsx'), 'the zip is attached too');
    assert.equal(await db.event.count({ where: { id: made.body.id } }), 0, 'deleted');
    assert.equal(await db.event.count({ where: { id: kept.body.id } }), 1, 'the vouchered event stays');
  });
});

describe('bookings dashboard', () => {
  it('counts past, today and future bookings: attended, unattended, cancelled, upcoming, per service', async () => {
    const { b, orgId } = await newBusiness();
    const serviceId = await addService(b, { name: 'Cleaning' });
    const tz = 'America/Toronto';
    const today = todayIn(tz);
    const customer = await db.customer.create({ data: { organizationId: orgId, email: 'dash@x.test', name: 'Dee Dash' } });
    const make = (dayOffset: number, extra: object = {}) => {
      const date = addDays(today, dayOffset);
      const startsAt = fromLocal(date, 600, tz);
      return db.booking.create({ data: { organizationId: orgId, serviceId, customerId: customer.id, localDate: dateToDb(date), startsAt, endsAt: new Date(startsAt.getTime() + 1800_000), blockedUntil: startsAt, manageNonce: 'd'.repeat(32), checkInCode: newCheckInCode(), ...extra } });
    };
    await make(-3, { checkedInAt: new Date() }); // attended
    await make(-2); // unattended
    await make(-1, { noShowAt: new Date() }); // unattended, a no-show
    await make(-1, { status: 'cancelled', cancelledAt: new Date() }); // cancelled
    await make(3); // upcoming
    await make(40); // outside 30 days
    const d = await b.get('/api/client/bookings/dashboard?days=30');
    assert.equal(d.status, 200, JSON.stringify(d.body));
    assert.deepEqual(
      { attended: d.body.past.attended, unattended: d.body.past.unattended, cancelled: d.body.past.cancelled, noShows: d.body.past.noShows, booked: d.body.past.booked },
      { attended: 1, unattended: 2, cancelled: 1, noShows: 1, booked: 4 },
    );
    assert.equal(d.body.future.upcoming, 1);
    assert.equal(d.body.attendanceRate, 33);
    assert.equal(d.body.perDay.length, 61, '30 days back, today, 30 ahead');
    assert.equal(d.body.services[0].name, 'Cleaning');
    assert.equal(d.body.services[0].booked, 5);
  });
});

describe('attendance check-in (QR code / typed code)', () => {
  /** A booking `dayOffset` days from today, `minutesFromNow` from now (today's), for the check-in tests. */
  async function bookingAt(orgId: string, serviceId: number, dayOffset: number, minutesFromNow = 0) {
    const tz = 'America/Toronto';
    const today = todayIn(tz);
    const date = addDays(today, dayOffset);
    const startsAt = dayOffset === 0 ? new Date(Date.now() + minutesFromNow * 60_000) : fromLocal(date, 600, tz);
    const endsAt = new Date(startsAt.getTime() + 30 * 60_000);
    const customer = await db.customer.upsert({
      where: { organizationId_email: { organizationId: orgId, email: `c${dayOffset}${minutesFromNow}@x.test` } },
      create: { organizationId: orgId, email: `c${dayOffset}${minutesFromNow}@x.test`, name: 'Carla Cruz' },
      update: {},
    });
    return db.booking.create({ data: { organizationId: orgId, serviceId, customerId: customer.id, localDate: dateToDb(date), startsAt, endsAt, blockedUntil: endsAt, manageNonce: 'c'.repeat(32), checkInCode: newCheckInCode() } });
  }
  const pretty = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`;

  it('emails the QR code and the code with an in-person booking', async () => {
    const { b } = await newBusiness();
    const serviceId = await addService(b);
    const day = await openDay('smile-clinic', serviceId);
    const res = await book('smile-clinic', { serviceId, startsAt: day.slots[0].startsAt });
    assert.equal(res.status, 201);
    await notifications.flush();
    const mail = mailsFor('carl@example.com').find((m) => /Booking confirmed/.test(m.subject));
    assert.ok(mail, 'confirmation sent');
    const qr = mail!.attachments?.find((a) => a.cid === 'checkin-qr');
    assert.ok(qr && Buffer.isBuffer(qr.content) && qr.contentType === 'image/png', 'inline QR image');
    assert.match(mail!.html ?? '', /cid:checkin-qr/);
    const [row] = (await b.get('/api/client/bookings/items')).body;
    assert.match(row.checkInCode, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    assert.ok(mail!.text.includes(row.checkInCode), 'the code is in the email');
  });

  it('checks in today, warns for another day or a past booking, and checks in only when forced', async () => {
    const { b, orgId } = await newBusiness();
    const serviceId = await addService(b);
    const now = await bookingAt(orgId, serviceId, 0, -5); // started 5 minutes ago, still on
    const tomorrow = await bookingAt(orgId, serviceId, 1);
    const yesterday = await bookingAt(orgId, serviceId, -1);

    // Typed with lower case, a dash and spaces; or the QR code's link.
    const ok = await b.post('/api/client/bookings/check-in', { code: ` ${pretty(now.checkInCode).toLowerCase()} ` });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.state, 'ok');
    assert.equal(ok.body.checkedIn, true);
    assert.ok(ok.body.booking.checkedInAt);
    const again = await b.post('/api/client/bookings/check-in', { code: `https://bookings.example/app/check-in?code=${now.checkInCode}` });
    assert.equal(again.body.state, 'already');
    assert.equal(again.body.checkedIn, false);

    const early = await b.post('/api/client/bookings/check-in', { code: tomorrow.checkInCode });
    assert.equal(early.body.state, 'other_day');
    assert.equal(early.body.booking.checkedInAt, null);
    const late = await b.post('/api/client/bookings/check-in', { code: yesterday.checkInCode });
    assert.equal(late.body.state, 'expired');
    const forced = await b.post('/api/client/bookings/check-in', { id: yesterday.id, force: true });
    assert.equal(forced.body.checkedIn, true);

    // The business can move a missed appointment (the customer can't).
    const day = await openDay('smile-clinic', serviceId);
    const moved = await b.post(`/api/client/bookings/items/${tomorrow.id}/reschedule`, { startsAt: day.slots[day.slots.length - 1].startsAt });
    assert.equal(moved.status, 200, JSON.stringify(moved.body));
    const missed = await bookingAt(orgId, serviceId, -2);
    const movedMissed = await b.post(`/api/client/bookings/items/${missed.id}/reschedule`, { startsAt: day.slots[0].startsAt });
    assert.equal(movedMissed.status, 200, JSON.stringify(movedMissed.body));

    const undo = await b.post(`/api/client/bookings/items/${now.id}/check-in/undo`, {});
    assert.equal(undo.status, 200);
    assert.equal((await b.post('/api/client/bookings/check-in', { code: now.checkInCode })).body.state, 'ok');

    assert.equal((await b.post('/api/client/bookings/check-in', { code: 'ZZZZ-ZZZZ' })).status, 404);
    assert.equal((await b.post('/api/client/bookings/check-in', { code: 'nope' })).status, 400);
  });

  it('lists unattended appointments: over and never checked in', async () => {
    const { b, orgId } = await newBusiness();
    const serviceId = await addService(b);
    const missed = await bookingAt(orgId, serviceId, -3);
    const came = await bookingAt(orgId, serviceId, -2);
    await bookingAt(orgId, serviceId, 2); // upcoming: not unattended
    await b.post('/api/client/bookings/check-in', { id: came.id, force: true });
    const list = await b.get('/api/client/bookings/items?view=unattended');
    assert.deepEqual(
      list.body.map((r: { id: number }) => r.id),
      [missed.id],
    );
  });
});

describe('events (free and paid, check-in per event)', () => {
  const pub = (path: string) => request(t.server).get(`/api/public/bookings/smile-clinic/events${path}`).set('Host', BOOKINGS);
  const post = (path: string, body: object) => request(t.server).post(`/api/public/bookings/smile-clinic/events${path}`).set('Host', BOOKINGS).send(body);
  const inDays = (n: number) => addDays(todayIn('America/Toronto'), n);
  async function newEvent(b: Client, body: object = {}) {
    const res = await b.post('/api/client/bookings/events', {
      title: 'Smile Seminar',
      slug: 'smile-seminar',
      kind: 'free',
      date: inDays(7),
      startMinute: 840,
      endMinute: 1020,
      format: 'onsite',
      address: '1 Main St',
      description: '<p>Learn <strong>more</strong></p><script>x</script>',
      published: true,
      retentionAgreed: true,
      ...body,
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return res.body as { id: number; slug: string; capacity: number | null; published: boolean; publishHeldBack?: boolean };
  }
  /** Paid events go live once they have a payment channel: add bank details, then publish. */
  async function publishPaid(b: Client, id: number) {
    const ch = await b.multipart('post', `/api/client/bookings/events/${id}/payment-channels`).field('type', 'bank').field('label', 'BDO').field('bankName', 'BDO').field('accountName', 'Smile Clinic').field('accountNumber', '0012 3456');
    assert.equal(ch.status, 201, JSON.stringify(ch.body));
    const pubd = await b.patch(`/api/client/bookings/events/${id}`, { published: true });
    assert.equal(pubd.status, 200, JSON.stringify(pubd.body));
  }

  it('free: anyone registers, gets the QR code on screen and by email; capacity; the same email can register again; revoke', async () => {
    const { b } = await newBusiness();
    const refused = await b.post('/api/client/bookings/events', { title: 'No agreement', slug: 'no-agreement', kind: 'free', date: inDays(7), startMinute: 840, endMinute: 900, format: 'onsite', address: 'x' });
    assert.equal(refused.body.error, 'retention_not_agreed', 'must agree to the 3-month deletion');
    const ev = await newEvent(b, { capacity: 3 });
    const pinned = await b.patch(`/api/client/bookings/events/${ev.id}`, { latitude: 43.6532, longitude: -79.3832, addressDetails: '2nd floor, Unit 5' });
    assert.equal(pinned.body.event.addressDetails, '2nd floor, Unit 5');
    assert.equal(pinned.status, 200, JSON.stringify(pinned.body));
    assert.equal(pinned.body.event.latitude, 43.6532, 'the map pin is saved');
    assert.equal((await b.patch(`/api/client/bookings/events/${ev.id}`, { latitude: 10, longitude: null })).status, 400, 'both or neither');
    const page = await pub('/smile-seminar');
    assert.equal(page.status, 200, JSON.stringify(page.body));
    assert.equal(page.body.event.longitude, -79.3832);
    assert.equal(page.body.event.timeZone, 'America/Toronto', 'no zone given: the business’s');
    const manila = await b.post('/api/client/bookings/events', { retentionAgreed: true, title: 'Manila talk', slug: 'manila-talk', kind: 'free', date: inDays(9), startMinute: 840, endMinute: 900, timeZone: 'Asia/Manila', format: 'online' });
    assert.equal(manila.status, 201, JSON.stringify(manila.body));
    assert.equal(manila.body.timeZone, 'Asia/Manila');
    assert.equal(manila.body.startMinute, 840, '2:00 PM in Manila');
    assert.equal(new Date(manila.body.startsAt).getUTCHours(), 6, '2:00 PM Manila = 06:00 UTC');
    assert.equal((await b.post('/api/client/bookings/events', { retentionAgreed: true, title: 'Bad zone', slug: 'bad-zone', kind: 'free', date: inDays(10), startMinute: 600, endMinute: 660, timeZone: 'Mars/Base', format: 'online' })).body.fields.timeZone, 'Please choose a time zone.');
    assert.equal(page.body.event.description, '<p>Learn <strong>more</strong></p>', 'sanitized');
    assert.equal(page.body.event.spotsLeft, 3);
    assert.equal((await pub('')).body.events.length, 1);

    const reg = await post('/smile-seminar/register', { firstName: 'Ana', lastName: 'Reyes', email: 'ana@x.test', phone: '+1 416 555 0100' });
    assert.equal(reg.status, 201, JSON.stringify(reg.body));
    assert.equal(reg.body.name, 'Ana Reyes', 'first and last name together');
    assert.match(reg.body.checkIn.code, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    assert.match(reg.body.checkIn.url, /\/app\/scan\?code=/);
    const mail = await waitForMail((m) => [m.to].flat().includes('ana@x.test') && /registered/.test(m.subject));
    assert.ok(mail.attachments?.some((a) => a.cid === 'checkin-qr'), 'QR in the email');
    assert.ok(mail.text.includes(reg.body.checkIn.code));
    // The same email may register again (e.g. for family members): a separate registration.
    const again = await post('/smile-seminar/register', { firstName: 'Ana', lastName: 'Again', email: 'ANA@x.test', phone: '+1 416 555 0100' });
    assert.equal(again.status, 201, JSON.stringify(again.body));
    assert.notEqual(again.body.checkIn.code, undefined);
    const noPhone = await post('/smile-seminar/register', { firstName: 'Pat', lastName: 'Nophone', email: 'pat@x.test' });
    assert.equal(noPhone.status, 400);
    assert.ok(noPhone.body.fields.phone, 'phone is required');
    assert.ok((await post('/smile-seminar/register', { firstName: 'Pat', lastName: '', email: 'pat@x.test', phone: '12' })).body.fields.lastName, 'last name required');
    assert.equal((await post('/smile-seminar/register', { firstName: 'Ben', lastName: 'Cruz', email: 'ben@x.test', phone: '+1 416 555 0100' })).status, 201);
    assert.equal((await post('/smile-seminar/register', { firstName: 'Cy', lastName: 'Full', email: 'cy@x.test', phone: '+1 416 555 0100' })).body.error, 'full');

    const detail = await b.get(`/api/client/bookings/events/${ev.id}`);
    const ana = detail.body.tickets.find((x: { name: string }) => x.name === 'Ana Reyes');
    const revoked = await b.post(`/api/client/bookings/events/${ev.id}/tickets/${ana.id}/revoke`, { reason: 'Duplicate' });
    assert.equal(revoked.status, 200, JSON.stringify(revoked.body));
    assert.equal(revoked.body.status, 'revoked');
    await waitForMail((m) => [m.to].flat().includes('ana@x.test') && /cancelled/.test(m.subject));
    assert.equal((await post('/smile-seminar/register', { firstName: 'Cy', lastName: 'Now', email: 'cy@x.test', phone: '+1 416 555 0100' })).status, 201, 'a place freed up');
    // Export: Excel (a real .xlsx: a zip) and CSV, with the claimables as columns.
    const x = await b.get(`/api/client/bookings/events/${ev.id}/export.xlsx`).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    assert.equal(x.status, 200);
    assert.match(x.headers['content-type'], /spreadsheetml/);
    assert.equal((x.body as Buffer).subarray(0, 2).toString(), 'PK', 'a zip');
    const csv = await b.get(`/api/client/bookings/events/${ev.id}/export.csv`);
    assert.equal(csv.status, 200);
    assert.match(csv.text, /"Name","Email","Phone","Code","Status"/);
    assert.match(csv.text, /"Ben Cruz","ben@x\.test"/);
    const j = await b.get(`/api/client/bookings/events/${ev.id}/export.json`);
    assert.equal(j.status, 200);
    const data = JSON.parse(j.text);
    assert.equal(data.event.title, 'Smile Seminar');
    assert.equal(data.event.totals.registered, 3);
    assert.ok(data.attendees.some((x: { email: string }) => x.email === 'ben@x.test'));
    assert.ok(Array.isArray(data.claimables) && Array.isArray(data.scanners));

    // Deleting the whole event needs the code emailed to the person asking.
    assert.equal((await b.post(`/api/client/bookings/events/${ev.id}/delete`, { code: '123456' })).body.error, 'code_expired', 'no code asked yet');
    const asked = await b.post(`/api/client/bookings/events/${ev.id}/delete-code`, {});
    assert.equal(asked.status, 200, JSON.stringify(asked.body));
    assert.equal(asked.body.registrations, 3, 'Ana Again, Ben and Cy (Ana Reyes was revoked)');
    const codeMail = await waitForMail((m) => [m.to].flat().includes('owner@clinic.test') && /Code to delete/.test(m.subject));
    const code = /(\d{6})$/.exec(codeMail.subject)![1];
    const wrong = await b.post(`/api/client/bookings/events/${ev.id}/delete`, { code: code === '000000' ? '111111' : '000000' });
    assert.equal(wrong.body.error, 'bad_code');
    // Load it with everything a delete must take along: a claimable, a scanner, a claim, a voucher.
    const k = await b.post(`/api/client/bookings/events/${ev.id}/claimables`, { name: 'Free Water' });
    const sc = await b.post(`/api/client/bookings/events/${ev.id}/scanners`, { email: 'sc@x.test', firstName: 'Sam', lastName: 'Scan', claimableId: k.body.id });
    const ben = (await b.get(`/api/client/bookings/events/${ev.id}`)).body.tickets.find((x: { email: string }) => x.email === 'ben@x.test');
    await b.post(`/api/client/bookings/events/${ev.id}/check-in`, { ticketId: ben.id, force: true });
    assert.equal((await b.post(`/api/client/bookings/events/${ev.id}/claimables/${k.body.id}/claim`, { ticketId: ben.id })).body.state, 'claimed');
    const voucher = await db.eventVoucher.create({ data: { organizationId: (await db.event.findUniqueOrThrow({ where: { id: ev.id } })).organizationId, code: 'YT5Z9QRS', participants: 300, createdBy: 'admin@bytebuntech.com', usedAt: new Date(), eventId: ev.id } });
    const gone = await b.post(`/api/client/bookings/events/${ev.id}/delete`, { code });
    assert.equal(gone.status, 200, JSON.stringify(gone.body));
    assert.equal(gone.body.notified, 3, 'Ana Again, Ben and Cy');
    await waitForMail((m) => [m.to].flat().includes('ben@x.test') && /Event cancelled/.test(m.subject));
    assert.equal((await b.get(`/api/client/bookings/events/${ev.id}`)).status, 404);
    // Everything under the event went with it (database cascade); the voucher stays, unlinked.
    assert.equal(await db.eventTicket.count({ where: { eventId: ev.id } }), 0, 'registrations');
    assert.equal(await db.eventScanner.count({ where: { eventId: ev.id } }), 0, 'scanners');
    assert.equal(await db.eventClaimable.count({ where: { eventId: ev.id } }), 0, 'claimables');
    assert.equal(await db.eventClaim.count({ where: { claimableId: k.body.id } }), 0, 'claims');
    assert.equal((await request(t.server).get(`/api/scanner/${sc.body.scanner.scannerCode}`).set('Host', 'scanner.localhost:5173')).status, 404, 'its scanner link is dead');
    assert.equal((await db.eventVoucher.findUniqueOrThrow({ where: { id: voucher.id } })).eventId, null, 'voucher kept, unlinked');
    assert.equal((await pub('/smile-seminar')).status, 404);
  });

  it('free plan: 50 participants and one event a day; a voucher (after manual payment) allows a bigger event', async () => {
    const { b, orgId } = await newBusiness();
    const ev = await newEvent(b);
    assert.equal(ev.capacity, 50, 'no capacity on the free plan = the 50 allowed');
    const tooBig = await b.patch(`/api/client/bookings/events/${ev.id}`, { capacity: 120 });
    assert.equal(tooBig.status, 403, JSON.stringify(tooBig.body));
    assert.equal(tooBig.body.error, 'participant_limit');
    const sameDay = await b.post('/api/client/bookings/events', { retentionAgreed: true, title: 'Second', slug: 'second', kind: 'free', date: inDays(7), startMinute: 600, endMinute: 660, format: 'onsite' });
    assert.equal(sameDay.body.error, 'per_day_limit', 'one event a day');

    // Byte Bun takes the payment and makes a voucher for 300 participants ($10).
    const admin = await db.eventVoucher.create({ data: { organizationId: orgId, code: 'VQ3X7KMN', participants: 300, priceLabel: '$10', createdBy: 'admin@bytebuntech.com' } });
    assert.equal((await b.post('/api/client/bookings/events/vouchers/check', { code: 'vq3x-7kmn' })).body.participants, 300);
    assert.equal((await b.post('/api/client/bookings/events/vouchers/check', { code: 'ZZZZZZZZ' })).body.error, 'bad_voucher');
    const big = await b.post('/api/client/bookings/events', { retentionAgreed: true, title: 'Big talk', slug: 'big-talk', kind: 'free', date: inDays(9), startMinute: 600, endMinute: 660, format: 'onsite', capacity: 250, voucherCode: 'VQ3X-7KMN' });
    assert.equal(big.status, 201, JSON.stringify(big.body));
    assert.equal(big.body.participantLimit, 300);
    assert.equal((await b.patch(`/api/client/bookings/events/${big.body.id}`, { capacity: 120 })).status, 200, 'down within the tier');
    assert.equal((await b.patch(`/api/client/bookings/events/${big.body.id}`, { capacity: 300 })).status, 200, 'up to the tier');
    assert.equal((await b.patch(`/api/client/bookings/events/${big.body.id}`, { capacity: 301 })).body.error, 'participant_limit', 'not into the next tier');
    assert.equal((await b.patch(`/api/client/bookings/events/${ev.id}`, { voucherCode: 'VQ3X7KMN' })).body.error, 'voucher_used', 'once');
    const used = await db.eventVoucher.findUniqueOrThrow({ where: { id: admin.id } });
    assert.equal(used.eventId, big.body.id);

    // A new payment: a 500 voucher grows the same event.
    await db.eventVoucher.create({ data: { organizationId: orgId, code: 'WR5Y8PQT', participants: 500, createdBy: 'admin@bytebuntech.com' } });
    const grown = await b.patch(`/api/client/bookings/events/${big.body.id}`, { capacity: 480, voucherCode: 'WR5Y8PQT' });
    assert.equal(grown.status, 200, JSON.stringify(grown.body));
    assert.equal(grown.body.event.participantLimit, 500);

    // Another business can't use this business's voucher.
    await db.eventVoucher.create({ data: { organizationId: orgId, code: 'XS6Z9RTU', participants: 300, createdBy: 'admin@bytebuntech.com' } });
    const { b: other } = await newBusiness('other@clinic.test', 'other-clinic');
    assert.equal((await other.post('/api/client/bookings/events/vouchers/check', { code: 'XS6Z9RTU' })).body.error, 'bad_voucher');
  });

  it('every plan: 50 participants included per event; more needs a voucher (paid plans too)', async () => {
    const { b, orgId } = await newBusiness();
    await db.subscription.update({ where: { organizationId: orgId }, data: { planCode: 'premium' } });
    await syncEntitlements(db, orgId);
    const ev = await newEvent(b, { slug: 'premium-talk' });
    assert.equal(ev.capacity, 50);
    assert.equal((await b.patch(`/api/client/bookings/events/${ev.id}`, { capacity: 51 })).body.error, 'participant_limit');
    // No one-a-day rule on paid plans.
    assert.equal((await b.post('/api/client/bookings/events', { retentionAgreed: true, title: 'Same day', slug: 'same-day', kind: 'free', date: inDays(7), startMinute: 600, endMinute: 660, format: 'onsite', address: 'x st' })).status, 201);
  });

  it('paid: the business issues a code, the attendee registers with it and gets the email', async () => {
    const { b } = await newBusiness();
    const ev = await newEvent(b, { kind: 'paid', price: 50, currency: 'USD', slug: 'masterclass', title: 'Masterclass' });
    await publishPaid(b, ev.id);
    const only = (await b.get(`/api/client/bookings/events/${ev.id}`)).body.paymentChannels[0];
    assert.equal((await b.delete(`/api/client/bookings/events/${ev.id}/payment-channels/${only.id}`)).body.error, 'last_payment_channel', 'a published paid event keeps one way to pay');
    assert.equal((await post('/masterclass/register', { firstName: 'No', lastName: 'Code', email: 'n@x.test', phone: '+1 416 555 0100' })).body.error, 'paid_event');
    const issued = await b.post(`/api/client/bookings/events/${ev.id}/tickets`, { name: 'Dina Paid', email: 'dina@x.test', phone: '+63 917 555 0100' });
    assert.equal(issued.status, 201, JSON.stringify(issued.body));
    assert.equal(issued.body.status, 'pending');
    assert.equal((await post('/masterclass/claim', { code: 'ZZZZZZZZ' })).status, 404);
    const claim = await post('/masterclass/claim', { code: issued.body.code.toLowerCase() });
    assert.equal(claim.status, 200, JSON.stringify(claim.body));
    assert.equal(claim.body.name, 'Dina Paid');
    assert.equal(claim.body.first, true);
    await waitForMail((m) => [m.to].flat().includes('dina@x.test') && /registered/.test(m.subject));
    assert.equal((await post('/masterclass/claim', { code: issued.body.code })).body.first, false, 'can be shown again');
    const t2 = await b.post(`/api/client/bookings/events/${ev.id}/tickets`, { name: 'Unused', email: 'u@x.test', phone: '+63 917 555 0100' });
    assert.equal((await b.delete(`/api/client/bookings/events/${ev.id}/tickets/${t2.body.id}`)).status, 200, 'unused code deleted');
    const t3 = (await b.get(`/api/client/bookings/events/${ev.id}`)).body.tickets[0];
    assert.equal((await b.post(`/api/client/bookings/events/${ev.id}/tickets/${t3.id}/revoke`, {})).body.error, 'paid_event');
  });

  it('paid: payment channels, registration with a proof of payment, approve / reject, 10 hours to re-upload', async () => {
    // A real photo-sized PNG: stored as a smaller WebP.
    const PNG = await sharp({ create: { width: 2400, height: 1600, channels: 3, background: '#2a7' } }).png().toBuffer();
    const PDF = Buffer.from('%PDF-1.4\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n');
    const proofDir = path.join(config.clients.uploadsDir, 'event-proofs');
    const proofFiles = () => (fs.existsSync(proofDir) ? fs.readdirSync(proofDir) : []);
    const { b } = await newBusiness();
    // A paid event needs a price and a currency.
    const noPrice = await b.post('/api/client/bookings/events', { retentionAgreed: true, title: 'No price', slug: 'no-price', kind: 'paid', date: inDays(7), startMinute: 840, endMinute: 900, format: 'onsite', address: 'x' });
    assert.equal(noPrice.status, 400);
    assert.ok(noPrice.body.fields.price && noPrice.body.fields.currency);
    assert.equal((await b.post('/api/client/bookings/events', { retentionAgreed: true, title: 'Bad money', slug: 'bad-money', kind: 'paid', price: 5, currency: 'XYZ', date: inDays(7), startMinute: 840, endMinute: 900, format: 'onsite', address: 'x' })).status, 400);
    const ev = await newEvent(b, { kind: 'paid', price: 500, currency: 'PHP', slug: 'paid-class', title: 'Paid Class' });
    assert.equal((ev as unknown as { priceLabel: string }).priceLabel, '₱500', 'shown formatted');
    const base = `/api/client/bookings/events/${ev.id}`;
    // A paid event is published only once it has a payment channel.
    assert.equal(ev.published, false, 'held back until it has a payment channel');
    assert.equal(ev.publishHeldBack, true);
    assert.equal((await pub('/paid-class')).status, 404);
    assert.equal((await b.patch(base, { published: true })).body.error, 'no_payment_channels');

    // Payment channels: a QR code and bank details, up to 4.
    const qr = await b.multipart('post', `${base}/payment-channels`).field('type', 'qr').field('label', 'GCash').field('accountNumber', '0917 555 0100').attach('file', PNG, 'gcash.png');
    assert.equal(qr.status, 201, JSON.stringify(qr.body));
    assert.match(qr.body.qrUrl, /^\/api\/public\/event-files\/qr\/[0-9a-f-]{36}\.webp$/);
    assert.equal((await b.multipart('post', `${base}/payment-channels`).field('type', 'qr').field('label', 'No file')).body.error, 'file_missing');
    assert.equal((await b.multipart('post', `${base}/payment-channels`).field('type', 'qr').field('label', 'Text').attach('file', Buffer.from('hello'), 'x.png')).body.error, 'file_type');
    const noNumber = await b.multipart('post', `${base}/payment-channels`).field('type', 'bank').field('label', 'BDO').field('bankName', 'BDO').field('accountName', 'Smile Clinic');
    assert.equal(noNumber.status, 400);
    assert.ok(noNumber.body.fields.accountNumber);
    assert.equal((await b.patch(base, { published: true })).status, 200, 'published once it has a channel');
    const bank = await b.multipart('post', `${base}/payment-channels`).field('type', 'bank').field('label', 'BDO savings').field('bankName', 'BDO').field('accountName', 'Smile Clinic').field('accountNumber', '0012 3456 7890');
    assert.equal(bank.status, 201, JSON.stringify(bank.body));
    for (const label of ['Maya', 'BPI']) assert.equal((await b.multipart('post', `${base}/payment-channels`).field('type', 'bank').field('label', label).field('bankName', label).field('accountName', 'A').field('accountNumber', '1')).status, 201);
    assert.equal((await b.multipart('post', `${base}/payment-channels`).field('type', 'bank').field('label', 'Fifth').field('bankName', 'X').field('accountName', 'A').field('accountNumber', '1')).body.error, 'channel_limit');
    assert.equal((await b.delete(`${base}/payment-channels/${(await b.get(base)).body.paymentChannels[3].id}`)).status, 200);
    // Unpublish (hide) and publish again.
    assert.equal((await b.patch(base, { published: false })).status, 200);
    assert.equal((await pub('/paid-class')).status, 404, 'hidden');
    assert.equal((await b.patch(base, { published: true })).status, 200);
    const page = await pub('/paid-class');
    assert.deepEqual(page.body.paymentChannels.map((c: { label: string }) => c.label), ['GCash', 'BDO savings', 'Maya']);
    assert.equal(page.body.paymentChannels[1].accountNumber, '0012 3456 7890');
    const img = await request(t.server).get(qr.body.qrUrl).set('Host', BOOKINGS);
    assert.equal(img.status, 200);
    assert.equal(img.headers['content-type'], 'image/webp', 'images are stored as WebP');
    assert.ok(img.body.length < PNG.length);
    assert.equal((await sharp(img.body).metadata()).width, 1200, 'QR images at most 1200 px');

    // Registering: the details and a proof of payment (image or PDF).
    const register = (email: string, file?: [Buffer, string]) => {
      const r = request(t.server).post('/api/public/bookings/smile-clinic/events/paid-class/register-paid').set('Host', BOOKINGS).field('firstName', 'Pia').field('lastName', 'Payer').field('email', email).field('phone', '+63 917 555 0100');
      return file ? r.attach('file', file[0], file[1]) : r;
    };
    assert.equal((await register('pia@x.test', [Buffer.from('MZ not a pdf'), 'proof.pdf'])).body.error, 'file_type');
    const reg = await register('pia@x.test', [PDF, 'receipt.pdf']);
    assert.equal(reg.status, 201, JSON.stringify(reg.body));
    assert.equal(reg.body.review, true);
    assert.equal(proofFiles().length, 1);
    await waitForMail((m) => [m.to].flat().includes('pia@x.test') && /being verified/.test(m.subject));
    const verify = await waitForMail((m) => [m.to].flat().includes('owner@clinic.test') && /Payment to verify: Pia Payer/.test(m.subject));
    assert.match(verify.text, /\/app\/events\/\d+/);

    // The business sees it to verify, with the proof.
    const pia = (await b.get(base)).body.tickets.find((x: { email: string }) => x.email === 'pia@x.test');
    assert.equal(pia.status, 'review');
    assert.equal(pia.proofs.length, 1);
    assert.equal(pia.proofs[0].type, 'application/pdf');
    assert.equal(pia.proofs[0].name, 'receipt.pdf');
    const file = await b.get(`${base}/tickets/${pia.id}/proofs/${pia.proofs[0].id}`);
    assert.equal(file.status, 200);
    assert.equal(file.headers['content-type'], 'application/pdf');
    assert.match(file.headers['content-disposition'], /^inline/);
    // Not checked in while the payment isn't confirmed.
    assert.equal((await b.post(`${base}/check-in`, { ticketId: pia.id, force: true })).body.state, 'unpaid');

    const pubApi = '/api/public/bookings/smile-clinic/events/paid-class';
    const linkIn = (text: string) => /#upload=(\d+\.[0-9a-f]{48})/.exec(text)![1];
    const upload = (token: string, buf: Buffer, name: string) => request(t.server).post(`${pubApi}/payment`).set('Host', BOOKINGS).field('token', token).attach('file', buf, name);

    // Request another proof: a unique link, 10 hours; the new proof replaces the old one.
    const again = await b.post(`${base}/tickets/${pia.id}/request-proof`, { kind: 'replace', note: 'The screenshot is blurry.' });
    assert.equal(again.status, 200, JSON.stringify(again.body));
    assert.equal(again.body.status, 'rejected');
    assert.equal(again.body.proofRequest, 'replace');
    assert.ok(Math.abs(new Date(again.body.reuploadBy).getTime() - Date.now() - 10 * 3_600_000) < 60_000);
    const againMail = await waitForMail((m) => [m.to].flat().includes('pia@x.test') && /send another proof/.test(m.subject));
    assert.match(againMail.text, /The screenshot is blurry\./);
    const link1 = linkIn(againMail.text);
    // Asking again makes a new link: the first one stops working.
    outbox.length = 0;
    await b.post(`${base}/tickets/${pia.id}/request-proof`, { kind: 'replace', note: 'Still blurry, sorry.' });
    const link2 = linkIn((await waitForMail((m) => [m.to].flat().includes('pia@x.test') && /send another proof/.test(m.subject))).text);
    assert.notEqual(link1, link2, 'a new link every time');
    assert.equal((await upload(link1, PNG, 'old-link.png')).status, 404, 'the earlier link no longer works');
    const what = await request(t.server).get(`${pubApi}/upload-request`).set('Host', BOOKINGS).set('X-Upload-Token', link2);
    assert.equal(what.body.kind, 'replace');
    assert.equal(what.body.note, 'Still blurry, sorry.');
    const reup = await upload(link2, PNG, 'new.png');
    assert.equal(reup.status, 200, JSON.stringify(reup.body));
    assert.equal(proofFiles().length, 2, 'the old proof is replaced, its file kept');
    assert.equal((await upload(link2, PNG, 'twice.png')).status, 404, 'a link works once');
    await waitForMail((m) => [m.to].flat().includes('owner@clinic.test') && /Payment to verify/.test(m.subject) && /uploaded a new proof/.test(m.text));

    // Request additional proof (insufficient amount): the first proof is kept, the new one added.
    const more = await b.post(`${base}/tickets/${pia.id}/request-proof`, { kind: 'additional' });
    assert.equal(more.body.fields?.amountDue !== undefined, true, 'the amount still due is required');
    const more2 = await b.post(`${base}/tickets/${pia.id}/request-proof`, { kind: 'additional', amountDue: 200, note: 'We received ₱300.' });
    assert.equal(more2.status, 200, JSON.stringify(more2.body));
    const moreMail = await waitForMail((m) => [m.to].flat().includes('pia@x.test') && /Payment incomplete/.test(m.subject));
    assert.match(moreMail.text, /Still to pay: ₱200/);
    assert.equal((await upload(linkIn(moreMail.text), PDF, 'rest.pdf')).status, 200);
    const both = (await b.get(base)).body.tickets.find((x: { id: number }) => x.id === pia.id);
    assert.equal(both.status, 'review');
    assert.deepEqual(both.proofs.map((p: { name: string }) => p.name), ['new.png', 'rest.pdf'], 'both proofs kept');
    assert.equal(proofFiles().length, 3);

    // Approved: confirmation with the QR code; the proofs are deleted.
    const ok = await b.post(`${base}/tickets/${pia.id}/approve`);
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.status, 'confirmed');
    assert.equal(proofFiles().length, 3, 'files are kept until the event is deleted');
    const confirmed = await waitForMail((m) => [m.to].flat().includes('pia@x.test') && /registered/.test(m.subject));
    assert.ok(confirmed.attachments?.some((a) => a.cid === 'checkin-qr'));
    assert.equal((await b.get(`${base}/tickets/${pia.id}/proofs/${both.proofs[0].id}`)).status, 200, 'still viewable after approval');
    assert.equal((await b.post(`${base}/tickets/${pia.id}/approve`)).body.error, 'not_in_review');
    // The upload history, with what became of each proof.
    const history = (await b.get(base)).body.tickets.find((x: { id: number }) => x.id === pia.id);
    assert.equal(history.proofs.length, 0, 'none left to verify');
    assert.deepEqual(
      history.uploads.map((u: { name: string; outcome: string }) => [u.name, u.outcome]),
      [['receipt.pdf', 'replaced'], ['new.png', 'approved'], ['rest.pdf', 'approved']],
    );

    // Partial refund (an excess amount): the proof of refund is required and emailed, not kept.
    const refund = (tid: number) => b.multipart('post', `${base}/tickets/${tid}/refund`);
    assert.equal((await refund(pia.id).field('type', 'partial').field('amount', '50')).body.error, 'file_missing');
    const partial = await refund(pia.id).field('type', 'partial').field('amount', '50').field('note', 'You paid ₱550.').attach('file', PDF, 'refund.pdf');
    assert.equal(partial.status, 200, JSON.stringify(partial.body));
    assert.equal(partial.body.status, 'confirmed', 'still registered');
    const partialMail = await waitForMail((m) => [m.to].flat().includes('pia@x.test') && /Partial refund/.test(m.subject));
    assert.ok(partialMail.attachments?.some((a) => a.filename === 'proof-of-refund.pdf'), 'proof of refund attached');
    // …and kept: viewable from the registration.
    const kept = (await b.get(base)).body.tickets.find((x: { id: number }) => x.id === pia.id).refunds[0];
    assert.equal(kept.hasProof, true);
    const keptFile = await b.get(`${base}/refunds/${kept.id}/proof`);
    assert.equal(keptFile.status, 200);
    assert.equal(keptFile.headers['content-type'], 'application/pdf');
    assert.match(partialMail.text, /₱50/);
    assert.equal(proofFiles().length, 3, 'the proof of refund is stored apart from proofs of payment');
    // Full refund, registration kept, no attachment.
    const fullKeep = await refund(pia.id).field('type', 'full').field('amount', '999').field('cancel', 'false');
    assert.equal(fullKeep.status, 200, JSON.stringify(fullKeep.body));
    assert.equal(fullKeep.body.status, 'confirmed');
    const keepMail = await waitForMail((m) => [m.to].flat().includes('pia@x.test') && /^Refund for Paid Class$/.test(m.subject));
    assert.match(keepMail.text, /registration stays active/);
    assert.match(keepMail.text, /₱450/, 'full = what is left: ₱500 paid − ₱50 already refunded (a typed amount is ignored)');
    assert.equal((await refund(pia.id).field('type', 'full').field('cancel', 'false')).body.error, 'nothing_to_refund');
    // Full refund that cancels: place freed, QR code stops working.
    const fullCancel = await refund(pia.id).field('type', 'full').field('cancel', 'true').attach('file', PNG, 'refund.png');
    assert.equal(fullCancel.status, 200, JSON.stringify(fullCancel.body));
    assert.equal(fullCancel.body.status, 'revoked');
    assert.equal(fullCancel.body.refunds.length, 0, 'refunds are listed on the event page');
    const cancelMail = await waitForMail((m) => [m.to].flat().includes('pia@x.test') && /registration cancelled/.test(m.subject));
    assert.ok(cancelMail.attachments?.some((a) => a.filename === 'proof-of-refund.png'));
    const listed = (await b.get(base)).body.tickets.find((x: { id: number }) => x.id === pia.id);
    assert.deepEqual(listed.refunds.map((r: { type: string; cancelled: boolean }) => [r.type, r.cancelled]), [['partial', false], ['full', false], ['full', true]]);
    assert.equal((await b.post(`${base}/check-in`, { ticketId: pia.id, force: true })).body.state, 'revoked');

    // The activity log: everything that happened to Pia's registration, in order.
    const log = await b.get(`${base}/tickets/${pia.id}/log`);
    assert.equal(log.status, 200, JSON.stringify(log.body));
    const actions = log.body.entries.map((x: { action: string }) => x.action);
    assert.deepEqual(actions.slice(0, 3), ['registered', 'proof_uploaded', 'another_proof_requested']);
    for (const a of ['additional_proof_requested', 'payment_approved', 'partial_refund', 'full_refund']) assert.ok(actions.includes(a), `logged: ${a}`);
    assert.equal(log.body.entries.find((x: { action: string }) => x.action === 'payment_approved').by, 'Olivia Owner');

    // Manual Register: paid to the business directly, or free; confirmed now, QR code emailed.
    const cash = await b.post(`${base}/tickets/manual`, { name: 'Cash Carl', email: 'carl@x.test', phone: '+63 917 555 0100', amount: 500 });
    assert.equal(cash.status, 201, JSON.stringify(cash.body));
    assert.equal(cash.body.status, 'confirmed');
    await waitForMail((m) => [m.to].flat().includes('carl@x.test') && /registered/.test(m.subject));
    assert.equal((await b.post(`${base}/tickets/manual`, { name: 'Free Fay', email: 'fay@x.test', phone: '+63 917 555 0100', free: true })).status, 201);

    // Collections: payments (proof ₱500, cash ₱500, free ₱0) and refunds (₱50, the remaining ₱450, and a cancellation with nothing left).
    const col = await b.get(`${base}/collections`);
    assert.equal(col.status, 200, JSON.stringify(col.body));
    assert.equal(col.body.currency, 'PHP');
    assert.deepEqual([col.body.totals.collected, col.body.totals.refunded, col.body.totals.net], [1000, 500, 500]);
    assert.deepEqual([col.body.totals.payments, col.body.totals.free, col.body.totals.refunds], [2, 1, 3]);
    assert.equal(col.body.totals.labels.net, '₱500');
    assert.deepEqual(col.body.rows.map((r: { method: string }) => r.method), ['proof', 'partial', 'full', 'full', 'manual', 'free']);
    assert.equal(col.body.rows[col.body.rows.length - 1].running, 500, 'running total');

    // Bulk Manual Register: one name and email, several places (each its own code), one email.
    const bulk = await b.post(`${base}/tickets/manual`, { name: 'Group Gina', email: 'gina@x.test', phone: '+63 917 555 0100', quantity: 3, free: true });
    assert.equal(bulk.status, 201, JSON.stringify(bulk.body));
    assert.equal(bulk.body.count, 3);
    assert.equal(new Set(bulk.body.tickets.map((x: { code: string }) => x.code)).size, 3, 'a code each');
    const bulkMail = await waitForMail((m) => [m.to].flat().includes('gina@x.test') && /3 spots/.test(m.subject));
    assert.equal(bulkMail.attachments?.filter((x) => x.filename.endsWith('.png')).length, 3, 'every QR code attached');
    assert.equal(outbox.filter((m) => [m.to].flat().includes('gina@x.test')).length, 1, 'one email, not three');
    // Never more than the places left, checked when saving.
    const tooMany = await b.post(`${base}/tickets/manual`, { name: 'Big Group', email: 'big@x.test', phone: '+63 917 555 0100', quantity: 500, free: true });
    assert.equal(tooMany.status, 409);
    assert.equal(tooMany.body.error, 'not_enough_places');
    assert.match(tooMany.body.message, /Only \d+ spots? left/);

    // Asked for a proof and none within 10 hours: removed, place freed, proof deleted.
    await register('late@x.test', [PNG, 'late.png']);
    const lateId = (await b.get(base)).body.tickets.find((x: { email: string }) => x.email === 'late@x.test').id;
    await b.post(`${base}/tickets/${lateId}/request-proof`, { kind: 'replace' });
    const lateLink = linkIn((await waitForMail((m) => [m.to].flat().includes('late@x.test') && /send another proof/.test(m.subject))).text);
    assert.equal((await t.app.get(PaymentReviewJob).run(new Date())).expired, 0, 'not yet');
    const result = await t.app.get(PaymentReviewJob).run(new Date(Date.now() + 10 * 3_600_000 + 60_000));
    assert.equal(result.expired, 1);
    assert.equal((await b.get(base)).body.tickets.find((x: { email: string }) => x.email === 'late@x.test').status, 'revoked', 'place freed, kept in the list');
    assert.equal(proofFiles().length, 4, 'its proof is kept');
    await waitForMail((m) => [m.to].flat().includes('late@x.test') && /Spot released/.test(m.subject));
    assert.equal((await upload(lateLink, PNG, 'x.png')).status, 404);

    // Rejected (not approved): emailed, no new upload; the registration is cancelled and the proof deleted.
    await register('nope@x.test', [PNG, 'nope.png']);
    const nopeId = (await b.get(base)).body.tickets.find((x: { email: string }) => x.email === 'nope@x.test').id;
    const nope = await b.post(`${base}/tickets/${nopeId}/reject`, { reason: 'No payment received.' });
    assert.equal(nope.status, 200, JSON.stringify(nope.body));
    assert.equal(nope.body.status, 'revoked');
    const nopeMail = await waitForMail((m) => [m.to].flat().includes('nope@x.test') && /Payment not approved/.test(m.subject));
    assert.match(nopeMail.text, /No payment received\./);
    assert.ok(!/#upload=/.test(nopeMail.text), 'no upload link');
    assert.equal(proofFiles().length, 5);

    // A registration awaiting verification can be removed by the business: place freed, proof kept.
    await register('gone@x.test', [PNG, 'g.png']);
    const goneId = (await b.get(base)).body.tickets.find((x: { email: string }) => x.email === 'gone@x.test').id;
    assert.equal((await b.delete(`${base}/tickets/${goneId}`)).status, 200);
    assert.equal((await b.get(base)).body.tickets.find((x: { id: number }) => x.id === goneId).status, 'revoked');
    assert.equal(proofFiles().length, 6);

    // Zipped export: the data files and every proof, in a folder per attendee (no payment QR codes).
    const zipped = await b.get(`${base}/export.zip`).buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    assert.equal(zipped.status, 200);
    assert.equal(zipped.headers['content-type'], 'application/zip');
    const names = (zipped.body as Buffer).toString('latin1');
    for (const n of ['README.txt', 'event.xlsx', 'attendees.csv', 'event.json', '/proofs-of-payment/']) assert.ok(names.includes(n), `zip has ${n}`);
    assert.match(names, /proofs-of-payment\/\d{3} Pia Payer \([A-Z0-9]{4}-[A-Z0-9]{4}\)\/1 replaced - receipt\.pdf/);
    assert.match(names, /\/2 approved - new\.webp/);
    assert.ok(!names.includes('event-payment-qr') && !/GCash.*\.webp/.test(names), 'no payment QR codes');

    // Deleting the event deletes its files.
    await b.post(`${base}/delete-code`);
    const delMail = await waitForMail((m) => [m.to].flat().includes('owner@clinic.test') && /Code to delete/.test(m.subject));
    assert.equal((await b.post(`${base}/delete`, { code: /(\d{6})$/.exec(delMail.subject)![1], notifyAttendees: false })).status, 200);
    assert.equal(proofFiles().length, 0, 'proofs deleted with the event');
  });

  it('promo codes: amount or percent off, usage limits, expiry; bulk applies place by place; in collections', async () => {
    const { b } = await newBusiness();
    const ev = await newEvent(b, { kind: 'paid', price: 500, currency: 'PHP', slug: 'promo-talk', title: 'Promo Talk' });
    await publishPaid(b, ev.id);
    const base = `/api/client/bookings/events/${ev.id}`;
    const promo = (body: object) => b.post(`${base}/promo-codes`, body);
    const save = await promo({ code: 'save 100', discountType: 'amount', discountValue: 100, usageLimit: 5 });
    assert.equal(save.status, 201, JSON.stringify(save.body));
    assert.equal(save.body.code, 'SAVE100', 'upper case, no spaces');
    assert.equal(save.body.label, '₱100 off');
    assert.equal((await promo({ code: 'SAVE100', discountType: 'amount', discountValue: 5 })).body.error, 'code_taken');
    assert.equal((await promo({ code: 'TOOMUCH', discountType: 'percent', discountValue: 120 })).status, 400);
    assert.equal((await promo({ code: 'LATE', discountType: 'amount', discountValue: 10, expiresOn: inDays(7) })).body.error, 'validation_failed', 'not on or after the event day');
    assert.equal((await promo({ code: 'HALF', discountType: 'percent', discountValue: 50, usageLimit: 1, expiresOn: inDays(6) })).status, 201, 'the day before the event is fine');
    assert.equal((await promo({ code: 'OLD', discountType: 'amount', discountValue: 50, expiresOn: inDays(-1) })).status, 201);

    // The registration page's quote: the price with and without it.
    const quote = (code: string, quantity = 1) => request(t.server).get(`/api/public/bookings/smile-clinic/events/promo-talk/promo?code=${code}&quantity=${quantity}`).set('Host', BOOKINGS);
    const q1 = await quote('save100');
    assert.equal(q1.status, 200, JSON.stringify(q1.body));
    assert.deepEqual([q1.body.valid, q1.body.totalWithout, q1.body.total, q1.body.totalLabel], [true, 500, 400, '₱400']);
    assert.equal((await quote('OLD')).body.reason, 'This promo code has expired.');
    assert.equal((await quote('NOPE')).body.valid, false);
    const q7 = await quote('SAVE100', 7);
    assert.deepEqual([q7.body.qualified, q7.body.total], [5, 3000], '5 of 7 places discounted');

    // Bulk Manual Register with the code: 5 places get it, 2 pay the full price.
    const bulk = await b.post(`${base}/tickets/manual`, { name: 'Team Tess', email: 'tess@x.test', phone: '+63 917 555 0100', quantity: 7, promoCode: 'SAVE100' });
    assert.equal(bulk.status, 201, JSON.stringify(bulk.body));
    assert.equal(bulk.body.promoted, 5);
    assert.deepEqual(bulk.body.tickets.map((x: { amountPaid: number }) => x.amountPaid), [400, 400, 400, 400, 400, 500, 500]);
    assert.equal((await quote('SAVE100')).body.reason, 'This promo code has been used up.');
    assert.equal((await b.get(`${base}/promo-codes`)).body.promoCodes.find((x: { code: string }) => x.code === 'SAVE100').status, 'used_up');

    // The registration form: a one-time 50% code.
    const png = await sharp({ create: { width: 200, height: 200, channels: 3, background: '#123' } }).png().toBuffer();
    const reg = (email: string, code: string) =>
      request(t.server).post('/api/public/bookings/smile-clinic/events/promo-talk/register-paid').set('Host', BOOKINGS).field('firstName', 'Hal').field('lastName', 'F').field('email', email).field('phone', '+63 917 555 0100').field('promoCode', code).attach('file', png, 'p.png');
    const half = await reg('hal@x.test', 'half');
    assert.equal(half.status, 201, JSON.stringify(half.body));
    assert.equal(half.body.amountLabel, '₱250');
    assert.equal((await reg('hal2@x.test', 'HALF')).body.error, 'bad_promo', 'one-time: already used');
    const hal = (await b.get(base)).body.tickets.find((x: { email: string }) => x.email === 'hal@x.test');
    assert.deepEqual([hal.promoCode, hal.discount], ['HALF', 250]);
    assert.equal((await b.post(`${base}/tickets/${hal.id}/approve`)).body.amountPaid, 250, 'paid the discounted price');

    // Collections: the promo and discount per payment, and the total discounts.
    const col = (await b.get(`${base}/collections`)).body;
    assert.equal(col.totals.collected, 3000 + 250);
    assert.equal(col.totals.discounts, 500 + 250);
    assert.equal(col.totals.promoUses, 6);
    assert.equal(col.rows.find((r: { promoCode: string }) => r.promoCode === 'HALF').discountLabel, '₱250');

    // The exports carry it all: attendance analysis, collections, refunds and promo codes.
    const exp = JSON.parse((await b.get(`${base}/export.json`)).text);
    assert.equal(exp.event.attendance.registered, 8);
    assert.equal(exp.event.attendance.notAdmitted, 8);
    assert.equal(exp.event.collections.discounts, 750);
    assert.equal(exp.promoCodes.find((p: { code: string }) => p.code === 'SAVE100').places, 5);
    assert.equal(exp.collections.length, 8);
    assert.ok(exp.attendees.every((a: { admitted: boolean }) => typeof a.admitted === 'boolean'));
    const x = await b.get(`${base}/export.xlsx`).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    // The workbook is a zip: read its (deflated) workbook.xml for the tab names.
    const buf = x.body as Buffer;
    const at = buf.indexOf(Buffer.from('xl/workbook.xml'));
    const local = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x03, 0x04]), at);
    const size = buf.readUInt32LE(local + 18);
    const nameLen = buf.readUInt16LE(local + 26);
    const raw = buf.subarray(local + 30 + nameLen, local + 30 + nameLen + size);
    const workbook = (buf.readUInt16LE(local + 8) === 8 ? zlib.inflateRawSync(raw) : raw).toString('utf8');
    for (const n of ['Attendance analysis', 'Collections', 'Refunds', 'Promo codes']) assert.ok(workbook.includes(n), `xlsx has ${n}`);
    // Free events have no promo codes.
    const free = await newEvent(b, { slug: 'free-promo', date: inDays(9) });
    assert.equal((await b.post(`/api/client/bookings/events/${free.id}/promo-codes`, { code: 'NOPE', discountType: 'amount', discountValue: 1 })).body.error, 'free_event');
  });

  it('refund requests: emailed link, the attendee gives a QR code or bank details, completed with the proof', async () => {
    const { b } = await newBusiness();
    const ev = await newEvent(b, { kind: 'paid', price: 500, currency: 'PHP', slug: 'refund-talk', title: 'Refund Talk' });
    await publishPaid(b, ev.id);
    const base = `/api/client/bookings/events/${ev.id}`;
    const pub = '/api/public/bookings/smile-clinic/events/refund-talk';
    const ann = (await b.post(`${base}/tickets/manual`, { name: 'Ann Refund', email: 'ann@x.test', phone: '+63 917 555 0100', amount: 500 })).body;

    assert.equal((await b.post(`${base}/tickets/${ann.id}/refund-request`, { type: 'partial', amount: 900 })).status, 400, 'not more than is left');
    const req1 = await b.post(`${base}/tickets/${ann.id}/refund-request`, { type: 'full', cancel: true, note: 'The event moved.' });
    assert.equal(req1.status, 201, JSON.stringify(req1.body));
    assert.deepEqual([req1.body.status, req1.body.amount], ['waiting', '₱500']);
    assert.equal((await b.post(`${base}/tickets/${ann.id}/refund-request`, { type: 'full' })).body.error, 'already_requested');
    const mail = await waitForMail((m) => [m.to].flat().includes('ann@x.test') && /where should we send it/.test(m.subject));
    const token = /#refund=(\d+\.[0-9a-f]{48})/.exec(mail.text)![1];

    // The attendee: what it's for, then bank details.
    const info = await request(t.server).get(`${pub}/refund-request`).set('Host', BOOKINGS).set('X-Refund-Token', token);
    assert.deepEqual([info.status, info.body.amount, info.body.note], [200, '₱500', 'The event moved.']);
    assert.equal((await request(t.server).post(`${pub}/refund-request`).set('Host', BOOKINGS).field('token', token).field('method', 'bank').field('bankName', 'BDO')).status, 400, 'bank details complete');
    const sent = await request(t.server).post(`${pub}/refund-request`).set('Host', BOOKINGS).field('token', token).field('method', 'bank').field('bankName', 'BDO').field('accountName', 'Ann Refund').field('accountNumber', '0012 3456 7890');
    assert.equal(sent.status, 200, JSON.stringify(sent.body));
    await waitForMail((m) => [m.to].flat().includes('owner@clinic.test') && /Refund details received: Ann Refund/.test(m.subject));
    const listed = (await b.get(`${base}/refund-requests`)).body.requests[0];
    assert.deepEqual([listed.status, listed.method, listed.accountNumber], ['submitted', 'bank', '0012 3456 7890']);

    // Completed: the proof of refund is required, emailed, and the refund recorded.
    assert.equal((await b.multipart('post', `${base}/refund-requests/${listed.id}/complete`)).body.error, 'file_missing');
    const pdf = Buffer.from('%PDF-1.4 refund %%EOF');
    const done = await b.multipart('post', `${base}/refund-requests/${listed.id}/complete`).attach('file', pdf, 'refund.pdf');
    assert.equal(done.status, 200, JSON.stringify(done.body));
    assert.equal(done.body.status, 'completed');
    const refundMail = await waitForMail((m) => [m.to].flat().includes('ann@x.test') && /Refund for Refund Talk/.test(m.subject));
    assert.ok(refundMail.attachments?.some((x) => x.filename === 'proof-of-refund.pdf'));
    const tk = (await b.get(base)).body.tickets.find((x: { id: number }) => x.id === ann.id);
    assert.equal(tk.status, 'revoked', 'cancelled as asked');
    assert.equal(tk.refunds[0].amount, '₱500');
    assert.equal((await b.get(`${base}/collections`)).body.totals.net, 0);
    assert.equal((await request(t.server).get(`${pub}/refund-request`).set('Host', BOOKINGS).set('X-Refund-Token', token)).status, 404, 'the link closes');
    const actions = (await b.get(`${base}/tickets/${ann.id}/log`)).body.entries.map((x: { action: string }) => x.action);
    for (const x of ['refund_requested', 'refund_details_received', 'full_refund']) assert.ok(actions.includes(x), `logged: ${x}`);
  });

  it('cover photo and logo: images only, stored as WebP, shown on the event page', async () => {
    const { b } = await newBusiness();
    const ev = await newEvent(b, { slug: 'pretty-talk' });
    const img = await sharp({ create: { width: 3000, height: 1200, channels: 3, background: '#a33' } }).jpeg().toBuffer();
    assert.equal((await b.multipart('post', `/api/client/bookings/events/${ev.id}/media/cover`).attach('file', Buffer.from('%PDF-1.4 x'), 'x.pdf')).body.error, 'file_type', 'images only');
    const cover = await b.multipart('post', `/api/client/bookings/events/${ev.id}/media/cover`).attach('file', img, 'cover.jpg');
    assert.equal(cover.status, 200, JSON.stringify(cover.body));
    const logo = await b.multipart('post', `/api/client/bookings/events/${ev.id}/media/logo`).attach('file', img, 'logo.jpg');
    assert.equal(logo.status, 200);
    const page = (await pub('/pretty-talk')).body.event;
    assert.equal(page.coverUrl, cover.body.url);
    const served = await request(t.server).get(page.coverUrl).set('Host', BOOKINGS);
    assert.equal(served.headers['content-type'], 'image/webp');
    assert.equal((await sharp(served.body).metadata()).width, 2000, 'cover at most 2000 px');
    assert.equal((await sharp((await request(t.server).get(page.logoUrl).set('Host', BOOKINGS)).body).metadata()).width, 600, 'logo at most 600 px');
    assert.equal((await b.delete(`/api/client/bookings/events/${ev.id}/media/logo`)).status, 200);
    assert.equal((await pub('/pretty-talk')).body.event.logoUrl, null);
  });

  it('bulk booking on the registration page: free and paid; a promo applies place by place; approved together; one email with every QR code and a PDF', async () => {
    const { b } = await newBusiness();
    // Free: 3 places, one name and email.
    const fe = await newEvent(b, { slug: 'group-free', capacity: 10 });
    const free = await post('/group-free/register', { firstName: 'Gia', lastName: 'Group', email: 'gia@x.test', phone: '+63 917 555 0100', quantity: 3 });
    assert.equal(free.status, 201, JSON.stringify(free.body));
    assert.equal(free.body.count, 3);
    assert.equal(new Set(free.body.places.map((p: { code: string }) => p.code)).size, 3, 'a QR code each');
    const freeMail = await waitForMail((m) => [m.to].flat().includes('gia@x.test') && /3 spots/.test(m.subject));
    assert.ok(freeMail.attachments?.some((x) => x.filename === 'qr-codes.pdf'), 'the consolidated PDF is attached');
    assert.equal(freeMail.attachments?.filter((x) => x.filename.endsWith('.png')).length, 3);
    const pdf = await request(t.server).get(`/api/public/bookings/smile-clinic/events/group-free/qr-codes.pdf?t=${free.body.cancelToken}`).set('Host', BOOKINGS).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    assert.equal(pdf.status, 200);
    assert.equal(pdf.headers['content-type'], 'application/pdf');
    assert.equal((pdf.body as Buffer).subarray(0, 5).toString(), '%PDF-');
    assert.equal((await post('/group-free/register', { firstName: 'Too', lastName: 'Many', email: 'tm@x.test', phone: '+63 917 555 0100', quantity: 8 })).body.error, 'not_enough_places', 'never more than the places left');

    // Paid: 7 places, a promo with 5 uses: 5 discounted, 2 full price; one proof; approved together.
    const ev = await newEvent(b, { kind: 'paid', price: 500, currency: 'PHP', slug: 'group-paid', title: 'Group Paid', date: inDays(9) });
    await publishPaid(b, ev.id);
    const base = `/api/client/bookings/events/${ev.id}`;
    await b.post(`${base}/promo-codes`, { code: 'FIVE', discountType: 'amount', discountValue: 100, usageLimit: 5 });
    const quote = await request(t.server).get('/api/public/bookings/smile-clinic/events/group-paid/promo?code=FIVE&quantity=7').set('Host', BOOKINGS);
    assert.deepEqual([quote.body.qualified, quote.body.totalWithout, quote.body.total], [5, 3500, 3000]);
    const png = await sharp({ create: { width: 200, height: 200, channels: 3, background: '#123' } }).png().toBuffer();
    const paid = await request(t.server)
      .post('/api/public/bookings/smile-clinic/events/group-paid/register-paid')
      .set('Host', BOOKINGS)
      .field('firstName', 'Pat')
      .field('lastName', 'Team')
      .field('email', 'team@x.test')
      .field('phone', '+63 917 555 0100')
      .field('quantity', '7')
      .field('promoCode', 'five')
      .attach('file', png, 'proof.png');
    assert.equal(paid.status, 201, JSON.stringify(paid.body));
    assert.deepEqual([paid.body.places, paid.body.promoted, paid.body.amountLabel], [7, 5, '₱3,000']);
    const group = (await b.get(base)).body.tickets.filter((x: { email: string }) => x.email === 'team@x.test');
    assert.equal(group.length, 7);
    assert.ok(group.every((x: { status: string; groupId: string }) => x.status === 'review' && x.groupId === group[0].groupId));
    assert.ok(group.every((x: { code: string | null }) => x.code === null), 'no codes until the payment is confirmed');
    const ok = await b.post(`${base}/tickets/${group[3].id}/approve`);
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.places, 7, 'the whole booking approved at once');
    const after = (await b.get(base)).body.tickets.filter((x: { email: string }) => x.email === 'team@x.test');
    assert.ok(after.every((x: { status: string }) => x.status === 'confirmed'));
    assert.equal(new Set(after.map((x: { code: string }) => x.code).filter(Boolean)).size, 7, 'a code for every spot once approved');
    assert.deepEqual(after.map((x: { amountPaid: number }) => x.amountPaid).sort(), [400, 400, 400, 400, 400, 500, 500]);
    const teamMail = await waitForMail((m) => [m.to].flat().includes('team@x.test') && /7 spots/.test(m.subject));
    assert.ok(teamMail.attachments?.some((x) => x.filename === 'qr-codes.pdf'));
    assert.equal(outbox.filter((m) => [m.to].flat().includes('team@x.test') && /registered/.test(m.subject)).length, 1, 'one confirmation email for the booking');

    // Everything else acts on the whole booking too (unless "only this spot"); the codes stay one per spot.
    const team = () => b.get(base).then((r) => r.body.tickets.filter((x: { email: string }) => x.email === 'team@x.test').sort((x: { id: number }, y: { id: number }) => x.id - y.id));
    const PDF = Buffer.from('%PDF-1.4 refund %%EOF');
    // A partial refund for the booking: spread over its spots, one email.
    const part = await b.multipart('post', `${base}/tickets/${after[2].id}/refund`).field('type', 'partial').field('amount', '700').attach('file', PDF, 'refund.pdf');
    assert.equal(part.status, 200, JSON.stringify(part.body));
    assert.equal(part.body.places, 7);
    const partMail = await waitForMail((m) => [m.to].flat().includes('team@x.test') && /Partial refund/.test(m.subject));
    assert.match(partMail.text, /₱700/);
    await sleep(100);
    assert.equal(outbox.filter((m) => [m.to].flat().includes('team@x.test') && /Partial refund/.test(m.subject)).length, 1, 'one email for the booking');
    const refunded = (await team()).reduce((a: number, x: { refunds: { amountValue: number }[] }) => a + x.refunds.reduce((c, r) => c + r.amountValue, 0), 0);
    assert.equal(refunded, 700);
    // Only this spot: a request for its own balance.
    const last = (await team())[6];
    const one = await b.post(`${base}/tickets/${last.id}/refund-request`, { type: 'full', scope: 'spot' });
    assert.equal(one.status, 201, JSON.stringify(one.body));
    assert.deepEqual([one.body.amount, one.body.spots], ['₱500', 1]);
    assert.equal((await b.post(`${base}/tickets/${after[0].id}/refund-request`, { type: 'full' })).body.error, 'already_requested', 'one open request per booking');
    await b.post(`${base}/refund-requests/${one.body.id}/cancel`);
    // The whole booking: what's left over every spot; completed, every spot cancelled.
    const all = await b.post(`${base}/tickets/${after[0].id}/refund-request`, { type: 'full', cancel: true });
    assert.equal(all.status, 201, JSON.stringify(all.body));
    assert.deepEqual([all.body.amount, all.body.spots], ['₱2,300', 7]);
    const reqMail = await waitForMail((m) => [m.to].flat().includes('team@x.test') && /where should we send it/.test(m.subject) && /7 spots/.test(m.text));
    const tok = /#refund=(\d+\.[0-9a-f]{48})/.exec(reqMail.text)![1];
    const pubBase = '/api/public/bookings/smile-clinic/events/group-paid';
    assert.equal((await request(t.server).get(`${pubBase}/refund-request`).set('Host', BOOKINGS).set('X-Refund-Token', tok)).body.spots, 7);
    assert.equal((await request(t.server).post(`${pubBase}/refund-request`).set('Host', BOOKINGS).field('token', tok).field('method', 'bank').field('bankName', 'BDO').field('accountName', 'Pat Team').field('accountNumber', '001')).status, 200);
    const fin = await b.multipart('post', `${base}/refund-requests/${all.body.id}/complete`).attach('file', PDF, 'refund.pdf');
    assert.equal(fin.status, 200, JSON.stringify(fin.body));
    const closed = await team();
    assert.ok(closed.every((x: { status: string }) => x.status === 'revoked'), 'every spot cancelled');
    assert.equal(new Set(closed.map((x: { code: string }) => x.code)).size, 7, 'still a code per spot');
    const totalRefunded = closed.reduce((a: number, x: { refunds: { amountValue: number }[] }) => a + x.refunds.reduce((c, r) => c + r.amountValue, 0), 0);
    assert.equal(totalRefunded, 3000, 'everything paid back');
    assert.equal(outbox.filter((m) => [m.to].flat().includes('team@x.test') && /^Refund for/.test(m.subject)).length, 1, 'one refund email');

    // An unverified bulk booking is removed as a whole.
    const two = await request(t.server).post(`${pubBase}/register-paid`).set('Host', BOOKINGS).field('firstName', 'Duo').field('lastName', 'Pair').field('email', 'duo@x.test').field('phone', '+63 917 555 0100').field('quantity', '2').attach('file', png, 'proof.png');
    assert.equal(two.status, 201, JSON.stringify(two.body));
    const duo = (await b.get(base)).body.tickets.filter((x: { email: string }) => x.email === 'duo@x.test');
    assert.equal((await b.delete(`${base}/tickets/${duo[1].id}`)).status, 200);
    assert.ok((await b.get(base)).body.tickets.filter((x: { email: string }) => x.email === 'duo@x.test').every((x: { status: string }) => x.status === 'revoked'));

    // Free: revoke only one spot; the attendee then cancels the rest of the booking at once.
    const fbase = `/api/client/bookings/events/${fe.id}`;
    const gia = () => b.get(fbase).then((r) => r.body.tickets.filter((x: { email: string }) => x.email === 'gia@x.test'));
    const rv = await b.post(`${fbase}/tickets/${(await gia())[0].id}/revoke`, { scope: 'spot' });
    assert.deepEqual([rv.status, rv.body.places], [200, 1]);
    assert.deepEqual((await gia()).map((x: { status: string }) => x.status).sort(), ['confirmed', 'confirmed', 'revoked']);
    const reg = await request(t.server).get('/api/public/bookings/smile-clinic/events/group-free/registration').set('Host', BOOKINGS).set('X-Registration-Token', free.body.cancelToken);
    assert.deepEqual([reg.body.spots, reg.body.canCancel], [2, true]);
    const cx = await post('/group-free/cancel', { token: free.body.cancelToken });
    assert.equal(cx.status, 200, JSON.stringify(cx.body));
    assert.deepEqual((await gia()).map((x: { status: string }) => x.status).sort(), ['cancelled', 'cancelled', 'revoked']);
    await waitForMail((m) => [m.to].flat().includes('gia@x.test') && /Registration cancelled/.test(m.subject) && /2 spots/.test(m.text));
  });

  it('the date and times can be changed after people register (the editor sends every field)', async () => {
    const { b } = await newBusiness();
    const ev = await newEvent(b, { kind: 'paid', price: 500, currency: 'PHP', slug: 'move-me', title: 'Move Me', published: false });
    await publishPaid(b, ev.id);
    const png = await sharp({ create: { width: 50, height: 50, channels: 3, background: '#123' } }).png().toBuffer();
    const reg = await request(t.server).post('/api/public/bookings/smile-clinic/events/move-me/register-paid').set('Host', BOOKINGS).field('firstName', 'Mo').field('lastName', 'Ve').field('email', 'mo@x.test').field('phone', '+63 917 555 0100').attach('file', png, 'p.png');
    assert.equal(reg.status, 201, JSON.stringify(reg.body));
    const e = (await b.get(`/api/client/bookings/events/${ev.id}`)).body.event;
    const body = { title: e.title, slug: e.slug, kind: e.kind, price: e.price, currency: e.currency, description: e.description, date: inDays(12), startMinute: 600, timeZone: e.timeZone, endMinute: 720, format: e.format, address: e.address, addressDetails: e.addressDetails, latitude: e.latitude, longitude: e.longitude, meetingUrl: null, capacity: e.capacity, published: e.published, registerLabel: e.registerLabel };
    const moved = await b.patch(`/api/client/bookings/events/${ev.id}`, body);
    assert.equal(moved.status, 200, JSON.stringify(moved.body));
    const after = (await b.get(`/api/client/bookings/events/${ev.id}`)).body.event;
    assert.deepEqual([after.date, after.startMinute, after.endMinute], [inDays(12), 600, 720], JSON.stringify(moved.body).slice(0, 300));
  });

  it('paid: reserve first (2 hours, the upload link on the page and by email, once), then verified; full: the waitlist, offered freed spots in order', async () => {
    const { b } = await newBusiness();
    const ev = await newEvent(b, { kind: 'paid', price: 500, currency: 'PHP', slug: 'reserve-me', title: 'Reserve Me', capacity: 3, published: false });
    await publishPaid(b, ev.id);
    const api = '/api/public/bookings/smile-clinic/events/reserve-me';
    const base = `/api/client/bookings/events/${ev.id}`;
    const reserve = (first: string, email: string, quantity = 1) => post('/reserve-me/register-paid', { firstName: first, lastName: 'Lee', email, phone: '+63 917 555 0100', quantity });
    const png = await sharp({ create: { width: 50, height: 50, channels: 3, background: '#123' } }).png().toBuffer();
    const upload = (token: string) => request(t.server).post(`${api}/payment`).set('Host', BOOKINGS).field('token', token).attach('file', png, 'p.png');
    const linkIn = (text: string) => /#upload=(\d+\.[0-9a-f]{48})/.exec(text)![1];

    // 1. The details and the spots: reserved for 2 hours, no code yet, the link on the page and by email.
    const ann = await reserve('Ann', 'ann@r.test', 2);
    assert.equal(ann.status, 201, JSON.stringify(ann.body));
    assert.equal(ann.body.reserved, true);
    assert.equal(ann.body.amountLabel, '₱1,000');
    assert.ok(Math.abs(new Date(ann.body.reservedUntil).getTime() - Date.now() - 2 * 3_600_000) < 60_000, '2 hours');
    const annMail = await waitForMail((m) => [m.to].flat().includes('ann@r.test') && /^Reserved: Reserve Me/.test(m.subject));
    assert.equal(linkIn(annMail.text), ann.body.token, 'the same link by email, in case the page is closed');
    let list = (await b.get(base)).body.tickets;
    assert.deepEqual(list.map((x: { status: string; code: string | null }) => [x.status, x.code]), [['reserved', null], ['reserved', null]]);
    const what = await request(t.server).get(`${api}/upload-request`).set('Host', BOOKINGS).set('X-Upload-Token', ann.body.token);
    assert.deepEqual([what.body.status, what.body.kind, what.body.places, what.body.amountLabel], ['reserved', 'first', 2, '₱1,000']);

    // 2. The proof: for verification. The link works once.
    const sent = await upload(ann.body.token);
    assert.equal(sent.status, 200, JSON.stringify(sent.body));
    assert.deepEqual([sent.body.review, sent.body.first, sent.body.places], [true, true, 2]);
    assert.equal((await upload(ann.body.token)).status, 404, 'no longer accessible once the proof is sent');
    assert.equal((await request(t.server).get(`${api}/upload-request`).set('Host', BOOKINGS).set('X-Upload-Token', ann.body.token)).status, 404);
    await waitForMail((m) => [m.to].flat().includes('ann@r.test') && /being verified/.test(m.subject));
    list = (await b.get(base)).body.tickets;
    assert.deepEqual(list.map((x: { status: string }) => x.status), ['review', 'review']);
    assert.equal(list[0].proofs.length, 1);

    // 3. Full (Ann's 2 to verify, Ben's reservation): one person joins the waitlist; a bulk booking can't.
    const ben = await reserve('Ben', 'ben@r.test');
    assert.equal(ben.body.reserved, true);
    assert.equal((await pub('/reserve-me')).body.status, 'waitlist');
    const bulk = await reserve('Bea', 'bea@r.test', 2);
    assert.equal(bulk.status, 409);
    assert.equal(bulk.body.error, 'not_enough_places');
    assert.match(bulk.body.message, /aren’t enough spots for 2 people.*bulk bookings can’t join the waitlist/i);
    const cy = await reserve('Cy', 'cy@r.test');
    assert.equal(cy.status, 201, JSON.stringify(cy.body));
    assert.deepEqual([cy.body.waitlisted, cy.body.position, cy.body.token], [true, 1, undefined], 'no payment link');
    const cyMail = await waitForMail((m) => [m.to].flat().includes('cy@r.test') && /waitlist/.test(m.subject));
    assert.ok(!/#upload=/.test(cyMail.text), 'no payment link while waiting');
    assert.equal((await reserve('Cy', 'CY@r.test')).body.error, 'already_waiting');
    const dee = await reserve('Dee', 'dee@r.test');
    assert.equal(dee.body.position, 2);

    // 4. Ben's 2 hours pass: his reservation expires, the spot goes to Cy (the first in line) with the link.
    const job = t.app.get(PaymentReviewJob);
    assert.equal((await job.run(new Date(Date.now() + 60 * 60_000))).reservationsExpired, 0, 'not yet');
    const r = await job.run(new Date(Date.now() + 2 * 3_600_000 + 60_000));
    assert.deepEqual([r.reservationsExpired, r.offered], [1, 1]);
    await waitForMail((m) => [m.to].flat().includes('ben@r.test') && /Reservation expired/.test(m.subject));
    const offer = await waitForMail((m) => [m.to].flat().includes('cy@r.test') && /A spot opened up/.test(m.subject));
    list = (await b.get(base)).body.tickets;
    const by = (email: string) => list.find((x: { email: string }) => x.email === email);
    assert.equal(by('ben@r.test').status, 'revoked');
    assert.equal(by('cy@r.test').status, 'reserved');
    assert.equal(by('dee@r.test').status, 'waitlist', 'still waiting: only one spot was freed');
    assert.equal((await upload(linkIn(offer.text))).status, 200, 'Cy pays with the link');

    // 5. Verified: the approved spots get their codes.
    const ok = await b.post(`${base}/tickets/${by('ann@r.test').id}/approve`, {});
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    list = (await b.get(base)).body.tickets;
    assert.ok(list.filter((x: { email: string }) => x.email === 'ann@r.test').every((x: { status: string; code: string | null }) => x.status === 'confirmed' && x.code));

    // 6. Every spot verified: the event is full, no waitlist (Dee is still in line).
    await b.post(`${base}/tickets/${by('cy@r.test').id}/approve`, {});
    await b.delete(`${base}/tickets/${by('dee@r.test').id}`);
    assert.equal((await pub('/reserve-me')).body.status, 'full');
    assert.equal((await reserve('Eve', 'eve@r.test')).body.error, 'full');
  });

  it('online: adding and changing the link emails confirmed attendees', async () => {
    const { b } = await newBusiness();
    const ev = await newEvent(b, { format: 'online', address: null, slug: 'webinar', title: 'Webinar' });
    await post('/webinar/register', { firstName: 'Eve', lastName: 'Online', email: 'eve@x.test', phone: '+1 416 555 0100' });
    // Online: no QR code or scanning, just the link.
    const reg = (await request(t.server).post('/api/public/bookings/smile-clinic/events/webinar/register').set('Host', BOOKINGS).send({ firstName: 'Ola', lastName: 'Online', email: 'ola@x.test', phone: '+1 416 555 0100' })).body;
    assert.equal(reg.online, true);
    assert.equal(reg.checkIn, null, 'no QR code on screen');
    const welcome = await waitForMail((m) => [m.to].flat().includes('ola@x.test') && /registered/.test(m.subject));
    assert.ok(!welcome.attachments?.some((a) => a.cid === 'checkin-qr'), 'no QR code in the email');
    assert.equal((await b.post(`/api/client/bookings/events/${ev.id}/scanners`, { email: 's@x.test', firstName: 'S', lastName: 'C' })).body.error, 'online_event');
    const added = await b.patch(`/api/client/bookings/events/${ev.id}`, { meetingUrl: 'https://meet.example.com/abc' });
    assert.equal(added.status, 200, JSON.stringify(added.body));
    assert.equal(added.body.emailed, 2);
    await waitForMail((m) => [m.to].flat().includes('eve@x.test') && /Your link to join/.test(m.subject));
    const changed = await b.patch(`/api/client/bookings/events/${ev.id}`, { meetingUrl: 'https://meet.example.com/xyz' });
    assert.equal(changed.body.emailed, 2);
    await waitForMail((m) => [m.to].flat().includes('eve@x.test') && /New link to join/.test(m.subject) && m.text.includes('xyz'));
    assert.equal((await b.patch(`/api/client/bookings/events/${ev.id}`, { title: 'Webinar 2' })).body.emailed, 0, 'no email without a link change');
    const webinarPage = await pub('/webinar');
    assert.equal(webinarPage.status, 200, JSON.stringify(webinarPage.body));
    assert.equal(webinarPage.body.event.meetingUrl, undefined, 'the link is not public');
  });

  it('checks in per event only: other events and appointment codes are refused', async () => {
    const { b } = await newBusiness();
    const today = await newEvent(b, { date: inDays(0), startMinute: 0, endMinute: 1439, slug: 'today-talk', title: 'Today talk' });
    const later = await newEvent(b, { slug: 'later-talk', title: 'Later talk' });
    const a = await post('/today-talk/register', { firstName: 'Fe', lastName: 'Today', email: 'fe@x.test', phone: '+1 416 555 0100' });
    const z = await post('/later-talk/register', { firstName: 'Gil', lastName: 'Later', email: 'gil@x.test', phone: '+1 416 555 0100' });

    const ok = await b.post(`/api/client/bookings/events/${today.id}/check-in`, { code: a.body.checkIn.code });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.state, 'ok');
    assert.equal(ok.body.checkedIn, true);
    const welcome = await waitForMail((m) => [m.to].flat().includes('fe@x.test') && /checked in/.test(m.subject));
    assert.match(welcome.text, /Today talk/);
    assert.equal((await b.post(`/api/client/bookings/events/${today.id}/check-in`, { code: a.body.checkIn.url })).body.state, 'already');
    await sleep(150);
    assert.equal(outbox.filter((m) => [m.to].flat().includes('fe@x.test') && /checked in/.test(m.subject)).length, 1, 'one email per check-in, not for a repeat scan');

    const wrong = await b.post(`/api/client/bookings/events/${today.id}/check-in`, { code: z.body.checkIn.code });
    assert.equal(wrong.status, 409);
    assert.equal(wrong.body.error, 'not_this_event');
    const early = await b.post(`/api/client/bookings/events/${later.id}/check-in`, { code: z.body.checkIn.code });
    assert.equal(early.body.state, 'early');
    assert.equal((await b.post(`/api/client/bookings/events/${later.id}/check-in`, { code: z.body.checkIn.code, force: true })).body.checkedIn, true);

    // The appointment scanner refuses event codes, and the event scanner refuses appointment codes.
    const onBookings = await b.post('/api/client/bookings/check-in', { code: a.body.checkIn.code });
    assert.equal(onBookings.body.error, 'event_code');
    const serviceId = await addService(b);
    const day = await openDay('smile-clinic', serviceId);
    await book('smile-clinic', { serviceId, startsAt: day.slots[0].startsAt });
    const [row] = (await b.get('/api/client/bookings/items')).body;
    const onEvent = await b.post(`/api/client/bookings/events/${today.id}/check-in`, { code: row.checkInCode });
    assert.equal(onEvent.body.error, 'not_this_event');
  });
});

describe('event scanners (link + access code, one device each) and attendee cancellation', () => {
  const SCANNER = 'scanner.localhost:5173';
  const inDays = (n: number) => addDays(todayIn('America/Toronto'), n);
  const scan = (publicId: string) => ({
    get: (path = '', token?: string) => request(t.server).get(`/api/scanner/${publicId}${path}`).set('Host', SCANNER).set('X-Scanner-Token', token ?? ''),
    post: (path: string, body: object, token?: string) => request(t.server).post(`/api/scanner/${publicId}${path}`).set('Host', SCANNER).set('X-Scanner-Token', token ?? '').send(body),
  });
  const reg = (event: string, email: string) =>
    request(t.server).post(`/api/public/bookings/smile-clinic/events/${event}/register`).set('Host', BOOKINGS).send({ firstName: 'Ana', lastName: 'Reyes', email, phone: '+1 416 555 0100' });
  async function todayEvent(b: Client, slug = 'open-day', body: object = {}) {
    const res = await b.post('/api/client/bookings/events', { retentionAgreed: true, title: 'Open day', slug, kind: 'free', date: inDays(0), startMinute: 0, endMinute: 1439, format: 'onsite', address: '1 Main St', published: true, ...body });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return res.body.id as number;
  }

  it('attendance scanners: a person with a role, a scanner code and an access code; one device; revoke and delete sign it out', async () => {
    const { b } = await newBusiness();
    const id = await todayEvent(b);
    assert.ok((await b.post(`/api/client/bookings/events/${id}/scanners`, { firstName: 'Mara', lastName: 'Santos' })).body.fields.email, 'email required');
    const made = await b.post(`/api/client/bookings/events/${id}/scanners`, { email: 'mara@x.test', firstName: 'Mara', lastName: 'Santos' });
    assert.equal(made.status, 201, JSON.stringify(made.body));
    const codes = await waitForMail((m) => [m.to].flat().includes('mara@x.test') && /event scanner codes/.test(m.subject));
    assert.ok(codes.text.includes(made.body.accessCode) && codes.text.includes(made.body.scanner.scannerCode), 'both codes emailed');
    assert.equal(made.body.scanner.role, 'Attendance', 'default role');
    assert.equal(made.body.scanner.name, 'Mara Santos');
    assert.match(made.body.accessCode, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    assert.match(made.body.scanner.scannerCode, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    assert.notEqual(made.body.accessCode, made.body.scanner.scannerCode);
    assert.match(made.body.scanner.url, /^http:\/\/scanner\.localhost:5173\/smile-clinic\/open-day\/[A-Z2-9]{8}$/);
    const s = scan(made.body.scanner.scannerCode);

    const page = await s.get();
    assert.equal(page.status, 200, JSON.stringify(page.body));
    assert.equal(page.body.company.name, 'Smile Clinic');
    assert.equal(page.body.event.title, 'Open day');
    assert.equal(page.body.scanner.role, 'Attendance');
    assert.equal((await s.post('/check-in', { code: 'ABCDEFGH' })).status, 401, 'not signed in');
    assert.equal((await s.post('/sign-in', { accessCode: 'ZZZZ-ZZZZ' })).body.error, 'bad_code');
    const first = await s.post('/sign-in', { accessCode: made.body.accessCode.toLowerCase() });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    const token = first.body.token as string;
    assert.equal((await s.post('/sign-in', { accessCode: made.body.accessCode })).body.error, 'code_in_use', 'one device per access code');

    const a = await reg('open-day', 'ana@x.test');
    const ok = await s.post('/check-in', { code: a.body.checkIn.code }, token);
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.checkedIn, true);
    assert.equal((await s.get('/session', token)).body.checkedIn, 1);
    assert.equal((await s.post('/undo', { ticketId: ok.body.ticket.id }, token)).status, 200);

    // Signing out on purpose frees the access code: the same code signs in again.
    assert.equal((await s.post('/sign-out', {}, token)).status, 200);
    assert.equal((await s.get('/session', token)).status, 401, 'that device is out');
    const back = await s.post('/sign-in', { accessCode: made.body.accessCode });
    assert.equal(back.status, 200, JSON.stringify(back.body));
    const token2 = back.body.token as string;
    assert.equal((await s.post('/sign-in', { accessCode: made.body.accessCode })).body.error, 'code_in_use', 'still one device at a time');
    void token2;

    // Revoke: the device is signed out; nobody gets in until a new access code.
    const scannerId = made.body.scanner.id;
    await b.post(`/api/client/bookings/events/${id}/scanners/${scannerId}/revoke`, {});
    const out = await s.get('/session', token);
    assert.equal(out.status, 401);
    assert.equal(out.body.error, 'access_revoked');
    assert.equal((await s.post('/sign-in', { accessCode: made.body.accessCode })).body.error, 'access_revoked');
    const fresh = await b.post(`/api/client/bookings/events/${id}/scanners/${scannerId}/code`, {});
    assert.notEqual(fresh.body.accessCode, made.body.accessCode);
    await waitForMail((m) => [m.to].flat().includes('mara@x.test') && /New scanner access code/.test(m.subject) && m.text.includes(fresh.body.accessCode));
    const again = await s.post('/sign-in', { accessCode: fresh.body.accessCode });
    assert.equal(again.status, 200);
    assert.equal((await s.get('/session', again.body.token)).status, 200);

    // Two per event; a custom role.
    const second = await b.post(`/api/client/bookings/events/${id}/scanners`, { email: 'leo@x.test', firstName: 'Leo', lastName: 'Cruz', role: 'Usher' });
    assert.equal(second.body.scanner.role, 'Usher');
    assert.equal((await b.post(`/api/client/bookings/events/${id}/scanners`, { email: 'third@x.test', firstName: 'Third', lastName: 'One' })).body.error, 'scanner_limit');

    // Deleted: signed out, and the scanner is gone.
    assert.equal((await b.delete(`/api/client/bookings/events/${id}/scanners/${scannerId}`)).status, 200);
    assert.equal((await s.get('/session', again.body.token)).status, 404);
    assert.equal((await s.get()).status, 404);

    // Paid onsite events have scanners and claimables too.
    const paid = await b.post('/api/client/bookings/events', { retentionAgreed: true, title: 'Paid', slug: 'paid-one', kind: 'paid', price: 10, currency: 'PHP', date: inDays(4), startMinute: 600, endMinute: 660, format: 'onsite', address: 'x' });
    assert.equal((await b.get(`/api/client/bookings/events/${paid.body.id}/scanners`)).body.allowed, true);
    const paidScanner = await b.post(`/api/client/bookings/events/${paid.body.id}/scanners`, { email: 'paid@x.test', firstName: 'Pia', lastName: 'Lim' });
    assert.equal(paidScanner.status, 201, JSON.stringify(paidScanner.body));
    assert.equal((await b.post(`/api/client/bookings/events/${paid.body.id}/claimables`, { name: 'Free Water' })).status, 201);
  });

  it('claimables: each has its own scanners; an attendee claims an item once; free plan 2 claimables, 2 scanners each', async () => {
    const { b } = await newBusiness();
    const id = await todayEvent(b, 'fun-run');
    const water = await b.post(`/api/client/bookings/events/${id}/claimables`, { name: 'Free Water' });
    assert.equal(water.status, 201, JSON.stringify(water.body));
    await b.post(`/api/client/bookings/events/${id}/claimables`, { name: 'Snack' });
    assert.equal((await b.post(`/api/client/bookings/events/${id}/claimables`, { name: 'Third' })).body.error, 'claimable_limit', 'free plan: 2 claimables');

    const sc = await b.post(`/api/client/bookings/events/${id}/scanners`, { email: 'w@x.test', firstName: 'Wes', lastName: 'Water', claimableId: water.body.id });
    assert.equal(sc.status, 201, JSON.stringify(sc.body));
    assert.equal(sc.body.scanner.role, 'Free Water', 'the role is the section');
    await b.post(`/api/client/bookings/events/${id}/scanners`, { email: 'w2@x.test', firstName: 'Wil', lastName: 'Water', claimableId: water.body.id });
    assert.equal((await b.post(`/api/client/bookings/events/${id}/scanners`, { email: 'w3@x.test', firstName: 'Way', lastName: 'Many', claimableId: water.body.id })).body.error, 'scanner_limit', '2 per claimable');
    // Attendance has its own two.
    assert.equal((await b.post(`/api/client/bookings/events/${id}/scanners`, { email: 'a@x.test', firstName: 'Ana', lastName: 'Door' })).status, 201);

    const list = await b.get(`/api/client/bookings/events/${id}/scanners`);
    assert.deepEqual(list.body.sections.map((x: { name: string }) => x.name), ['Attendance', 'Free Water', 'Snack']);
    const listed = list.body.sections[1].scanners.find((x: { id: number }) => x.id === sc.body.scanner.id);
    assert.equal(listed.accessCode, sc.body.accessCode, 'owners see both codes in the table');
    assert.equal(listed.scannerCode, sc.body.scanner.scannerCode);
    assert.equal(list.body.sections[1].scanners.length, 2);

    const s = scan(sc.body.scanner.scannerCode);
    const page = await s.get();
    assert.equal(page.body.section.name, 'Free Water');
    const token = (await s.post('/sign-in', { accessCode: sc.body.accessCode })).body.token;
    const a = await reg('fun-run', 'runner@x.test');
    const early = await s.post('/check-in', { code: a.body.checkIn.code }, token);
    assert.equal(early.body.state, 'not_checked_in', 'attendance must be scanned first');
    await b.post(`/api/client/bookings/events/${id}/check-in`, { code: a.body.checkIn.code });
    const first = await s.post('/check-in', { code: a.body.checkIn.code }, token);
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(first.body.kind, 'claim');
    assert.equal(first.body.state, 'claimed');
    const second = await s.post('/check-in', { code: a.body.checkIn.code }, token);
    assert.equal(second.body.state, 'already', 'once per attendee');
    assert.equal((await s.get('/session', token)).body.claimed, 1);
    const detail = await b.get(`/api/client/bookings/events/${id}`);
    assert.equal(detail.body.tickets[0].claims[0].claimableId, water.body.id, 'shown on the attendee');
    assert.equal((await s.post('/undo', { ticketId: first.body.ticket.id }, token)).status, 200);
    assert.equal((await s.post('/check-in', { code: a.body.checkIn.code }, token)).body.state, 'claimed', 'claimable again after undo');

    // The business can scan claims too, from its own scanner page.
    const snack = list.body.sections[2];
    const here = await b.post(`/api/client/bookings/events/${id}/claimables/${snack.id}/claim`, { code: a.body.checkIn.code });
    assert.equal(here.status, 200, JSON.stringify(here.body));
    assert.equal(here.body.state, 'claimed');
    assert.equal((await b.post(`/api/client/bookings/events/${id}/claimables/${snack.id}/claim`, { code: a.body.checkIn.code })).body.state, 'already');
    assert.equal((await b.post(`/api/client/bookings/events/${id}/claimables/${snack.id}/undo`, { ticketId: here.body.ticket.id })).status, 200);

    // Deleting a claimable removes its scanners (signed out).
    assert.equal((await b.delete(`/api/client/bookings/events/${id}/claimables/${water.body.id}`)).status, 200);
    assert.equal((await s.get('/session', token)).status, 404);
  });

  it('free events: the attendee cancels with the link in the email and can register again; paid events can’t be cancelled', async () => {
    const { b } = await newBusiness();
    await todayEvent(b, 'free-talk', { registerLabel: 'Save my seat' });
    const page = await request(t.server).get('/api/public/bookings/smile-clinic/events/free-talk').set('Host', BOOKINGS);
    assert.equal(page.body.event.registerLabel, 'Save my seat');
    const r = await reg('free-talk', 'cy@x.test');
    const mail = await waitForMail((m) => [m.to].flat().includes('cy@x.test') && /registered/.test(m.subject));
    assert.match(mail.text, /Cancel my registration: http:\/\/bookings\.localhost:5173\/smile-clinic\/e\/free-talk#cancel=\d+\.[0-9a-f]{32}/);
    const token = /#cancel=([\d.a-f]+)/.exec(mail.text)![1];
    assert.equal(token, r.body.cancelToken);

    const pub = (path: string) => request(t.server).post(`/api/public/bookings/smile-clinic/events/free-talk${path}`).set('Host', BOOKINGS);
    const who = await request(t.server).get('/api/public/bookings/smile-clinic/events/free-talk/registration').set('Host', BOOKINGS).set('X-Registration-Token', token);
    assert.equal(who.body.canCancel, true);
    assert.equal((await pub('/cancel').send({ token: '1.' + 'a'.repeat(32) })).status, 404, 'a wrong link');
    const cancelled = await pub('/cancel').send({ token });
    assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
    await waitForMail((m) => [m.to].flat().includes('cy@x.test') && /Registration cancelled/.test(m.subject));
    assert.equal((await reg('free-talk', 'cy@x.test')).status, 201, 'can register again');

    const paid = await b.post('/api/client/bookings/events', { retentionAgreed: true, title: 'Paid talk', slug: 'paid-talk', kind: 'paid', price: 10, currency: 'PHP', date: inDays(3), startMinute: 600, endMinute: 660, format: 'onsite', address: 'x', published: true });
    await b.multipart('post', `/api/client/bookings/events/${paid.body.id}/payment-channels`).field('type', 'bank').field('label', 'BDO').field('bankName', 'BDO').field('accountName', 'A').field('accountNumber', '1');
    assert.equal((await b.patch(`/api/client/bookings/events/${paid.body.id}`, { published: true })).status, 200);
    const code = await b.post(`/api/client/bookings/events/${paid.body.id}/tickets`, { name: 'Dee Paid', email: 'dee@x.test', phone: '+63 917 555 0100' });
    const claimed = await request(t.server).post('/api/public/bookings/smile-clinic/events/paid-talk/claim').set('Host', BOOKINGS).send({ code: code.body.code });
    const paidMail = await waitForMail((m) => [m.to].flat().includes('dee@x.test') && /registered/.test(m.subject));
    assert.ok(!/Cancel my registration/.test(paidMail.text), 'no cancel link for paid events');
    const no = await request(t.server).post('/api/public/bookings/smile-clinic/events/paid-talk/cancel').set('Host', BOOKINGS).send({ token: claimed.body.cancelToken });
    assert.equal(no.body.error, 'paid_event');
  });
});
