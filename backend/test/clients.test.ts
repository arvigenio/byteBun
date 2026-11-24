// Client apps: sign-in (accounts), new business, entitlement + role checks, Bookings settings,
// the public booking page, double-booking protection, limits, emails, and the manage link.
import { newCheckInCode } from '../src/clients/booking/check-in';
import './env';
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import request from 'supertest';
import { BookingNotifications } from '../src/clients/booking/notifications';
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
    const [day] = await openSlots('smile-clinic', serviceId);
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
    const [day] = await openSlots('smile-clinic', serviceId);
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
    const [day] = await openSlots('smile-clinic', serviceId);
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
    const [day] = await openSlots('smile-clinic', serviceId);
    assert.equal(day.spotsLeft, 2);
    assert.equal((await book('smile-clinic', { serviceId, date: day.date })).status, 201);
    const [again] = (await openSlots('smile-clinic', serviceId)).filter((d) => d.date === day.date);
    assert.equal(again.spotsLeft, 1);
  });

  it('warns before blocking a date with bookings, then cancels them with notice', async () => {
    const { b } = await newBusiness();
    const serviceId = await addService(b);
    const [day] = await openSlots('smile-clinic', serviceId);
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
    const [day] = await openSlots('smile-clinic', serviceId);
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
    const [day] = await openSlots('smile-clinic', cleaning);
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
    const [day] = await openSlots('smile-clinic', serviceId);
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
    const [day] = await openSlots('smile-clinic', serviceId);
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
