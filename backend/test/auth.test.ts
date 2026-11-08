import './env';
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import request from 'supertest';
import { outbox } from '../src/auth/mailer';
import {
  ARVI,
  alertMails,
  browser,
  clearRateLimits,
  codeMailsTo,
  emailStep,
  enroll,
  JOSUE,
  latestCode,
  LOGIN_PATH,
  requestCode,
  resetState,
  runScript,
  SENDER,
  setCookies,
  settle,
  startApp,
  type TestApp,
  totp,
  waitForAlert,
  waitForMail,
  wrongTotp,
} from './helpers';

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

const ADMIN_APIS = ['/api/admin/leads', '/api/admin/leads/1', '/api/admin/leads/export.csv', '/api/admin/bookings', '/api/admin/security', '/api/admin/me', '/api/admin/does-not-exist'];
const ADMIN_PAGES = ['/admin', '/admin/leads', '/admin/bookings', '/admin/security'];
// Better Auth endpoints that exist but must never be reachable from a browser.
const HIDDEN_AUTH_ENDPOINTS: [string, string, object?][] = [
  ['post', '/api/auth/sign-up/email', { email: 'x@example.com', password: 'Password123!', name: 'x' }],
  ['post', '/api/auth/sign-in/email', { email: JOSUE, password: 'whatever123' }],
  ['post', '/api/auth/request-password-reset', { email: JOSUE }],
  ['post', '/api/auth/email-otp/request-password-reset', { email: JOSUE }],
  ['post', '/api/auth/email-otp/check-verification-otp', { email: JOSUE, type: 'sign-in', otp: '123456' }],
  ['post', '/api/auth/change-password', { currentPassword: 'a', newPassword: 'b' }],
  ['post', '/api/auth/update-user', { name: 'hacked' }],
  ['get', '/api/auth/list-sessions'],
  ['post', '/api/auth/two-factor/get-totp-uri', {}],
  ['post', '/api/auth/two-factor/generate-backup-codes', {}],
  ['post', '/api/auth/two-factor/disable', {}],
  ['post', '/api/auth/two-factor/send-otp', {}],
  ['get', '/api/auth/admin/list-users'],
  ['post', '/api/auth/admin/set-role', { userId: 'x', role: 'admin' }],
  ['post', '/api/auth/admin/create-user', { email: 'evil@example.com', name: 'evil', password: 'Password123!' }],
  ['post', '/api/auth/admin/impersonate-user', { userId: 'x' }],
];

async function assertNoAdminAccess(b: ReturnType<typeof browser>, label: string) {
  for (const url of ADMIN_APIS) {
    const res = await b.get(url);
    assert.equal(res.status, 401, `${label}: GET ${url} should be 401, got ${res.status}`);
    assert.equal(res.body.error, 'unauthorized');
  }
  const patch = await b.patch('/api/admin/leads/1', { status: 'won' });
  assert.equal(patch.status, 401, `${label}: PATCH lead`);
  const del = await b.delete('/api/admin/bookings/1');
  assert.equal(del.status, 401, `${label}: DELETE booking`);
  for (const url of ADMIN_PAGES) {
    const res = await b.get(url);
    assert.equal(res.status, 404, `${label}: page ${url} should be 404`);
  }
  for (const [method, url, body] of HIDDEN_AUTH_ENDPOINTS) {
    const res = method === 'get' ? await b.get(url) : await b.post(url, body);
    assert.equal(res.status, 404, `${label}: ${method.toUpperCase()} ${url} should be 404, got ${res.status} ${JSON.stringify(res.body)}`);
  }
}

describe('hidden login page', () => {
  it('common login paths return a plain 404', async () => {
    for (const p of ['/login', '/signin', '/sign-in', '/admin/login', '/wp-login.php', '/login/', '/LOGIN', '/admin.html']) {
      const res = await request(t.server).get(p);
      assert.equal(res.status, 404, p);
      assert.equal(res.text, 'Not Found', p);
      assert.match(res.headers['content-type'], /text\/plain/, p);
    }
  });

  it('the secret path serves the admin app with noindex', async () => {
    const res = await request(t.server).get(LOGIN_PATH);
    assert.equal(res.status, 200);
    assert.match(res.text, /admin-app/);
    assert.equal(res.headers['x-robots-tag'], 'noindex, nofollow');
    assert.equal(res.headers['cache-control'], 'no-store');
  });

  it('the public site still works and never mentions the login path', async () => {
    for (const p of ['/', '/get-started', '/some-unknown-page']) {
      const res = await request(t.server).get(p);
      assert.equal(res.status, 200, p);
      assert.match(res.text, /public-site/);
      assert.doesNotMatch(res.text, new RegExp(LOGIN_PATH));
    }
  });

  it('signed out: admin pages are 404 (no redirect) and admin APIs are 401 JSON', async () => {
    const b = browser(t.server);
    await assertNoAdminAccess(b, 'signed out');
    const res = await b.get('/admin/leads');
    assert.equal(res.headers.location, undefined);
    assert.equal(res.text, 'Not Found');
  });
});

