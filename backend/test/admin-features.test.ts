// The lead form and booking calendar still work, and the admin area works once signed in.
import './env';
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import request from 'supertest';
import { browser, emailStep, enroll, JOSUE, resetState, startApp, type TestApp, totp, waitForAlert, wrongTotp } from './helpers';

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

async function submitLead(server: any, overrides: Record<string, unknown> = {}) {
  const slots = await request(server).get('/api/booking/slots');
  assert.equal(slots.status, 200);
  const taken = new Set<string>(slots.body.taken);
  const slot = (slots.body.slots as string[]).find((s) => !taken.has(s));
  assert.ok(slot, 'a free slot');
  const res = await request(server)
    .post('/api/leads')
    .send({
      firstName: 'Maria',
      lastName: 'Santos',
      email: `maria.${Date.now()}@example.com`,
      phone: '+63 912 345 6789',
      businessName: 'Santos Dental',
      businessType: 'Dental clinic',
      goals: ['more-bookings', 'other'],
      goalsOther: 'Launch a second branch',
      features: ['online-booking'],
      message: '=HYPERLINK("evil") test',
      meetingAt: slot,
      timeZone: 'Asia/Manila',
      source: 'hero',
      fillMs: 20_000,
      ...overrides,
    });
  return { res, slot: slot! };
}

describe('public lead form and booking calendar (unchanged, no sign-in)', () => {
  it('a visitor can book a call, and the slot is then taken', async () => {
    const { res, slot } = await submitLead(t.server);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.ok, true);
    const slots = await request(t.server).get('/api/booking/slots');
    assert.ok(slots.body.taken.includes(slot));
  });
});

