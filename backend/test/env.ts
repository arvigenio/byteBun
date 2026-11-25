// Imported first by every test file: configuration for the test run, set before src/config loads.
// Tests use their own database (bytebun_test by default) on the same PostgreSQL server; it is
// created and migrated automatically. Emails go to the in-memory outbox (src/auth/mailer.ts).
import path from 'node:path';

process.env.NODE_ENV = 'test';
process.env.DB_NAME = process.env.TEST_DB_NAME || 'bytebun_test';
process.env.CLIENTS_DB_NAME = process.env.TEST_CLIENTS_DB_NAME || 'clients_db_test';
process.env.CLIENTS_DATABASE_URL = '';
// Client hosts (clients/hosts.ts); tests send these as the Host header. Host-only cookies.
process.env.ACCOUNTS_URL = 'http://accounts.localhost:5173';
process.env.BOOKINGS_URL = 'http://bookings.localhost:5173';
process.env.PORTAL_URL = 'http://clientportal.localhost:5173';
process.env.SCANNER_URL = 'http://scanner.localhost:5173';
process.env.CLIENT_COOKIE_DOMAIN = '';
// WhatsApp: in tests messages land in whatsappOutbox (notifications.ts), never on the network.
process.env.WHATSAPP_WEBHOOK_URL = 'http://n8n.test/whatsapp';
process.env.OWNER_ADMIN_EMAILS = '';
process.env.CLIENTS_ADMIN_DB_USER = '';
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
// Prospecting: results from a fixture file, and no real website checkups (no network in tests).
process.env.PROSPECTS_FIXTURE_FILE = path.resolve(__dirname, '../../test/fixtures/prospects.json');
process.env.PROSPECTS_WEBSITE_CHECKS = 'false';
process.env.GOOGLE_PLACES_API_KEY = '';