describe('email code step', () => {
  it('an unknown email gets the same answer, no email, and no account', async () => {
    const b = browser(t.server);
    const known = await requestCode(b, JOSUE);
    await clearRateLimits(t.prisma);
    const unknown = await requestCode(b, 'nobody@bytebuntech.com');
    assert.equal(unknown.status, known.status);
    assert.deepEqual(unknown.body, known.body);
    assert.deepEqual(unknown.body, { success: true });

    // Timing: both answer without waiting for any email to be sent.
    const time = async (email: string) => {
      await clearRateLimits(t.prisma);
      const s = performance.now();
      await requestCode(b, email);
      return performance.now() - s;
    };
    const samples = async (email: string) => {
      const xs = [await time(email), await time(email), await time(email)];
      return xs.sort((a, c) => a - c)[1];
    };
    const k = await samples(ARVI);
    const u = await samples('ghost@bytebuntech.com');
    assert.ok(Math.abs(k - u) < 150, `known ${k.toFixed(0)}ms vs unknown ${u.toFixed(0)}ms`);

    await settle();
    assert.equal(codeMailsTo('nobody@bytebuntech.com').length, 0);
    assert.equal(codeMailsTo('ghost@bytebuntech.com').length, 0);
    assert.ok(outbox.every((m) => !String(m.to).includes('nobody@') && !String(m.to).includes('ghost@')));

    // Even trying to sign in with a guessed code creates nothing.
    await clearRateLimits(t.prisma);
    const signInRes = await b.post('/api/auth/sign-in/email-otp', { email: 'nobody@bytebuntech.com', otp: '123456' });
    assert.notEqual(signInRes.status, 200);
    assert.equal(await t.prisma.user.count({ where: { email: { in: ['nobody@bytebuntech.com', 'ghost@bytebuntech.com'] } } }), 0);
    assert.equal(await t.prisma.user.count(), 2);
    await waitForAlert('Sign-in attempt with an email that is not an admin');
  });

  it('a known admin gets a code from admin@bytebuntech.com (designed HTML + plain text)', async () => {
    const b = browser(t.server);
    const res = await b
      .post('/api/auth/email-otp/send-verification-otp', { email: JOSUE, type: 'sign-in' })
      .set('User-Agent', 'Evil <script>alert(1)</script> "UA"');
    assert.equal(res.status, 200);
    await settle();
    const [mail] = codeMailsTo(JOSUE);
    assert.ok(mail, 'code email sent');
    assert.equal(mail.from, SENDER);
    assert.match(mail.subject, /^Your Byte Bun Admin sign-in code: \d{6}$/);
    const code = latestCode(JOSUE);
    assert.ok(mail.text.includes(`\n${code}\n`));
    assert.match(mail.text, /expires in 5 minutes/);
    assert.match(mail.text, /IP: /);
    assert.match(mail.text, /Location: /);
    assert.match(mail.text, /Requested: /);
    assert.match(mail.text, /they still can't get in without your authenticator, but tell the other admin/);
    assert.doesNotMatch(mail.text, /https?:\/\/|<img|<a /i, 'no links or images');

    // The designed version: same template as every email, brand colors, no images or links,
    // and values from the request are escaped.
    const html = mail.html!;
    assert.ok(html, 'has an HTML version');
    assert.ok(html.includes(`>${code}</td>`), 'code shown in the code panel');
    assert.ok(html.includes('#331165') && html.includes('#FFA612'), 'brand colors');
    assert.doesNotMatch(html, /<img|href=|src=|url\(/i, 'no images or links');
    assert.ok(!html.includes('<script>'), 'user agent is escaped');
    assert.ok(html.includes('Evil &lt;script&gt;alert(1)&lt;/script&gt; &quot;UA&quot;'));
    const alert = await waitForAlert('Sign-in code requested');
    assert.ok(alert.html?.includes('Security notice'), 'alerts use the same template');
  });

  it('a wrong code fails, and 3 wrong attempts invalidate the code', async () => {
    const b = browser(t.server);
    await requestCode(b, JOSUE);
    await settle();
    const code = latestCode(JOSUE);
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 3; i++) {
      const res = await b.post('/api/auth/sign-in/email-otp', { email: JOSUE, otp: wrong });
      assert.equal(res.status, 400, `wrong attempt ${i + 1}`);
    }
    const correctButLate = await b.post('/api/auth/sign-in/email-otp', { email: JOSUE, otp: code });
    assert.notEqual(correctButLate.status, 200, 'the code no longer works after 3 wrong tries');
    assert.match(JSON.stringify(correctButLate.body), /TOO_MANY_ATTEMPTS|INVALID_OTP|OTP_EXPIRED/);
    await waitForAlert('Wrong email sign-in code');
    await waitForAlert('Too many wrong email codes');
    assert.equal(await t.prisma.session.count(), 0);
  });
});

describe('the email code alone is not enough', () => {
  it('first sign-in: a setup-only session that can reach nothing', async () => {
    const b = browser(t.server);
    const res = await emailStep(b, JOSUE);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { next: 'setup' });
    assert.ok(!JSON.stringify(res.body).includes('token'));
    const session = await b.get('/api/auth/get-session');
    assert.equal(session.body.session.secondFactorVerified, false);
    await assertNoAdminAccess(b, 'setup-only session');
    await waitForAlert('Email code correct, waiting for the authenticator', (m) =>
      m.text.includes("This person has access to the inbox; if this wasn't you, secure your email now"),
    );
  });

  it('enrolled admin: no session at all until the authenticator code', async () => {
    const b = browser(t.server);
    const { secret } = await enroll(b, JOSUE);
    await b.post('/api/auth/sign-out', {});
    await clearRateLimits(t.prisma);

    const attacker = browser(t.server);
    const res = await emailStep(attacker, JOSUE);
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { next: 'authenticator' });
    const cookies = setCookies(res).join('\n');
    assert.match(cookies, /bb-admin\.two_factor=/);
    assert.doesNotMatch(cookies, /bb-admin\.session_token=[^;]/, 'no session cookie value');
    const session = await attacker.get('/api/auth/get-session');
    assert.equal(session.body, null);
    await assertNoAdminAccess(attacker, 'email code only (enrolled)');
    // Setting up a second authenticator with only the email code is refused.
    const enable = await attacker.post('/api/auth/two-factor/enable', {});
    assert.equal(enable.status, 403);
    // A fake session flag can't be sent in.
    const flag = await attacker.post('/api/auth/two-factor/verify-totp', { code: wrongTotp(secret), secondFactorVerified: true });
    assert.equal(flag.status, 401);
  });
});

