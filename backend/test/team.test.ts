// Team: custom roles (permissions checked by the API), event assignments (everyone except owners
// and admins sees only their events), and the team chat (rooms, access, attachments, unread
// counts, deleting, the offline email digest).
import './env';
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import sharp from 'sharp';
import request from 'supertest';
import { outbox } from '../src/auth/mailer';
import { addDays, todayIn } from '../src/clients/booking/time';
import { createClientsDb } from '../src/clients/clients-db';
import { syncEntitlements } from '../src/clients/entitlements';
import { ChatDigestJob } from '../src/clients/team/chat.service';
import { config } from '../src/config/config';
import { resetClients, resetState, startApp, type TestApp, waitForMail } from './helpers';

const ACCOUNTS = 'accounts.localhost:5173';
let t: TestApp;
const db = createClientsDb(config);

before(async () => {
  t = await startApp();
});
after(async () => {
  await db.$disconnect();
  await t?.close();
});
beforeEach(async () => {
  await resetState(t.prisma);
  await resetClients(db);
});

function client() {
  const agent = request.agent(t.server);
  const w = (r: request.Test) => r.set('Host', ACCOUNTS).set('Origin', `http://${ACCOUNTS}`);
  return {
    get: (url: string) => w(agent.get(url)),
    post: (url: string, body?: object) => w(agent.post(url)).send(body ?? {}),
    put: (url: string, body?: object) => w(agent.put(url)).send(body ?? {}),
    patch: (url: string, body?: object) => w(agent.patch(url)).send(body ?? {}),
    delete: (url: string) => w(agent.delete(url)),
    multipart: (method: 'post' | 'patch', url: string) => w(agent[method](url)),
  };
}
type Client = ReturnType<typeof client>;

async function signIn(email: string) {
  const b = client();
  await b.post('/api/accounts/auth/email-otp/send-verification-otp', { email, type: 'sign-in' });
  const mail = await waitForMail((m) => [m.to].flat().includes(email) && m.subject.startsWith('Your Byte Bun sign-in code') && !(m as { used?: boolean }).used);
  (mail as { used?: boolean }).used = true;
  assert.equal((await b.post('/api/accounts/auth/sign-in/email-otp', { email, otp: /(\d{6})$/.exec(mail.subject)![1] })).status, 200);
  return b;
}

