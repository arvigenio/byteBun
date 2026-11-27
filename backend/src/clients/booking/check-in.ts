// Attendance check-in: every booking has an 8-character code, in a QR code in the customer's
// emails (in-person services). The front desk scans it on the full-screen scanner page (or types
// the code when the scan doesn't work) and the booking is marked as attended.
//
// The QR code holds a link to the scanner with the code (…/app/scan?code=ABCDEFGH), so a staff
// phone's own camera app opens the right page too.
import { randomInt } from 'node:crypto';
import QRCode from 'qrcode';

/** No look-alikes: no 0/O, 1/I/L. */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export const newCheckInCode = () => Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');

/** What staff typed or the camera read: a code, "ABCD-EFGH", or the QR code's link. Null if none. */
export function parseCheckInCode(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  let raw = input.trim();
  const fromUrl = /[?&]code=([A-Za-z0-9-]+)/.exec(raw);
  if (fromUrl) raw = fromUrl[1];
  // Typed codes: forgive lower case, spaces and the dash.
  const code = raw.toUpperCase().replace(/[\s-]/g, '');
  return code.length === 8 && [...code].every((c) => ALPHABET.includes(c)) ? code : null;
}

/** "ABCD-EFGH": easier to read out. */
/** ABCD-1234; '' for a registration with no code yet (a payment not confirmed). */
export const formatCheckInCode = (code: string | null) => (code ? `${code.slice(0, 4)}-${code.slice(4)}` : '');

export const checkInUrl = (bookingsUrl: string, code: string) => `${bookingsUrl}/app/scan?code=${code}`;

/** The QR code as a PNG, for the emails (an inline image: Gmail and Outlook block data: URLs). */
export const checkInQrPng = (url: string) => QRCode.toBuffer(url, { type: 'png', width: 320, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#111111', light: '#FFFFFF' } });