describe('authenticator step', () => {
  it('first sign-in: QR setup -> backup codes -> access, and the session is replaced', async () => {
    const b = browser(t.server);
    const step1 = await emailStep(b, ARVI);
    assert.deepEqual(step1.body, { next: 'setup' });
    const setupSessionToken = (await t.prisma.session.findFirstOrThrow()).token;

    const enable = await b.post('/api/auth/two-factor/enable', {});
    assert.equal(enable.status, 200);
    assert.match(enable.body.totpURI, /^otpauth:\/\/totp\/Byte%20Bun%20Admin:arvi\.genio%40bytebuntech\.com\?secret=[A-Z2-7]+/);
    assert.equal(enable.body.backupCodes.length, 10);
    const secret = new URL(enable.body.totpURI).searchParams.get('secret')!;

    // Not usable yet.
    assert.equal((await b.get('/api/admin/leads')).status, 401);

    const bad = await b.post('/api/auth/two-factor/verify-totp', { code: wrongTotp(secret) });
    assert.equal(bad.status, 401);
    const good = await b.post('/api/auth/two-factor/verify-totp', { code: totp(secret) });
    assert.equal(good.status, 200);
    assert.deepEqual(good.body, { ok: true, signedIn: true });

    const me = await b.get('/api/admin/me');
    assert.equal(me.status, 200);
    assert.equal(me.body.user.email, ARVI);
    assert.equal((await b.get('/admin/leads')).status, 200);

    const sessions = await t.prisma.session.findMany();
    assert.equal(sessions.length, 1);
    assert.notEqual(sessions[0].token, setupSessionToken, 'the setup session was replaced');
    assert.equal(sessions[0].secondFactorVerified, true);
    assert.equal((await t.prisma.user.findUniqueOrThrow({ where: { email: ARVI } })).twoFactorEnabled, true);

    // Setup can't be repeated once enrolled.
    assert.equal((await b.post('/api/auth/two-factor/enable', {})).status, 403);

    await waitForAlert('New authenticator set up');
    await waitForAlert('Successful sign-in');
  });

  it('a later sign-in requires the authenticator; a wrong code is rejected and alerted', async () => {
    const first = browser(t.server);
    const { secret } = await enroll(first, JOSUE);
    await clearRateLimits(t.prisma);
    outbox.length = 0;

    const b = browser(t.server);
    const step1 = await emailStep(b, JOSUE);
    assert.deepEqual(step1.body, { next: 'authenticator' });
    const bad = await b.post('/api/auth/two-factor/verify-totp', { code: wrongTotp(secret) });
    assert.equal(bad.status, 401);
    assert.equal((await b.get('/api/admin/leads')).status, 401);
    const alert = await waitForAlert('Wrong authenticator code');
    assert.match(alert.text, new RegExp(`Account: ${JOSUE}`));
    assert.deepEqual([...(alert.to as string[])].sort(), [ARVI, JOSUE]);

    const good = await b.post('/api/auth/two-factor/verify-totp', { code: totp(secret) });
    assert.equal(good.status, 200);
    assert.equal((await b.get('/api/admin/leads')).status, 200);
    await waitForAlert('Successful sign-in');
    assert.equal(alertMails('New authenticator set up').length, 0);
  });

  it('a backup code works once', async () => {
    const first = browser(t.server);
    const { backupCodes } = await enroll(first, JOSUE);
    await clearRateLimits(t.prisma);

    const b = browser(t.server);
    assert.deepEqual((await emailStep(b, JOSUE)).body, { next: 'authenticator' });
    const used = await b.post('/api/auth/two-factor/verify-backup-code', { code: backupCodes[0] });
    assert.equal(used.status, 200, JSON.stringify(used.body));
    assert.equal((await b.get('/api/admin/me')).status, 200);
    await waitForAlert('Backup code used');

    await clearRateLimits(t.prisma);
    const again = browser(t.server);
    assert.deepEqual((await emailStep(again, JOSUE)).body, { next: 'authenticator' });
    const reused = await again.post('/api/auth/two-factor/verify-backup-code', { code: backupCodes[0] });
    assert.equal(reused.status, 401);
    assert.equal((await again.get('/api/admin/me')).status, 401);
    await waitForAlert('Wrong backup code');
    // Another, unused code still works.
    const other = await again.post('/api/auth/two-factor/verify-backup-code', { code: backupCodes[1] });
    assert.equal(other.status, 200);
  });

  it('banned or non-admin users are refused even with a full session', async () => {
    const b = browser(t.server);
    await enroll(b, JOSUE);
    assert.equal((await b.get('/api/admin/me')).status, 200);
    await t.prisma.user.update({ where: { email: JOSUE }, data: { role: 'user' } });
    assert.equal((await b.get('/api/admin/me')).status, 401);
    await t.prisma.user.update({ where: { email: JOSUE }, data: { role: 'admin', banned: true } });
    assert.equal((await b.get('/api/admin/me')).status, 401);
  });
});