async function newBusiness() {
  const b = await signIn('owner@clinic.test');
  const res = await b.post('/api/client/onboarding', { firstName: 'Olivia', businessName: 'Smile Clinic', slug: 'smile-clinic', timeZone: 'America/Toronto' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const orgId = res.body.organizationId as string;
  // Premium: room for a team.
  await db.subscription.update({ where: { organizationId: orgId }, data: { planCode: 'premium' } });
  await syncEntitlements(db, orgId);
  return { b, orgId };
}

/** Invites someone (optionally on a custom role); they accept and are signed in. */
async function join(owner: Client, email: string, role = 'staff', teamRoleId: number | null = null) {
  const inv = await owner.post('/api/client/team/invitations', { email, role, teamRoleId });
  assert.equal(inv.status, 201, JSON.stringify(inv.body));
  const invMail = await waitForMail((m) => [m.to].flat().includes(email) && /invite\//.test(m.text!));
  const p = await signIn(email);
  const accept = await p.post(`/api/client/invitations/${/invite\/([^\s)]+)/.exec(invMail.text!)![1]}/accept`);
  assert.equal(accept.status, 200, JSON.stringify(accept.body));
  return p;
}

const inDays = (n: number) => addDays(todayIn('America/Toronto'), n);
const newEvent = async (b: Client, slug: string, day = 7) => {
  const e = await b.post('/api/client/bookings/events', { retentionAgreed: true, title: `Event ${slug}`, slug, kind: 'free', date: inDays(day), startMinute: 600, endMinute: 660, format: 'onsite', address: '1 Main St', published: true });
  assert.equal(e.status, 201, JSON.stringify(e.body));
  return e.body as { id: number };
};

describe('custom roles', () => {
  it('owners and admins make roles; members get exactly those permissions; invitations carry the role', async () => {
    const { b } = await newBusiness();
    const catalog = await b.get('/api/client/team/roles');
    assert.equal(catalog.status, 200);
    assert.ok(catalog.body.catalog.some((g: { items: { key: string }[] }) => g.items.some((i) => i.key === 'events.payments')));

    const desk = await b.post('/api/client/team/roles', { name: 'Front desk', permissions: ['bookings.manage'] });
    assert.equal(desk.status, 201, JSON.stringify(desk.body));
    assert.deepEqual(desk.body.permissions, ['bookings.view', 'bookings.manage'], 'seeing bookings comes with managing them');
    assert.equal((await b.post('/api/client/team/roles', { name: 'Front desk', permissions: ['bookings.view'] })).body.error, 'name_taken');
    assert.equal((await b.post('/api/client/team/roles', { name: 'Boss', permissions: ['team.manage'] })).status, 400, 'team management stays with owners and admins');
    assert.equal((await b.post('/api/client/team/invitations', { email: 'x@clinic.test', role: 'admin', teamRoleId: desk.body.id })).body.error, 'validation_failed', 'custom roles are for staff');

    const sam = await join(b, 'sam@clinic.test', 'staff', desk.body.id);
    const me = (await sam.get('/api/client/me')).body.business;
    assert.deepEqual([me.role, me.roleName, me.permissions, me.allEvents], ['staff', 'Front desk', ['bookings.view', 'bookings.manage'], false]);
    assert.equal((await sam.get('/api/client/bookings/items')).status, 200);
    assert.equal((await sam.put('/api/client/bookings/settings', { phone: '555' })).status, 403);
    assert.equal((await sam.get('/api/client/bookings/events')).status, 403, 'no events on this role');
    assert.equal((await sam.get('/api/client/team')).status, 403, 'not even the team list');
    assert.equal((await sam.post('/api/client/team/roles', { name: 'Mine', permissions: ['bookings.view'] })).status, 403);

    const team = (await b.get('/api/client/team')).body;
    const row = team.members.find((m: { email: string }) => m.email === 'sam@clinic.test');
    assert.deepEqual([row.roleName, row.teamRoleId], ['Front desk', desk.body.id]);

    // Editing the role changes what they can do at once; it can't be deleted while used.
    await b.patch(`/api/client/team/roles/${desk.body.id}`, { permissions: ['bookings.view', 'events.view'] });
    assert.equal((await sam.get('/api/client/bookings/events')).status, 200);
    assert.equal((await b.delete(`/api/client/team/roles/${desk.body.id}`)).body.error, 'role_in_use');
    // Back to plain staff, then the role can go.
    assert.equal((await b.patch(`/api/client/team/members/${row.id}`, { role: 'staff', teamRoleId: null })).status, 200);
    assert.equal((await sam.get('/api/client/me')).body.business.roleName, 'Staff');
    assert.equal((await b.delete(`/api/client/team/roles/${desk.body.id}`)).status, 200);
  });
});

describe('event assignments', () => {
  it('everyone except owners and admins sees only the events they are assigned to', async () => {
    const { b } = await newBusiness();
    const crew = await b.post('/api/client/team/roles', { name: 'Event crew', permissions: ['events.attendees'] });
    const cara = await join(b, 'cara@clinic.test', 'staff', crew.body.id);
    const adam = await join(b, 'adam@clinic.test', 'admin');
    const caraId = (await cara.get('/api/client/me')).body.user.id;

    const one = await newEvent(b, 'talk-one', 7);
    const two = await newEvent(b, 'talk-two', 8);
    assert.deepEqual((await cara.get('/api/client/bookings/events')).body, [], 'nothing assigned yet');
    assert.equal((await cara.get(`/api/client/bookings/events/${one.id}`)).status, 404);
    assert.equal((await adam.get('/api/client/bookings/events')).body.length, 2, 'admins see every event');

    // Assign Cara to event one.
    const team = await b.get(`/api/client/bookings/events/${one.id}/team`);
    assert.equal(team.body.available.length, 1);
    assert.equal(team.body.everyEvent.length, 2, 'owner and admin');
    assert.equal((await b.post(`/api/client/bookings/events/${one.id}/team`, { userId: caraId })).status, 201);
    const mine = (await cara.get('/api/client/bookings/events')).body as { id: number }[];
    assert.deepEqual(mine.map((e) => e.id), [one.id]);
    assert.equal((await cara.get(`/api/client/bookings/events/${one.id}`)).status, 200);
    assert.equal((await cara.get(`/api/client/bookings/events/${two.id}`)).status, 404);
    // Her role: attendees yes, editing the event no.
    const reg = await cara.post(`/api/client/bookings/events/${one.id}/check-in`, { code: 'ABCD-EFGH' });
    assert.notEqual(reg.status, 403, 'checking people in is allowed (the code just doesn’t exist)');
    assert.equal((await cara.patch(`/api/client/bookings/events/${one.id}`, { title: 'Hacked' })).status, 403);
    assert.equal((await cara.post(`/api/client/bookings/events/${one.id}/team`, { userId: caraId })).status, 403, 'assigning needs Edit events');

    // Unassigned: gone again.
    assert.equal((await b.delete(`/api/client/bookings/events/${one.id}/team/${caraId}`)).status, 200);
    assert.equal((await cara.get(`/api/client/bookings/events/${one.id}`)).status, 404);

    // A custom role that can create events works on what it creates.
    const planner = await b.post('/api/client/team/roles', { name: 'Planner', permissions: ['events.manage'] });
    const pat = await join(b, 'pat@clinic.test', 'staff', planner.body.id);
    const own = await newEvent(pat, 'pats-talk', 9);
    assert.deepEqual(((await pat.get('/api/client/bookings/events')).body as { id: number }[]).map((e) => e.id), [own.id]);
  });
});

describe('team chat', () => {
  it('team room, event rooms by assignment, direct messages, attachments, unread, delete, offline digest', async () => {
    const { b } = await newBusiness();
    const sam = await join(b, 'sam@clinic.test');
    const ownerId = (await b.get('/api/client/me')).body.user.id;
    const samId = (await sam.get('/api/client/me')).body.user.id;
    const ev = await newEvent(b, 'chat-talk');

    // The whole team.
    const hi = await b.multipart('post', '/api/client/chat/rooms/team/messages').field('body', 'Morning team!');
    assert.equal(hi.status, 201, JSON.stringify(hi.body));
    let rooms = (await sam.get('/api/client/chat/rooms')).body;
    assert.equal(rooms.team.unread, 1);
    assert.equal(rooms.team.last.text, 'Morning team!');
    assert.equal(rooms.events.length, 0, 'Sam isn’t on the event');
    assert.equal((await sam.get('/api/client/chat/unread')).body.total, 1);
    const msgs = await sam.get('/api/client/chat/rooms/team/messages');
    assert.deepEqual(msgs.body.messages.map((m: { body: string; by: string }) => [m.body, m.by]), [['Morning team!', 'Olivia']]);
    await sam.post('/api/client/chat/rooms/team/read', { lastId: msgs.body.messages[0].id });
    assert.equal((await sam.get('/api/client/chat/unread')).body.total, 0);

    // The event's room: only its team (owners and admins always).
    assert.equal((await sam.get(`/api/client/chat/rooms/event-${ev.id}/messages`)).status, 404);
    await b.multipart('post', `/api/client/chat/rooms/event-${ev.id}/messages`).field('body', 'Setup at 9');
    await b.post(`/api/client/bookings/events/${ev.id}/team`, { userId: samId });
    rooms = (await sam.get('/api/client/chat/rooms')).body;
    assert.equal(rooms.events.length, 1);
    assert.equal(rooms.events[0].unread, 1);

    // Direct messages with an image; only the two of them.
    const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#a33' } }).png().toBuffer();
    const dm = await sam.multipart('post', `/api/client/chat/rooms/dm-${ownerId}/messages`).field('body', 'Here’s the receipt').attach('file', png, 'receipt.png');
    assert.equal(dm.status, 201, JSON.stringify(dm.body));
    assert.equal(dm.body.file.type, 'image/webp');
    const file = await b.get(dm.body.file.url);
    assert.equal(file.status, 200);
    assert.equal(file.headers['content-type'], 'image/webp');
    const stranger = await signIn('nobody@x.test');
    assert.equal((await stranger.get(dm.body.file.url)).status, 409, 'not in the business');
    assert.equal((await b.get('/api/client/chat/rooms')).body.people.find((p: { userId: string }) => p.userId === samId).unread, 1);
    assert.equal((await b.multipart('post', `/api/client/chat/rooms/dm-${ownerId}/messages`).field('body', 'me?')).status, 404, 'no chatting with yourself');

    // Only your own messages can be deleted.
    assert.equal((await b.delete(`/api/client/chat/rooms/dm-${samId}/messages/${dm.body.id}`)).status, 403);
    assert.equal((await sam.delete(`/api/client/chat/rooms/dm-${ownerId}/messages/${dm.body.id}`)).status, 200);
    const after = (await b.get(`/api/client/chat/rooms/dm-${samId}/messages`)).body.messages;
    assert.deepEqual([after[0].deleted, after[0].file], [true, null]);
    assert.equal((await b.get(dm.body.file.url)).status, 404);

    // Offline: unread messages older than 10 minutes are emailed once.
    await db.chatMessage.updateMany({ data: { createdAt: new Date(Date.now() - 15 * 60_000) } });
    outbox.length = 0;
    const job = t.app.get(ChatDigestJob);
    assert.equal(await job.run(), 1, 'only Sam has unread messages (the owner’s DM was deleted)');
    const digest = await waitForMail((m) => [m.to].flat().includes('sam@clinic.test') && m.subject.includes('unread'));
    assert.match(digest.subject, /1 unread message in Smile Clinic/);
    assert.match(digest.text!, /Setup at 9/);
    assert.equal(await job.run(), 0, 'not twice');
  });
});
