import { authHttp } from './client.js';

// Admin sign-in steps. See backend/src/auth/auth.ts for the whole flow.
export const getSession = (config) => authHttp.get('/get-session', config);
// Always { success: true }, whether or not the email belongs to an admin.
export const sendSignInCode = (email) => authHttp.post('/email-otp/send-verification-otp', { email, type: 'sign-in' });
// -> { next: 'authenticator' | 'setup' }
export const verifyEmailCode = (email, otp) => authHttp.post('/sign-in/email-otp', { email, otp });
// -> { totpURI, backupCodes }
export const startAuthenticatorSetup = () => authHttp.post('/two-factor/enable', {});
// -> { ok, signedIn }
export const verifyAuthenticatorCode = (code) => authHttp.post('/two-factor/verify-totp', { code });
export const verifyBackupCode = (code) => authHttp.post('/two-factor/verify-backup-code', { code });
export const signOut = () => authHttp.post('/sign-out', {});