describe('rate limits', () => {
  it('sending codes: 3 per 10 minutes per IP', async () => {
    const b = browser(t.server);
    for (const email of [JOSUE, ARVI, 'a@bytebuntech.com']) assert.equal((await requestCode(b, email)).status, 200);
    assert.equal((await requestCode(b, 'b@bytebuntech.com')).status, 429);
  });

  it('sending codes: 3 per 10 minutes per email (from any IP)', async () => {
    const b = browser(t.server);
    for (let i = 0; i < 3; i++) {
      await t.prisma.$executeRawUnsafe('TRUNCATE auth_rate_limits'); // as if from a new IP each time
      assert.equal((await requestCode(b, JOSUE)).status, 200);
    }
    await t.prisma.$executeRawUnsafe('TRUNCATE auth_rate_limits');
    const res = await requestCode(b, JOSUE);
    assert.equal(res.status, 429);
    // Same for an unknown address, so the limit reveals nothing.
    for (let i = 0; i < 3; i++) {
      await t.prisma.$executeRawUnsafe('TRUNCATE auth_rate_limits');
      assert.equal((await requestCode(b, 'nobody@bytebuntech.com')).status, 200);
    }
    await t.prisma.$executeRawUnsafe('TRUNCATE auth_rate_limits');
    assert.equal((await requestCode(b, 'nobody@bytebuntech.com')).status, 429);
  });

  it('verifying email codes: 5 per 5 minutes', async () => {
    const b = browser(t.server);
    for (let i = 0; i < 5; i++) assert.notEqual((await b.post('/api/auth/sign-in/email-otp', { email: JOSUE, otp: '000000' })).status, 429);
    assert.equal((await b.post('/api/auth/sign-in/email-otp', { email: JOSUE, otp: '000000' })).status, 429);
  });

  it('authenticator and backup codes: 5 per 5 minutes each', async () => {
    const first = browser(t.server);
    const { secret } = await enroll(first, JOSUE);
    await clearRateLimits(t.prisma);
    const b = browser(t.server);
    await emailStep(b, JOSUE);
    for (let i = 0; i < 5; i++) assert.notEqual((await b.post('/api/auth/two-factor/verify-totp', { code: wrongTotp(secret) })).status, 429, `try ${i + 1}`);
    assert.equal((await b.post('/api/auth/two-factor/verify-totp', { code: totp(secret) })).status, 429);
    for (let i = 0; i < 5; i++) assert.notEqual((await b.post('/api/auth/two-factor/verify-backup-code', { code: 'xxxxx-xxxxx' })).status, 429);
    assert.equal((await b.post('/api/auth/two-factor/verify-backup-code', { code: 'xxxxx-xxxxx' })).status, 429);
  });
});

