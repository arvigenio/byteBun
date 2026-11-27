// Affiliates: Byte Bun's program (admin adds, proposal email, sign-up, promo code on a self-serve
// plan payment, verification, commissions, payouts, ranking), paid events' affiliates (up to 5,
// added by the business, verified spots, payouts) and the affiliate portal (email code sign-in,
// earnings, events, pending bookings).
import './env';
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import sharp from 'sharp';
import request from 'supertest';
import { outbox } from '../src/auth/mailer';
import { addDays, todayIn } from '../src/clients/booking/time';
import { createClientsDb } from '../src/clients/clients-db';
import { config } from '../src/config/config';
import { browser, enroll, JOSUE, resetClients, resetState, startApp, type TestApp, waitForMail } from './helpers';

const ACCOUNTS = 'accounts.localhost:5173';
const BOOKINGS = 'bookings.localhost:5173';
const AFFILIATES = 'affiliates.localhost:5173';
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

function agentFor(host: string) {
  const agent = request.agent(t.server);
  const w = (r: request.Test) => r.set('Host', host).set('Origin', `http://${host}`);
  return {
    get: (url: string) => w(agent.get(url)),
    post: (url: string, body?: object) => w(agent.post(url)).send(body ?? {}),
    patch: (url: string, body?: object) => w(agent.patch(url)).send(body ?? {}),
    delete: (url: string) => w(agent.delete(url)),
    multipart: (method: 'post' | 'patch', url: string) => w(agent[method](url)),
  };
}
type Agent = ReturnType<typeof agentFor>;