describe('admin area, signed in', () => {
  it('leads: list, search, detail, status change, CSV export', async () => {
    const { res } = await submitLead(t.server);
    const id = res.body.id as number;
    const b = browser(t.server);
    await enroll(b, JOSUE);

    const list = await b.get('/api/admin/leads');
    assert.equal(list.status, 200);
    assert.equal(list.body.total, 1);
    assert.equal(list.body.items[0].firstName, 'Maria');
    assert.deepEqual(list.body.items[0].goals, ['Get more appointments and bookings', 'Other: Launch a second branch']);
    assert.ok(list.body.items[0].booking.startsAt);

    assert.equal((await b.get('/api/admin/leads?q=santos')).body.total, 1);
    assert.equal((await b.get('/api/admin/leads?q=nomatch')).body.total, 0);
    assert.equal((await b.get('/api/admin/leads?status=won')).body.total, 0);

    const detail = await b.get(`/api/admin/leads/${id}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.body.businessName, 'Santos Dental');
    assert.equal((await b.get('/api/admin/leads/99999')).status, 404);

    const patched = await b.patch(`/api/admin/leads/${id}`, { status: 'contacted' });
    assert.equal(patched.status, 200);
    assert.equal(patched.body.status, 'contacted');
    assert.equal((await b.patch(`/api/admin/leads/${id}`, { status: 'bogus' })).status, 400);

    const csv = await b.get('/api/admin/leads/export.csv');
    assert.equal(csv.status, 200);
    assert.match(csv.headers['content-type'], /text\/csv/);
    assert.match(csv.headers['content-disposition'], /attachment; filename="bytebun-leads-/);
    assert.match(csv.text, /id,created_at,status,first_name/);
    assert.match(csv.text, /Maria,Santos/);
    assert.match(csv.text, /"'=HYPERLINK\(""evil""\) test"/, 'formula cells are neutralized');
  });

  it('bookings: upcoming list and cancel (frees the slot)', async () => {
    const { slot } = await submitLead(t.server);
    const b = browser(t.server);
    await enroll(b, JOSUE);
    const upcoming = await b.get('/api/admin/bookings?when=upcoming');
    assert.equal(upcoming.status, 200);
    assert.equal(upcoming.body.items.length, 1);
    assert.equal(upcoming.body.items[0].lead.firstName, 'Maria');
    assert.equal((await b.get('/api/admin/bookings?when=past')).body.items.length, 0);

    const del = await b.delete(`/api/admin/bookings/${upcoming.body.items[0].id}`);
    assert.equal(del.status, 200);
    const slots = await request(t.server).get('/api/booking/slots');
    assert.ok(!slots.body.taken.includes(slot));
    assert.equal(await t.prisma.lead.count(), 1, 'the lead stays');
  });

  it('security page: sessions, sign out others / this device, backup codes', async () => {
    const phone = browser(t.server);
    const { secret } = await enroll(phone, JOSUE);
    await t.prisma.$executeRawUnsafe('TRUNCATE auth_rate_limits, security_counters');
    const laptop = browser(t.server);
    // second device
    await emailStep(laptop, JOSUE);
    assert.equal((await laptop.post('/api/auth/two-factor/verify-totp', { code: totp(secret) })).status, 200);

    const overview = await laptop.get('/api/admin/security');
    assert.equal(overview.status, 200);
    assert.equal(overview.body.user.email, JOSUE);
    assert.equal(overview.body.sessions.length, 2);
    assert.equal(overview.body.sessions.filter((s: { current: boolean }) => s.current).length, 1);
    assert.equal(overview.body.backupCodesRemaining, 10);
    assert.ok(!JSON.stringify(overview.body).includes('token'), 'no session tokens exposed');

    // Regenerating backup codes needs a current authenticator code.
    const bad = await laptop.post('/api/admin/security/backup-codes', { code: wrongTotp(secret) });
    assert.equal(bad.status, 400);
    await waitForAlert('Wrong authenticator code');
    const regen = await laptop.post('/api/admin/security/backup-codes', { code: totp(secret) });
    assert.equal(regen.status, 200, JSON.stringify(regen.body));
    assert.equal(regen.body.backupCodes.length, 10);
    await waitForAlert('Backup codes regenerated');

    // Sign out all other devices: the phone is signed out, the laptop stays.
    const others = await laptop.post('/api/admin/security/sessions/revoke-others', {});
    assert.equal(others.status, 200);
    assert.equal(others.body.signedOut, 1);
    assert.equal((await phone.get('/api/admin/me')).status, 401);
    assert.equal((await laptop.get('/api/admin/me')).status, 200);

    // Sign out this device.
    const current = (await laptop.get('/api/admin/security')).body.sessions.find((s: { current: boolean }) => s.current);
    const self = await laptop.post(`/api/admin/security/sessions/${current.id}/revoke`, {});
    assert.equal(self.status, 200);
    assert.equal(self.body.signedOutCurrent, true);
    assert.equal((await laptop.get('/api/admin/me')).status, 401);
  });

  it('leads: edit details (partial updates, the public form rules, goals and type may be empty)', async () => {
    const { res } = await submitLead(t.server);
    const id = res.body.id as number;
    const b = browser(t.server);
    await enroll(b, JOSUE);

    const options = await b.get('/api/admin/leads/options');
    assert.equal(options.status, 200);
    assert.ok(options.body.goals.some((g: { key: string }) => g.key === 'more-bookings'));
    assert.ok(options.body.features.length > 0);
    assert.deepEqual(options.body.statuses, ['new', 'contacted', 'qualified', 'won', 'lost', 'spam']);

    const before = (await b.get(`/api/admin/leads/${id}`)).body;
    assert.deepEqual(before.goalKeys, ['more-bookings', 'other']);
    assert.equal(before.goalsOther, 'Launch a second branch');

    const edited = await b.patch(`/api/admin/leads/${id}`, {
      firstName: '  Maria Clara ',
      email: 'MARIA@Example.com',
      phone: '',
      businessName: 'Santos Dental Group',
      goals: ['reduce-no-shows'],
      goalsOther: 'ignored without the other goal',
      features: ['ai-chatbot', 'online-booking'],
      message: 'Called back, wants a quote.',
      status: 'qualified',
    });
    assert.equal(edited.status, 200, JSON.stringify(edited.body));
    assert.equal(edited.body.firstName, 'Maria Clara');
    assert.equal(edited.body.lastName, 'Santos', 'fields not sent are unchanged');
    assert.equal(edited.body.email, 'maria@example.com');
    assert.equal(edited.body.phone, null);
    assert.deepEqual(edited.body.goalKeys, ['reduce-no-shows']);
    assert.equal(edited.body.goalsOther, null, 'cleared when "other" is no longer a goal');
    assert.deepEqual(edited.body.featureKeys, ['ai-chatbot', 'online-booking']);
    assert.equal(edited.body.status, 'qualified');
    assert.ok(edited.body.booking, 'the booked call is untouched');

    // Validation, with per-field messages.
    const bad = await b.patch(`/api/admin/leads/${id}`, { email: 'not-an-email', firstName: '   ', phone: 'abc', businessType: 'x'.repeat(81) });
    assert.equal(bad.status, 400);
    assert.deepEqual(Object.keys(bad.body.fields).sort(), ['businessType', 'email', 'firstName', 'phone']);
    // Goals and the business type may be left empty (calls booked by an admin start without them).
    const emptied = await b.patch(`/api/admin/leads/${id}`, { goals: [], businessType: '' });
    assert.equal(emptied.status, 200, JSON.stringify(emptied.body));
    assert.deepEqual(emptied.body.goalKeys, []);
    assert.equal(emptied.body.businessType, '');
    const otherWithoutText = await b.patch(`/api/admin/leads/${id}`, { goals: ['other'] });
    assert.equal(otherWithoutText.status, 400);
    assert.ok(otherWithoutText.body.fields.goalsOther);
    const unknownGoal = await b.patch(`/api/admin/leads/${id}`, { goals: ['hack'] });
    assert.equal(unknownGoal.status, 400);
    // Unknown fields are ignored, never written.
    const sneaky = await b.patch(`/api/admin/leads/${id}`, { id: 999, createdAt: '2000-01-01', source: 'evil' });
    assert.equal(sneaky.status, 200);
    assert.equal(sneaky.body.id, id);
    assert.equal(sneaky.body.source, 'hero');
    assert.equal((await b.patch('/api/admin/leads/99999', { status: 'won' })).status, 404);
  });

  it('bookings: calendar range query', async () => {
    const { slot } = await submitLead(t.server);
    const b = browser(t.server);
    await enroll(b, JOSUE);
    const start = new Date(slot);
    const from = new Date(start.getTime() - 86_400_000).toISOString();
    const to = new Date(start.getTime() + 86_400_000).toISOString();
    const hit = await b.get(`/api/admin/bookings?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
    assert.equal(hit.status, 200);
    assert.equal(hit.body.items.length, 1);
    const later = new Date(start.getTime() + 2 * 86_400_000).toISOString();
    const miss = await b.get(`/api/admin/bookings?from=${encodeURIComponent(to)}&to=${encodeURIComponent(later)}`);
    assert.equal(miss.body.items.length, 0);
    const tooLong = await b.get(`/api/admin/bookings?from=2026-01-01T00:00:00Z&to=2026-06-01T00:00:00Z`);
    assert.equal(tooLong.status, 400);
    assert.equal((await b.get(`/api/admin/bookings?from=${encodeURIComponent(from)}`)).status, 400);
  });

  it('sign-out ends the session', async () => {
    const b = browser(t.server);
    await enroll(b, JOSUE);
    assert.equal((await b.get('/api/admin/me')).status, 200);
    assert.equal((await b.post('/api/auth/sign-out', {})).status, 200);
    assert.equal((await b.get('/api/admin/me')).status, 401);
    assert.equal(await t.prisma.session.count(), 0);
  });
});