describe('alerts', () => {
  it('fire for each event and are throttled to one per type per email per 10 minutes', async () => {
    const b = browser(t.server);
    for (let i = 0; i < 3; i++) {
      await t.prisma.$executeRawUnsafe('TRUNCATE auth_rate_limits');
      await t.prisma.$executeRawUnsafe(`DELETE FROM security_counters WHERE key LIKE 'otp-send:%'`);
      assert.equal((await requestCode(b, JOSUE)).status, 200);
    }
    await settle(600);
    assert.equal(alertMails('Sign-in code requested').length, 1, 'only one alert in the window');
    const first = alertMails('Sign-in code requested')[0];
    assert.equal(first.from, SENDER);
    assert.match(first.text, /IP: /);
    assert.match(first.text, /Browser: Mozilla\/5\.0 \(Windows NT 10\.0.*Chrome\//);
    assert.equal(first.subject, '[Byte Bun Security] Sign-in code requested: Josue Mapagdalita', 'subject names the admin');

    // The window passes: the next alert reports the 2 that were suppressed.
    await t.prisma.$executeRawUnsafe(`UPDATE security_counters SET window_start = now() - interval '11 minutes'`);
    await t.prisma.$executeRawUnsafe('TRUNCATE auth_rate_limits');
    assert.equal((await requestCode(b, JOSUE)).status, 200);
    const next = await waitForMail((m) => m.subject.startsWith('[Byte Bun Security] Sign-in code requested: ') && m !== first);
    assert.match(next.text, /2 more "Sign-in code requested" event\(s\) for this account were not emailed/);

    // Different accounts are throttled separately.
    await t.prisma.$executeRawUnsafe('TRUNCATE auth_rate_limits');
    await requestCode(b, ARVI);
    await waitForAlert('Sign-in code requested', (m) => m.text.includes(`Account: ${ARVI}`));
  });
});

describe('CLI', () => {
  it('seed:admins is idempotent and creates passwordless admins', async () => {
    const again = runScript('seed-admins');
    assert.equal(again.code, 0, again.stderr);
    const users = await t.prisma.user.findMany({ orderBy: { email: 'asc' } });
    assert.deepEqual(
      users.map((u) => [u.email, u.role, u.emailVerified]),
      [
        [ARVI, 'admin', true],
        [JOSUE, 'admin', true],
      ],
    );
    assert.equal(await t.prisma.account.count(), 0, 'no password accounts');
  });

  it('admin:reset-2fa signs the admin out everywhere and forces QR setup again', async () => {
    const b = browser(t.server);
    await enroll(b, JOSUE);
    assert.equal((await b.get('/api/admin/me')).status, 200);

    const r = runScript('reset-2fa', JOSUE);
    assert.equal(r.code, 0, r.stderr + r.stdout);
    assert.match(r.stdout, /Reset josue/);
    assert.equal((await b.get('/api/admin/me')).status, 401, 'signed out');
    assert.equal(await t.prisma.twoFactor.count(), 0);
    const alertRow = await t.prisma.securityCounter.findUnique({ where: { key: `alert:authenticator_reset:${JOSUE}` } });
    assert.ok(alertRow, 'reset alert was sent');

    await clearRateLimits(t.prisma);
    const next = browser(t.server);
    assert.deepEqual((await emailStep(next, JOSUE)).body, { next: 'setup' });
    const enable = await next.post('/api/auth/two-factor/enable', {});
    assert.equal(enable.status, 200);

    const missing = runScript('reset-2fa', 'nobody@bytebuntech.com');
    assert.equal(missing.code, 1);
  });
});

