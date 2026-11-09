// A lead's whole journey as the team sees it: emails on sign-up, reminders, admin reschedule and
// cancel (emails to the lead and the OTHER admins), the memory cache, live admin updates
// (Socket.IO), and TESTING_EMAIL_ADDRESS.
import './env';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { after, before, beforeEach, describe, it } from 'node:test';
import { io, type Socket } from 'socket.io-client';
import request from 'supertest';
import { Mailer, outbox, redirectForTesting } from '../src/auth/mailer';
import { config } from '../src/config/config';
import { LeadEmailsService } from '../src/leads/lead-emails';
import { MemoryCache } from '../src/realtime/memory-cache';
import { ARVI, browser, enroll, JOSUE, mailsTo, ORIGIN, resetState, setCookies, settle, startApp, type TestApp, waitForMail } from './helpers';

let t: TestApp;
let port = 0;
before(async () => {
  t = await startApp();
  await new Promise<void>((r) => t.server.listen(0, '127.0.0.1', () => r()));
  port = (t.server.address() as AddressInfo).port;
});
after(async () => {
  await t?.close();
});
beforeEach(async () => {
  await resetState(t.prisma);
  t.app.get(MemoryCache).clear();
});

async function freeSlots(): Promise<string[]> {
  const res = await request(t.server).get('/api/booking/slots');
  const taken = new Set<string>(res.body.taken);
  return (res.body.slots as string[]).filter((s) => !taken.has(s));
}

