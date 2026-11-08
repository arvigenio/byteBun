import { createHttpClient } from '../lib/http/index.js';

// The Byte Bun backend. In development Vite proxies /api to the api container;
// in production the same server serves the site and /api.
// Its error body is { message, fields } (backend/src/middleware/validate.js), which matches the
// library defaults.
export const http = createHttpClient({ baseURL: '/api' });

// Admin sign-in (Better Auth, backend/src/auth/auth.ts). Its errors are { message, code }; the
// codes are turned into messages an admin can act on.
const AUTH_MESSAGES = {
  INVALID_OTP: 'That code is not right. Check the email and try again.',
  OTP_EXPIRED: 'That code has expired. Request a new one.',
  TOO_MANY_ATTEMPTS: 'Too many wrong codes. Request a new code.',
  INVALID_CODE: 'That code is not right. Check your authenticator app and try again.',
  INVALID_BACKUP_CODE: 'That backup code is not valid (each one works only once).',
  INVALID_TWO_FACTOR_COOKIE: 'This sign-in expired. Please start again.',
  TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE: 'Too many wrong codes. Please start again.',
  ACCOUNT_TEMPORARILY_LOCKED: 'Too many wrong codes. Wait 15 minutes, then start again.',
  TOTP_NOT_ENABLED: 'Authenticator setup was not started. Please start again.',
};
export const authHttp = createHttpClient({
  baseURL: '/api/auth',
  getErrorMessage: (data) => AUTH_MESSAGES[data?.code] ?? data?.message,
});