async function newBusiness(email = 'owner@clinic.test', slug = 'smile-clinic') {
  const b = agentFor(ACCOUNTS);
  await b.post('/api/accounts/auth/email-otp/send-verification-otp', { email, type: 'sign-in' });
  const mail = await waitForMail((m) => [m.to].flat().includes(email) && m.subject.startsWith('Your Byte Bun sign-in code'));
  assert.equal((await b.post('/api/accounts/auth/sign-in/email-otp', { email, otp: /(\d{6})$/.exec(mail.subject)![1] })).status, 200);
  const res = await b.post('/api/client/onboarding', { firstName: 'Olivia', businessName: 'Smile Clinic', slug, timeZone: 'America/Toronto' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return { b, orgId: res.body.organizationId as string };
}

async function admin() {
  const a = browser(t.server);
  await enroll(a, JOSUE);
  return a;
}

const mailsTo = (email: string) => outbox.filter((m) => [m.to].flat().includes(email));
const linkToken = (html: string) => decodeURIComponent(/\/join#t=([^"&<\s]+)/.exec(html)![1]);
const png = () => sharp({ create: { width: 120, height: 120, channels: 3, background: '#345' } }).png().toBuffer();

/** Accepts a proposal on the portal (first time: payout details), signed in afterwards. */
async function accept(email: string, subject: RegExp, payout = true) {
  const mail = await waitForMail((m) => [m.to].flat().includes(email) && subject.test(m.subject));
  const token = linkToken(mail.html!);
  const p = agentFor(AFFILIATES);
  const offer = await p.get(`/api/affiliate/invite?t=${encodeURIComponent(token)}`);
  assert.equal(offer.status, 200, JSON.stringify(offer.body));
  const joined = await p.post('/api/affiliate/join', {
    token,
    firstName: offer.body.firstName,
    lastName: offer.body.lastName,
    phone: '+63 917 000 0000',
    ...(payout ? { payoutMethod: 'ewallet', payoutProvider: 'GCash', payoutAccountName: 'Maria Santos', payoutAccountNumber: '09170000000' } : {}),
  });
  assert.equal(joined.status, 200, JSON.stringify(joined.body));
  return { p, offer: offer.body, joined: joined.body, token };
}

describe('Byte Bun affiliates and plan payments', () => {
  it('invite -> sign up -> promo code on a plan payment -> verified -> earned -> paid; ranking', async () => {
    const a = await admin();
    const add = await a.post('/api/admin/affiliates', { firstName: 'Maria', lastName: 'Santos', email: 'Maria@Aff.test', phone: '+63 917 111 2222', discountPercent: 10, commissionPercent: 20 });
    assert.equal(add.status, 201, JSON.stringify(add.body));
    assert.equal(add.body.status, 'invited');
    assert.match(add.body.promoCode, /^MARIA[A-Z2-9]{4}$/);
    assert.equal((await a.post('/api/admin/affiliates', { firstName: 'M', lastName: 'S', email: 'maria@aff.test', phone: '+63 917 111 2222', discountPercent: 1, commissionPercent: 1 })).body.error, 'email_taken');
    const second = await a.post('/api/admin/affiliates', { firstName: 'Ben', lastName: 'Cruz', email: 'ben@aff.test', phone: '+63 917 333 4444', discountPercent: 5, commissionPercent: 10, promoCode: 'ben-5' });
    assert.equal(second.body.promoCode, 'BEN5');

    // The proposal (with the terms) and the unique link; a code before sign-up doesn't work.
    const proposal = await waitForMail((m) => [m.to].flat().includes('maria@aff.test') && m.subject.includes('affiliate proposal'));
    assert.match(proposal.text!, /10% off/);
    assert.match(proposal.text!, /20% of/);
    const { b, orgId } = await newBusiness();
    const quote = (code: string) => b.post('/api/client/billing/promo', { planCode: 'bookings', cycle: 'yearly', promoCode: code });
    assert.equal((await quote(add.body.promoCode)).body.error, 'invalid_promo', 'not active before signing up');

    const bad = agentFor(AFFILIATES);
    assert.equal((await bad.get('/api/affiliate/invite?t=p1.wrongwrongwrongwrongwrong')).status, 404);
    const { p, joined } = await accept('maria@aff.test', /affiliate proposal/);
    assert.equal(joined.promoCode, add.body.promoCode);
    const welcome = await waitForMail((m) => [m.to].flat().includes('maria@aff.test') && m.subject.startsWith('Welcome to the Byte Bun affiliate program'));
    assert.ok(welcome.text!.includes(add.body.promoCode), 'the welcome has the promo code');
    assert.equal((await a.get(`/api/admin/affiliates/${add.body.id}`)).body.status, 'active');

    // The Plan page: self-serve plans, channels, a quote with the code.
    const ch = await request(t.server).post('/api/admin/plan-payment-channels').set('Origin', config.auth.url).set('Cookie', '');
    assert.equal(ch.status, 401, 'admins only');
    const chan = await a.agent.post('/api/admin/plan-payment-channels').set('Origin', config.auth.url).field('type', 'bank').field('label', 'BDO').field('bankName', 'BDO').field('accountName', 'Byte Bun Tech').field('accountNumber', '0012');
    assert.equal(chan.status, 201, JSON.stringify(chan.body));
    const checkout = await b.get('/api/client/billing/checkout');
    assert.deepEqual(checkout.body.plans.map((x: { code: string }) => x.code), ['bookings'], 'only Bookings Pro is bought online');
    assert.equal(checkout.body.channels.length, 1);
    const q = await quote(add.body.promoCode.toLowerCase());
    assert.deepEqual([q.body.listCents, q.body.discountCents, q.body.amountCents], [10000, 1000, 9000]);
    assert.equal((await b.post('/api/client/billing/promo', { planCode: 'premium', cycle: 'monthly', promoCode: add.body.promoCode })).body.error, 'validation_failed', 'premium: consultation');

    // Pay with the code: review, admins emailed, a pending commission.
    const pay = await b.multipart('post', '/api/client/billing/payments').field('planCode', 'bookings').field('cycle', 'yearly').field('promoCode', add.body.promoCode).field('reference', 'TX-1').attach('file', await png(), 'proof.png');
    assert.equal(pay.status, 201, JSON.stringify(pay.body));
    assert.deepEqual([pay.body.status, pay.body.amountCents], ['review', 9000]);
    assert.equal((await b.multipart('post', '/api/client/billing/payments').field('planCode', 'bookings').field('cycle', 'monthly').attach('file', await png(), 'p.png')).body.error, 'payment_pending');
    await waitForMail((m) => m.subject.startsWith('Plan payment to verify: Smile Clinic'));
    await waitForMail((m) => [m.to].flat().includes('owner@clinic.test') && m.subject.startsWith('Payment received'));
    const list = await a.get('/api/admin/plan-payments');
    assert.equal(list.body.length, 1);
    assert.deepEqual([list.body[0].commission.amountCents, list.body[0].commission.status, list.body[0].affiliate.name], [1800, 'pending', 'Maria Santos']);
    const proof = await a.get(`/api/admin/plan-payments/${pay.body.id}/proof`);
    assert.equal(proof.headers['content-type'], 'image/webp');

    // The portal: the pending booking shows before verification.
    let me = await p.get('/api/affiliate/me');
    assert.equal(me.status, 200, JSON.stringify(me.body));
    assert.equal(me.body.pending.length, 1);
    assert.equal(me.body.plan.pendingReferrals, 1);

    // Approve: the plan changes, the commission is earned, the affiliate is emailed.
    const ok = await a.post(`/api/admin/plan-payments/${pay.body.id}/approve`, { note: 'Thanks!' });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal((await db.subscription.findUniqueOrThrow({ where: { organizationId: orgId } })).planCode, 'bookings');
    assert.equal((await a.post(`/api/admin/plan-payments/${pay.body.id}/approve`, {})).body.error, 'not_pending');
    await waitForMail((m) => [m.to].flat().includes('maria@aff.test') && m.subject === 'You earned a $18 commission');
    await waitForMail((m) => [m.to].flat().includes('owner@clinic.test') && m.subject.startsWith('Payment verified'));
    me = await p.get('/api/affiliate/me');
    assert.deepEqual([me.body.plan.referrals, me.body.pending.length, me.body.earnings[0].balance], [1, 0, '$18']);

    // Ranking: Maria (1 verified) before Ben (0).
    const ranked = await a.get('/api/admin/affiliates');
    assert.deepEqual(ranked.body.map((r: { firstName: string; rank: number }) => [r.rank, r.firstName]), [[1, 'Maria'], [2, 'Ben']]);
    assert.equal(ranked.body[0].totals.earnedCents, 1800);

    // Paid out.
    const paid = await a.post(`/api/admin/affiliates/${add.body.id}/payout`, { reference: 'GC-99' });
    assert.equal(paid.status, 200, JSON.stringify(paid.body));
    assert.deepEqual([paid.body.totals.earnedCents, paid.body.totals.paidCents], [0, 1800]);
    await waitForMail((m) => [m.to].flat().includes('maria@aff.test') && m.subject === 'Commission paid: $18');
    assert.equal((await a.post(`/api/admin/affiliates/${add.body.id}/payout`, {})).body.error, 'nothing_due');
    assert.equal((await a.delete(`/api/admin/affiliates/${add.body.id}`)).body.error, 'has_commissions');

    // Disabled: the code stops working.
    await a.patch(`/api/admin/affiliates/${add.body.id}`, { status: 'disabled' });
    assert.equal((await quote(add.body.promoCode)).body.error, 'invalid_promo');
  });

  it('rejecting a payment voids the commission; the business can cancel its own', async () => {
    const a = await admin();
    const add = await a.post('/api/admin/affiliates', { firstName: 'Ana', lastName: 'Reyes', email: 'ana@aff.test', phone: '+63 917 111 2222', discountPercent: 0, commissionPercent: 50 });
    await accept('ana@aff.test', /affiliate proposal/);
    const { b, orgId } = await newBusiness();
    const first = await b.multipart('post', '/api/client/billing/payments').field('planCode', 'bookings').field('cycle', 'monthly').field('promoCode', add.body.promoCode).attach('file', await png(), 'p.png');
    assert.equal(first.status, 201, JSON.stringify(first.body));
    const rej = await a.post(`/api/admin/plan-payments/${first.body.id}/reject`, { reason: 'Amount not received' });
    assert.equal(rej.status, 200, JSON.stringify(rej.body));
    await waitForMail((m) => [m.to].flat().includes('owner@clinic.test') && m.subject.startsWith('Payment not verified'));
    assert.equal((await db.subscription.findUniqueOrThrow({ where: { organizationId: orgId } })).planCode, 'free');
    assert.equal((await db.affiliateCommission.findFirstOrThrow()).status, 'void');

    const again = await b.multipart('post', '/api/client/billing/payments').field('planCode', 'bookings').field('cycle', 'monthly').attach('file', await png(), 'p.png');
    assert.equal(again.status, 201);
    assert.equal((await b.post(`/api/client/billing/payments/${again.body.id}/cancel`)).status, 200);
    assert.equal((await b.get('/api/client/billing/checkout')).body.open, null);
  });
});

describe('Event affiliates and the affiliate portal', () => {
  const inDays = (n: number) => addDays(todayIn('America/Toronto'), n);

  async function paidEvent(b: Agent, slug = 'masterclass', price = 1000, title = 'Masterclass') {
    const ev = await b.post('/api/client/bookings/events', { retentionAgreed: true, title, slug, kind: 'paid', price, currency: 'PHP', date: inDays(7), startMinute: 600, endMinute: 660, format: 'onsite', address: '1 Main St' });
    assert.equal(ev.status, 201, JSON.stringify(ev.body));
    await b.multipart('post', `/api/client/bookings/events/${ev.body.id}/payment-channels`).field('type', 'bank').field('label', 'BDO').field('bankName', 'BDO').field('accountName', 'Smile').field('accountNumber', '1');
    assert.equal((await b.patch(`/api/client/bookings/events/${ev.body.id}`, { published: true })).status, 200);
    return ev.body as { id: number; slug: string };
  }

  it('up to 5 per paid event; accepted -> code works; verified spots earn; payouts; portal lists events and pending bookings', async () => {
    const { b } = await newBusiness();
    const free = await b.post('/api/client/bookings/events', { retentionAgreed: true, title: 'Free talk', slug: 'free-talk', kind: 'free', date: inDays(9), startMinute: 600, endMinute: 660, format: 'onsite', address: 'x' });
    assert.equal((await b.post(`/api/client/bookings/events/${free.body.id}/affiliates`, { firstName: 'X', lastName: 'Y', email: 'x@y.test', phone: '+1 555 0100', discountPercent: 10, commissionPercent: 10 })).body.error, 'not_paid');

    const ev = await paidEvent(b);
    const base = `/api/client/bookings/events/${ev.id}/affiliates`;
    const add = (n: number, extra: object = {}) => b.post(base, { firstName: `Aff${n}`, lastName: 'Lee', email: `aff${n}@x.test`, phone: '+63 917 000 0000', discountPercent: 10, commissionPercent: 20, ...extra });
    const first = await add(1, { promoCode: 'LEE10' });
    assert.equal(first.status, 201, JSON.stringify(first.body));
    assert.equal(first.body.promoCode, 'LEE10');
    for (let i = 2; i <= 5; i++) assert.equal((await add(i)).status, 201);
    assert.equal((await add(6)).body.error, 'affiliate_limit', 'max 5');
    assert.equal((await add(1)).body.error, 'already_affiliate');
    // Hidden from the Promo codes tab.
    assert.equal((await b.get(`/api/client/bookings/events/${ev.id}/promo-codes`)).body.promoCodes.length, 0);

    const pub = `/api/public/bookings/smile-clinic/events/${ev.slug}`;
    const quote = () => request(t.server).get(`${pub}/promo?code=LEE10&quantity=2`).set('Host', BOOKINGS);
    assert.equal((await quote()).body.valid, false, 'off until accepted');
    const { p } = await accept('aff1@x.test', /affiliate proposal for Masterclass/);
    assert.equal((await quote()).body.total, 1800, '10% off 2 spots');

    // Registrations with the code: a 2-spot booking (verified) and a single (still in review).
    const reg = async (email: string, quantity: number) => {
      const r = await request(t.server).post(`${pub}/register-paid`).set('Host', BOOKINGS).field('firstName', 'Pat').field('lastName', 'Cruz').field('email', email).field('phone', '+63 917 555 0100').field('quantity', String(quantity)).field('promoCode', 'LEE10').attach('file', await png(), 'p.png');
      assert.equal(r.status, 201, JSON.stringify(r.body));
    };
    await reg('pat@x.test', 2);
    await reg('sam@x.test', 1);
    const tickets = (await b.get(`/api/client/bookings/events/${ev.id}`)).body.tickets as { id: number; email: string }[];
    const pat = tickets.find((x) => x.email === 'pat@x.test')!;
    assert.equal((await b.post(`/api/client/bookings/events/${ev.id}/tickets/${pat.id}/approve`)).status, 200);

    // Ranked: the affiliate with referrals first; 2 verified spots at 900 each, 20% = 360.
    const list = await b.get(base);
    assert.equal(list.body.affiliates[0].firstName, 'Aff1');
    assert.deepEqual([list.body.affiliates[0].rank, list.body.affiliates[0].stats.verifiedSpots, list.body.affiliates[0].stats.pendingSpots, list.body.affiliates[0].stats.earned], [1, 2, 1, 360]);

    // A payout: emailed, balance down.
    const paid = await b.post(`${base}/${first.body.id}/payouts`, { amount: 300, reference: 'GC-1' });
    assert.equal(paid.status, 201, JSON.stringify(paid.body));
    assert.equal(paid.body.labels.balance, '₱60');
    await waitForMail((m) => [m.to].flat().includes('aff1@x.test') && m.subject === 'Commission paid: ₱300');
    assert.equal((await b.delete(`${base}/${first.body.id}`)).body.error, 'code_used');
    assert.equal((await b.delete(`${base}/${(list.body.affiliates as { id: number; firstName: string }[]).find((x) => x.firstName === 'Aff5')!.id}`)).status, 200);

    // A second event from another business: the same person, one account.
    const other = await newBusiness('boss@studio.test', 'zen-studio');
    const ev2 = await paidEvent(other.b, 'yoga-day', 500, 'Yoga Day');
    assert.equal((await other.b.post(`/api/client/bookings/events/${ev2.id}/affiliates`, { firstName: 'Aff1', lastName: 'Lee', email: 'aff1@x.test', phone: '+63 917 000 0000', discountPercent: 5, commissionPercent: 10 })).status, 201);
    const mail2 = await waitForMail((m) => [m.to].flat().includes('aff1@x.test') && m.subject.endsWith('an affiliate proposal for Yoga Day'));
    const tok2 = linkToken(mail2.html!);
    assert.equal((await p.get(`/api/affiliate/invite?t=${encodeURIComponent(tok2)}`)).body.hasAccount, true, 'payout already on file');
    assert.equal((await p.post('/api/affiliate/join', { token: tok2, firstName: 'Aff1', lastName: 'Lee', phone: '+63 917 000 0000' })).status, 200);

    // The dashboard: both events, earnings, the pending booking (first name + initial only).
    const me = await p.get('/api/affiliate/me');
    assert.equal(me.status, 200, JSON.stringify(me.body));
    assert.equal(me.body.events.length, 2);
    const mc = me.body.events.find((e: { title: string }) => e.title === 'Masterclass');
    assert.deepEqual([mc.stats.verifiedSpots, mc.labels.earned, mc.labels.balance, mc.promoCode], [2, '₱360', '₱60', 'LEE10']);
    assert.equal(me.body.pending.length, 1);
    assert.equal(me.body.pending[0].who, 'Pat C.');
    assert.equal(me.body.earnings.find((x: { currency: string }) => x.currency === 'PHP').pending, '₱180');
  });

  it('portal sign-in: emailed code, wrong codes, only people who signed up; sign-out', async () => {
    const p = agentFor(AFFILIATES);
    assert.equal((await p.get('/api/affiliate/me')).status, 401);
    assert.equal((await p.post('/api/affiliate/auth/code', { email: 'nobody@x.test' })).status, 200, 'same answer for unknown emails');
    assert.equal(mailsTo('nobody@x.test').length, 0);

    const a = await admin();
    await a.post('/api/admin/affiliates', { firstName: 'Lia', lastName: 'Go', email: 'lia@aff.test', phone: '+63 917 111 2222', discountPercent: 10, commissionPercent: 10 });
    await p.post('/api/affiliate/auth/code', { email: 'lia@aff.test' });
    assert.equal(mailsTo('lia@aff.test').filter((m) => m.subject.includes('sign-in code')).length, 0, 'not before signing up');
    await accept('lia@aff.test', /affiliate proposal/);

    const q = agentFor(AFFILIATES);
    await q.post('/api/affiliate/auth/code', { email: 'LIA@aff.test' });
    const mail = await waitForMail((m) => [m.to].flat().includes('lia@aff.test') && m.subject.startsWith('Your Byte Bun affiliate sign-in code'));
    const code = /(\d{6})$/.exec(mail.subject)![1];
    const wrong = code === '000000' ? '111111' : '000000';
    assert.equal((await q.post('/api/affiliate/auth/verify', { email: 'lia@aff.test', code: wrong })).body.error, 'bad_code');
    const ok = await q.post('/api/affiliate/auth/verify', { email: 'lia@aff.test', code });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal((await q.post('/api/affiliate/auth/verify', { email: 'lia@aff.test', code })).body.error, 'code_expired', 'works once');
    const me = await q.get('/api/affiliate/me');
    assert.equal(me.body.firstName, 'Lia');
    assert.equal(me.body.plan.discountPercent, 10);
    assert.equal((await q.patch('/api/affiliate/me', { payoutProvider: 'Maya' })).body.payout.provider, 'Maya');
    await q.post('/api/affiliate/auth/sign-out');
    assert.equal((await q.get('/api/affiliate/me')).status, 401);
  });
});