async function bookLead(firstName = 'Maria') {
  const meetingAt = (await freeSlots())[0];
  const email = `${firstName.toLowerCase()}.${Date.now()}@example.com`;
  const res = await request(t.server).post('/api/leads').send({
    firstName,
    lastName: 'Santos',
    email,
    businessName: 'Santos Dental',
    businessType: 'Dental clinic',
    goals: ['more-bookings'],
    meetingAt,
    timeZone: 'America/New_York',
    source: 'hero',
    fillMs: 20_000,
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return { id: res.body.id as number, email, slot: meetingAt };
}

const isTo = (email: string) => (m: { to: string | string[] }) => [m.to].flat().includes(email);

describe('new lead', () => {
  it('the lead gets a designed confirmation with calendar buttons, an .ics and their manage link', async () => {
    const lead = await bookLead();
    const mail = await waitForMail((m) => isTo(lead.email)(m) && m.subject.startsWith('Maria, your free consultation is confirmed for '));
    assert.equal(mail.from, config.mail.leadsFrom);
    assert.match(mail.subject, /^Maria, your free consultation is confirmed for \w{3}, \w{3} \d{1,2} at \d{1,2}:\d{2} (AM|PM)$/);
    assert.deepEqual(mail.names, { [lead.email]: 'Maria Santos' }, 'addressed by name');
    const html = mail.html!;
    for (const needle of ['calendar.google.com/calendar/render', 'outlook.live.com/calendar', 'outlook.office.com/calendar', 'calendar.yahoo.com', '/manage-booking#t=', "You&#39;re booked, Maria!", '#FFA612']) {
      assert.ok(html.includes(needle), `html has ${needle}`);
    }
    assert.match(mail.text, /Google Calendar: https:\/\/calendar\.google\.com/);
    assert.match(mail.text, /America\/New_York/, 'times in their time zone');
    const ics = mail.attachments?.find((a) => a.filename === 'invite.ics');
    assert.ok(ics, 'has an .ics');
    assert.match(ics.content, /BEGIN:VEVENT[\s\S]*UID:booking-\d+@bytebuntech\.com[\s\S]*SEQUENCE:0[\s\S]*DTSTART:\d{8}T\d{6}Z/);
    const row = await t.prisma.booking.findFirstOrThrow({ where: { leadId: lead.id } });
    assert.ok(row.confirmationSentAt, 'marked as sent');
    assert.ok(row.reminderAt, 'reminder planned');
  });

  it('both admins get a new-lead email', async () => {
    const lead = await bookLead();
    const mail = await waitForMail((m) => m.subject.startsWith('New lead: Maria Santos from Santos Dental booked a call for '));
    assert.deepEqual([...(mail.to as string[])].sort(), [ARVI, JOSUE]);
    assert.equal(mail.from, config.mail.from);
    assert.ok(mail.text.includes(lead.email));
    assert.match(mail.text, /Call: .*\d{4} at/);
    assert.doesNotMatch(mail.html!, /href=/, 'admin emails have no links');
  });
});

describe('reminders', () => {
  it('a due reminder is sent once, with the manage link', async () => {
    const lead = await bookLead();
    await settle();
    const emails = t.app.get(LeadEmailsService);
    assert.equal(await emails.runDueReminders(), 0, 'not due yet');
    await t.prisma.booking.updateMany({ where: { leadId: lead.id }, data: { reminderAt: new Date(Date.now() - 1000) } });
    assert.equal(await emails.runDueReminders(), 1);
    assert.equal(await emails.runDueReminders(), 0, 'never twice');
    const mail = mailsTo(lead.email).find((m) => /^Reminder for Maria: your free consultation is (today|tomorrow|on \w{3}, \w{3} \d{1,2}) at \d{1,2}:\d{2} (AM|PM)$/.test(m.subject));
    assert.ok(mail);
    assert.ok(mail.html!.includes('/manage-booking#t='));
  });
});

describe('admin reschedule and cancel', () => {
  it('reschedule: lead and the OTHER admin are emailed (with the note); not the admin who did it', async () => {
    const lead = await bookLead();
    const b = browser(t.server);
    await enroll(b, JOSUE);
    await settle();
    outbox.length = 0;
    const booking = await t.prisma.booking.findFirstOrThrow({ where: { leadId: lead.id } });
    const target = (await freeSlots()).find((s) => s !== lead.slot)!;

    const res = await b.post(`/api/admin/bookings/${booking.id}/reschedule`, { startsAt: target, note: 'Our team lead is joining, so we needed a later slot.' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(new Date(res.body.booking.startsAt).toISOString(), target);
    const after = await t.prisma.booking.findUniqueOrThrow({ where: { id: booking.id } });
    assert.equal(after.sequence, 1, 'calendar apps update the same event');
    assert.equal(after.reminderSentAt, null);

    const toLead = await waitForMail((m) => isTo(lead.email)(m) && m.subject.startsWith("Maria, we've moved your call to "));
    assert.ok(toLead.html!.includes('We had to move your call'));
    assert.ok(toLead.html!.includes('A note from our team'));
    assert.ok(toLead.html!.includes('Our team lead is joining'));
    assert.match(toLead.attachments![0].content, /SEQUENCE:1/);
    const toAdmins = await waitForMail((m) => m.subject.startsWith("Josue Mapagdalita moved Maria Santos's call to "));
    assert.deepEqual(toAdmins.to, [ARVI], 'only the other admin');
    assert.match(toAdmins.subject, /at \d{1,2}:\d{2} (AM|PM) \(PH time\)$/);
    assert.match(toAdmins.text, /Changed by: Josue Mapagdalita \(admin site\)/);

    // Validation and races.
    assert.equal((await b.post(`/api/admin/bookings/${booking.id}/reschedule`, {})).status, 400);
    assert.equal((await b.post(`/api/admin/bookings/${booking.id}/reschedule`, { startsAt: '2020-01-01T00:00:00Z' })).status, 400);
    assert.equal((await b.post('/api/admin/bookings/99999/reschedule', { startsAt: target })).status, 404);
  });

  it('cancel: frees the slot, keeps the lead, emails the lead and the other admin', async () => {
    const lead = await bookLead();
    const b = browser(t.server);
    await enroll(b, ARVI);
    await settle();
    outbox.length = 0;
    const booking = await t.prisma.booking.findFirstOrThrow({ where: { leadId: lead.id } });
    const res = await b.post(`/api/admin/bookings/${booking.id}/cancel`, { note: 'Sorry, we are closed for a holiday that day.' });
    assert.equal(res.status, 200);
    assert.equal(await t.prisma.booking.count(), 0);
    assert.equal(await t.prisma.lead.count(), 1);
    assert.ok(!(await request(t.server).get('/api/booking/slots')).body.taken.includes(lead.slot), 'slot open again (cache cleared)');

    const toLead = await waitForMail((m) => isTo(lead.email)(m) && /^Maria, we're sorry: we had to cancel your call on \w{3}, \w{3} \d{1,2}$/.test(m.subject));
    assert.ok(toLead.html!.includes('We had to cancel your call'));
    assert.ok(toLead.html!.includes('closed for a holiday'));
    assert.ok(toLead.html!.includes('/manage-booking#t='), 'link to book a new time');
    assert.match(toLead.attachments![0].content, /METHOD:CANCEL[\s\S]*STATUS:CANCELLED/);
    const toAdmins = await waitForMail((m) => m.subject.startsWith("Arvi Genio cancelled Maria Santos's call on "));
    assert.deepEqual(toAdmins.to, [JOSUE]);
    assert.equal((await b.post(`/api/admin/bookings/${booking.id}/cancel`, {})).status, 404, 'already cancelled');
  });

  it('a signed-out request cannot reschedule or cancel', async () => {
    const lead = await bookLead();
    const booking = await t.prisma.booking.findFirstOrThrow({ where: { leadId: lead.id } });
    assert.equal((await request(t.server).post(`/api/admin/bookings/${booking.id}/cancel`).send({})).status, 401);
    assert.equal((await request(t.server).post(`/api/admin/bookings/${booking.id}/reschedule`).send({ startsAt: lead.slot })).status, 401);
    assert.equal(await t.prisma.booking.count(), 1);
  });
});

describe('memory cache', () => {
  it('serves repeat reads from memory and drops them on every change', async () => {
    await bookLead('Ana');
    const b = browser(t.server);
    await enroll(b, JOSUE);
    const cache = t.app.get(MemoryCache);
    cache.clear();
    const before = { ...cache.stats };
    const first = await b.get('/api/admin/leads');
    const second = await b.get('/api/admin/leads');
    assert.deepEqual(second.body, first.body);
    assert.equal(cache.stats.misses - before.misses, 1);
    assert.equal(cache.stats.hits - before.hits, 1);

    // An edit clears it: the next read shows the change at once.
    const id = first.body.items[0].id;
    await b.patch(`/api/admin/leads/${id}`, { firstName: 'Anabel' });
    assert.equal((await b.get('/api/admin/leads')).body.items[0].firstName, 'Anabel');
    // So does a new lead from the public form.
    await bookLead('Bea');
    assert.equal((await b.get('/api/admin/leads')).body.total, 2);
  });
});

describe('live admin updates (Socket.IO)', () => {
  const connect = (cookie?: string) =>
    io(`http://127.0.0.1:${port}`, { path: '/api/realtime', transports: ['websocket'], extraHeaders: { origin: ORIGIN, ...(cookie && { cookie }) }, reconnection: false });
  const once = <T>(s: Socket, event: string, ms = 4000) =>
    new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no "${event}" within ${ms} ms`)), ms);
      s.once(event, (data: T) => {
        clearTimeout(timer);
        resolve(data);
      });
    });

  it('signed-in admins get lead and booking events; anyone else is disconnected', async () => {
    const b = browser(t.server);
    const { verify } = await enroll(b, JOSUE);
    const cookie = setCookies(verify)
      .map((c) => c.split(';')[0])
      .join('; ');

    const stranger = connect();
    await once(stranger, 'disconnect');
    stranger.close();

    const admin = connect(cookie);
    await once(admin, 'connect');
    await settle(200);
    const created = once<{ lead: { firstName: string } }>(admin, 'lead.created');
    const lead = await bookLead('Carla');
    assert.equal((await created).lead.firstName, 'Carla');

    const booking = await t.prisma.booking.findFirstOrThrow({ where: { leadId: lead.id } });
    const changed = once<{ kind: string; by: string; lead: { id: number } }>(admin, 'booking.changed');
    await b.post(`/api/admin/bookings/${booking.id}/cancel`, {});
    const ev = await changed;
    assert.equal(ev.kind, 'cancelled');
    assert.equal(ev.by, 'admin');
    assert.equal(ev.lead.id, lead.id);

    const updated = once<{ lead: { firstName: string } }>(admin, 'lead.updated');
    await b.patch(`/api/admin/leads/${lead.id}`, { firstName: 'Carlita' });
    assert.equal((await updated).lead.firstName, 'Carlita');
    admin.close();
  });
});

describe('wording', () => {
  it('no email ever says "test", and every lead/booking subject names the client', async () => {
    const lead = await bookLead();
    const b = browser(t.server);
    await enroll(b, JOSUE);
    const booking = await t.prisma.booking.findFirstOrThrow({ where: { leadId: lead.id } });
    const target = (await freeSlots()).find((x) => x !== lead.slot)!;
    await b.post(`/api/admin/bookings/${booking.id}/reschedule`, { startsAt: target, note: 'We needed a later slot.' });
    await b.post(`/api/admin/bookings/${booking.id}/cancel`, {});
    await settle(800);
    assert.ok(outbox.length >= 8, `${outbox.length} emails`);
    for (const m of outbox) {
      for (const part of [m.subject, m.text, m.html ?? '']) assert.doesNotMatch(part, /\btest/i, `"test" in: ${m.subject}`);
    }
    const about = outbox.filter((x) => !x.subject.startsWith('[Byte Bun Security]') && !x.subject.startsWith('Your Byte Bun Admin sign-in code'));
    assert.ok(about.length >= 5);
    for (const m of about) assert.match(m.subject, /Maria/, `names the client: ${m.subject}`);
  });
});

describe('TESTING_EMAIL_ADDRESS', () => {
  it('sends every email to the test inbox and says who it was for', async () => {
    const redirected = redirectForTesting(
      { to: ['maria@example.com', JOSUE], names: { 'maria@example.com': 'Maria Santos' }, subject: 'Maria, your free consultation is confirmed', text: 'Body', html: '<html><body style="x">Hi</body></html>' },
      'inbox@bytebuntech.com',
    );
    assert.equal(redirected.to, 'inbox@bytebuntech.com');
    assert.equal(redirected.subject, 'Maria, your free consultation is confirmed', 'subject unchanged');
    assert.match(redirected.text, /^Intended for: Maria Santos <maria@example\.com>, Josue Mapagdalita <josue\.mapagdalita@bytebuntech\.com>/);
    assert.match(redirected.html!, /<body style="x"><div[^>]*>Intended for: Maria Santos &lt;maria@example\.com&gt;/);

    outbox.length = 0;
    const mailer = new Mailer({ ...config, mail: { ...config.mail, testingAddress: 'inbox@bytebuntech.com' } });
    await mailer.send({ to: 'lead@example.com', subject: 'Booked', text: 'x' });
    assert.equal(outbox[0].to, 'inbox@bytebuntech.com');
    assert.deepEqual(outbox[0].originalTo, ['lead@example.com']);
    assert.equal(redirectForTesting({ to: 'x@example.com', subject: 's', text: 't' }, '').to, 'x@example.com', 'off when empty');
  });
});
