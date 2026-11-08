import * as yup from 'yup';

// Mirrors rescheduleSchema in backend/src/booking/manage-booking.controller.ts. Keep the two in
// step: same rules, same messages. The server stays the authority.
export const rescheduleSchema = yup.object({
  // ISO start time of the call, one of the open slots. The server checks it is still open.
  meetingAt: yup.string().required('Please choose a time for your call.'),
  timeZone: yup
    .string()
    .transform((v) => (typeof v === 'string' && v.trim() === '' ? null : v))
    .nullable()
    .trim()
    .max(64),
});

// The token from /manage-booking#t=<leadId>.<signature> (backend/src/booking/manage-link.ts).
export function readManageToken(hash = window.location.hash) {
  const t = new URLSearchParams(hash.replace(/^#/, '')).get('t')?.trim() ?? '';
  return /^\d{1,10}\.[A-Za-z0-9_-]{43}$/.test(t) ? t : '';
}
