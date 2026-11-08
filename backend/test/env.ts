// Imported first by every test file: configuration for the test run, set before src/config loads.
// Tests use their own database (bytebun_test by default) on the same PostgreSQL server; it is
// created and migrated automatically. Emails go to the in-memory outbox (src/auth/mailer.ts).
import path from 'node:path';

process.env.NODE_ENV = 'test';
process.env.DB_NAME = process.env.TEST_DB_NAME || 'bytebun_test';
process.env.LOG_LEVEL = process.env.TEST_LOG_LEVEL || 'fatal';
process.env.FRONTEND_ORIGIN = 'http://localhost:5173';
process.env.BETTER_AUTH_URL = 'http://localhost:5173';
process.env.BETTER_AUTH_SECRET = 'test-secret-0123456789-0123456789-0123456789';
process.env.LOGIN_PATH = '/bb-test-portal-k3x9';
process.env.ALERT_EMAILS = 'josue.mapagdalita@bytebuntech.com,arvi.genio@bytebuntech.com';
process.env.MAIL_FROM = 'Byte Bun Admin <admin@bytebuntech.com>';
process.env.SECURITY_ALERT_WEBHOOK_URL = '';
// Tests read the real recipients from the in-memory outbox; a local .env value must not redirect them.
process.env.TESTING_EMAIL_ADDRESS = '';
// The tests check the limits, so they are always on here.
process.env.RATE_LIMITS_DISABLED = '';
process.env.CALL_MEETING_URL = '';
process.env.SITE_URL = 'http://localhost:5173';
process.env.N8N_WEBHOOK_URL = '';
process.env.TRUST_PROXY = '';
// Every request in a test file comes from one IP; the lead form's real limit (5 per 15 min,
// per route) would trip across test cases.
process.env.LEADS_RATE_LIMIT_MAX = '100';
// dist-test/test/*.js -> backend/test/fixtures/static
process.env.STATIC_DIR = path.resolve(__dirname, '../../test/fixtures/static');
