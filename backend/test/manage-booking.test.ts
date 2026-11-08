// The lead's private manage-booking link (booking/manage-link.ts) and its API
// (booking/manage-booking.controller.ts): view, reschedule, cancel, book again.
import './env';
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import request from 'supertest';
import { ARVI, JOSUE, mailsTo, resetState, startApp, type TestApp, waitForMail } from './helpers';

let t: TestApp;
before(async () => {
  t = await startApp();
});
after(async () => {
  await t?.close();
});
beforeEach(async () => {
  await resetState(t.prisma);
});

async function freeSlots(): Promise<string[]> {
  const res = await request(t.server).get('/api/booking/slots');
  assert.equal(res.status, 200);
  const taken = new Set<string>(res.body.taken);
  return (res.body.slots as string[]).filter((s) => !taken.has(s));
}

/** Books a call through the public form; returns the lead and the token from their email. */
async function bookLead(firstName = 'Maria', slot?: string) {
  const meetingAt = slot ?? (await freeSlots())[0];
  assert.ok(meetingAt, 'a free slot');
  const email = `${firstName.toLowerCase()}.${Date.now()}@example.com`;
  const res = await request(t.server).post('/api/leads').send({
    firstName,
    lastName: 'Santos',
    email,
    businessType: 'Dental clinic',
    goals: ['more-bookings'],
    meetingAt,
    timeZone: 'Asia/Manila',
    source: 'hero',
    fillMs: 20_000,
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const mail = await waitForMail((m) => [m.to].flat().includes(email) && /manage-booking#t=/.test(m.text ?? ''));
  const token = /manage-booking#t=([0-9]+\.[A-Za-z0-9_-]{43})/.exec(mail.text!)![1];
  return { id: res.body.id as number, email, slot: meetingAt, token };
}

const view = (token?: string) => {
  const r = request(t.server).get('/api/booking/manage');
  return token === undefined ? r : r.set('X-Booking-Token', token);
};
const reschedule = (token: string, body: object) => request(t.server).post('/api/booking/manage/reschedule').set('X-Booking-Token', token).send(body);
const cancel = (token: string) => request(t.server).post('/api/booking/manage/cancel').set('X-Booking-Token', token).send({});

describe('manage-booking link', () => {
  it('shows the call to the holder of the link, and nothing to anyone else', async () => {
    const { token, slot } = await bookLead();

    const ok = await view(token);
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.firstName, 'Maria');
    assert.equal(new Date(ok.body.booking.startsAt).toISOString(), slot);
    assert.equal(ok.body.booking.timeZone, 'Asia/Manila');
    assert.equal(ok.body.canChange, true);
    assert.ok(Array.isArray(ok.body.slots) && ok.body.slots.length > 0);
    assert.equal(ok.headers['cache-control'], 'no-store');
    assert.match(ok.headers['x-robots-tag'], /noindex/);
    assert.equal(ok.body.email, undefined, 'no contact details are exposed');

    const [id, sig] = token.split('.');
    const flipped = sig.slice(0, -1) + (sig.endsWith('A') ? 'B' : 'A');
    for (const bad of [undefined, '', 'nonsense', `${id}.${flipped}`, `${Number(id) + 1}.${sig}`]) {
      const res = await view(bad);
      assert.equal(res.status, 404, `token ${bad}`);
      assert.equal(res.body.error, 'invalid_link');
    }
    assert.equal((await reschedule(`${id}.${flipped}`, { meetingAt: (await freeSlots())[0] })).status, 404);
    assert.equal((await cancel(`${id}.${flipped}`)).status, 404);
  });

  it('a new nonce revokes earlier links', async () => {
    const { id, token } = await bookLead();
    await t.prisma.lead.update({ where: { id }, data: { manageNonce: 'f'.repeat(32) } });
    const res = await view(token);
    assert.equal(res.status, 404);
    assert.equal(res.body.error, 'invalid_link');
  });

  it('reschedule: moves the call, frees the old slot, emails the lead and both admins', async () => {
    const { id, email, slot, token } = await bookLead();
    const before = await t.prisma.booking.findUniqueOrThrow({ where: { leadId: id } });
    const next = (await freeSlots())[2];
    const sent = mailsTo(email).length;

    const res = await reschedule(token, { meetingAt: next, timeZone: 'America/New_York' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(new Date(res.body.booking.startsAt).toISOString(), next);
    assert.equal(res.body.booking.timeZone, 'America/New_York');

    const after = await t.prisma.booking.findUniqueOrThrow({ where: { leadId: id } });
    assert.equal(after.sequence, before.sequence + 1, 'calendar apps update the event');
    assert.equal(after.reminderSentAt, null);
    const free = await freeSlots();
    assert.ok(free.includes(slot), 'the old time is open again');
    assert.ok(!free.includes(next), 'the new time is taken');

    await waitForMail((m) => [m.to].flat().includes(email) && mailsTo(email).length > sent);
    await waitForMail((m) => [m.to].flat().includes(JOSUE) && m.subject.startsWith('Maria Santos moved their call to '));
    await waitForMail((m) => [m.to].flat().includes(ARVI) && m.subject.startsWith('Maria Santos moved their call to '));
  });

  it('reschedule: a taken time is 409 on the field, and a time outside the hours is 400', async () => {
    const other = await bookLead('Ana');
    const { token } = await bookLead('Maria');

    const taken = await reschedule(token, { meetingAt: other.slot });
    assert.equal(taken.status, 409, JSON.stringify(taken.body));
    assert.equal(taken.body.error, 'slot_taken');
    assert.ok(taken.body.fields.meetingAt);

    const odd = new Date(new Date((await freeSlots())[0]).getTime() + 7 * 60_000).toISOString();
    const outside = await reschedule(token, { meetingAt: odd });
    assert.equal(outside.status, 400, JSON.stringify(outside.body));
    assert.ok(outside.body.fields.meetingAt);

    assert.equal((await reschedule(token, {})).status, 400, 'a time is required');
    assert.equal((await reschedule(token, { meetingAt: (await freeSlots())[0], timeZone: 'Not/AZone' })).status, 400);
  });

  it('cancel: frees the slot, keeps the lead; the same link can book again', async () => {
    const { id, slot, token } = await bookLead();

    const res = await cancel(token);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(await t.prisma.booking.count({ where: { leadId: id } }), 0);
    assert.equal(await t.prisma.lead.count({ where: { id } }), 1, 'the lead stays');
    assert.ok((await freeSlots()).includes(slot));

    const v = await view(token);
    assert.equal(v.status, 200, 'the link still works after cancelling');
    assert.equal(v.body.booking, null);
    assert.equal(v.body.canChange, true);

    const again = await cancel(token);
    assert.equal(again.status, 404);
    assert.equal(again.body.error, 'no_booking');

    const rebook = await reschedule(token, { meetingAt: slot });
    assert.equal(rebook.status, 200, JSON.stringify(rebook.body));
    assert.equal(await t.prisma.booking.count({ where: { leadId: id } }), 1);
  });

  it('a call that already started can no longer be changed', async () => {
    const { id, token } = await bookLead();
    await t.prisma.booking.update({ where: { leadId: id }, data: { startsAt: new Date(Date.now() - 5 * 60_000) } });

    const v = await view(token);
    assert.equal(v.status, 200);
    assert.equal(v.body.canChange, false);

    const r = await reschedule(token, { meetingAt: (await freeSlots())[0] });
    assert.equal(r.status, 409);
    assert.equal(r.body.error, 'call_started');
    const c = await cancel(token);
    assert.equal(c.status, 409);
    assert.equal(c.body.error, 'call_started');
  });
});
