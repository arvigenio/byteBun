// Request bodies of the Bookings API (yup, like the rest of the API). The frontend mirrors these
// rules in frontend/src/client/lib/schemas.js.
import * as yup from 'yup';
import { RESERVED_SLUGS } from '../hosts';
import { isDate, isTimeZone } from './time';

const HEX = /^#[0-9a-fA-F]{6}$/;
export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,58}[a-z0-9])$/;
export const FONTS = ['system', 'serif', 'rounded', 'mono'] as const;
export const BUTTON_STYLES = ['rounded', 'pill', 'square'] as const;

const minute = (label: string) => yup.number().integer().min(0, `${label} is not valid.`).max(24 * 60, `${label} is not valid.`).required();
const optionalText = (max: number) => yup.string().trim().max(max, `At most ${max} characters.`).nullable().transform((v) => (v === '' ? null : v));
const email = () => yup.string().trim().lowercase().email('Please enter a valid email address.').max(254);

export const slugField = () =>
  yup
    .string()
    .trim()
    .lowercase()
    .matches(SLUG_RE, 'Use 3-60 lowercase letters, numbers and dashes (not at the start or end).')
    .test('reserved', 'That link is reserved. Please choose another.', (v) => !v || !RESERVED_SLUGS.has(v));

export const timeZoneField = () => yup.string().trim().test('tz', 'Please choose a valid time zone.', (v) => v === undefined || isTimeZone(v));

const firstName = () => yup.string().trim().min(1, 'Please enter your first name.').max(60, 'At most 60 characters.').required('Please enter your first name.');
const lastName = () =>
  yup
    .string()
    .trim()
    .max(60, 'At most 60 characters.')
    .nullable()
    .transform((v) => (v === '' ? null : v));

export const onboardingSchema = yup.object({
  firstName: firstName(),
  lastName: lastName(),
  businessName: yup.string().trim().min(2, 'Please enter the business name.').max(120).required('Please enter the business name.'),
  slug: slugField().required('Please choose your booking link.'),
  timeZone: timeZoneField().required(),
});

export const settingsSchema = yup.object({
  businessName: yup.string().trim().min(2).max(120),
  slug: slugField(),
  timeZone: timeZoneField(),
  mode: yup.string().oneOf(['slots', 'date']),
  intervalMinutes: yup.number().integer().min(5, 'At least 5 minutes.').max(480, 'At most 8 hours.'),
  bookersPerSlot: yup.number().integer().min(1, 'At least 1.').max(100, 'At most 100.'),
  maxPerDay: yup.number().integer().min(1, 'At least 1, or no limit.').max(1000).nullable(),
  minNoticeMinutes: yup.number().integer().min(0).max(60 * 24 * 30, 'At most 30 days.'),
  windowDays: yup.number().integer().min(1, 'At least 1 day.').max(365, 'At most 365 days.'),
  changeCutoffHours: yup.number().integer().min(0).max(24 * 14, 'At most 14 days.').nullable(),
  phone: optionalText(40),
  contactEmail: email().nullable().transform((v) => (v === '' ? null : v)),
  pageInstructions: optionalText(2000),
  privateInstructions: optionalText(5000),
  primaryColor: yup.string().matches(HEX, 'Use a hex color like #0F766E.'),
  accentColor: yup.string().matches(HEX, 'Use a hex color like #F59E0B.').nullable(),
  backgroundColor: yup.string().matches(HEX, 'Use a hex color like #FFFFFF.').nullable(),
  theme: yup.string().oneOf(['light', 'dark', 'custom']),
  font: yup.string().oneOf([...FONTS]),
  buttonStyle: yup.string().oneOf([...BUTTON_STYLES]),
  ownerAlerts: yup
    .object({
      newBooking: yup.array(yup.string().oneOf(['email', 'whatsapp'])).max(2),
      cancellation: yup.array(yup.string().oneOf(['email', 'whatsapp'])).max(2),
      reschedule: yup.array(yup.string().oneOf(['email', 'whatsapp'])).max(2),
    })
    .default(undefined),
  alertPhone: optionalText(40),
  reminders: yup
    .array(
      yup.object({
        offsetMinutes: yup.number().integer().min(60, 'Reminders can be at most 1 hour before.').max(43200, 'At most 30 days before.').required(),
        channel: yup.string().oneOf(['email', 'whatsapp']).required(),
      }),
    )
    .max(3, 'At most 3 reminders.')
    .test('unique', 'Each reminder needs a different time.', (v) => !v || new Set(v.map((r) => r.offsetMinutes)).size === v.length)
    .default(undefined),
  noShowFollowUp: yup.boolean(),
});

export const noShowSchema = yup.object({ noShow: yup.boolean().default(true) });

/** Check-in: the code (typed, or the QR code's link) or a booking id; `force` checks in another day's or a past booking. */
export const checkInSchema = yup.object({
  code: yup.string().trim().max(300).nullable(),
  id: yup.number().integer().positive().nullable(),
  force: yup.boolean().default(false),
});

const range = () =>
  yup.object({ weekday: yup.number().integer().min(0).max(6).required(), startMinute: minute('Start'), endMinute: minute('End') }).test('order', 'The end must be after the start.', (v) => !v || v.endMinute > v.startMinute);

export const hoursSchema = yup.object({
  hours: yup
    .array(range())
    .max(7)
    .required()
    .test('unique', 'Each weekday once.', (v) => !v || new Set(v.map((h) => h.weekday)).size === v.length),
  breaks: yup.array(range()).max(28).default([]),
});

export const blockedDateSchema = yup.object({
  startDate: yup.string().test('date', 'Please choose a date.', (v) => isDate(v)).required('Please choose a date.'),
  endDate: yup
    .string()
    .test('date', 'Please choose a date.', (v) => !v || isDate(v))
    .nullable(),
  /** A time window on each date (minutes after midnight, both or neither); none = the whole day. */
  startMinute: yup.number().integer().min(0).max(1439).nullable().default(null),
  endMinute: yup
    .number()
    .integer()
    .min(1)
    .max(1440)
    .nullable()
    .default(null)
    .test('pair', 'Please choose both times.', function (v) {
      return (v == null) === (this.parent.startMinute == null);
    })
    .test('order', 'The end time must be after the start time.', function (v) {
      return v == null || this.parent.startMinute == null || v > this.parent.startMinute;
    }),
  /** One service only; none = the whole business. */
  serviceId: yup.number().integer().positive().nullable().default(null),
  reason: optionalText(200),
  /** What to do with confirmed bookings on those dates: ask (default, 409 with the list), keep, cancel (customers are told). */
  existing: yup.string().oneOf(['ask', 'keep', 'cancel']).default('ask'),
});

export const serviceSchema = yup.object({
  name: yup.string().trim().min(1, 'Please enter a name.').max(120).required('Please enter a name.'),
  description: optionalText(1000),
  durationMinutes: yup.number().integer().min(5, 'At least 5 minutes.').max(12 * 60, 'At most 12 hours.').required(),
  bufferMinutes: yup.number().integer().min(0).max(240, 'At most 4 hours.').default(0),
  locationType: yup.string().oneOf(['in_person', 'online', 'phone']).default('in_person'),
  address: optionalText(300),
  meetingUrl: yup
    .string()
    .trim()
    .max(500)
    .matches(/^https:\/\/\S+$/, { message: 'Use a link starting with https://', excludeEmptyString: true })
    .nullable()
    .transform((v) => (v === '' ? null : v)),
  instructions: optionalText(5000),
  active: yup.boolean().default(true),
  position: yup.number().integer().min(0).max(1000),
});
export const servicePatchSchema = serviceSchema.partial();

export const bookSchema = yup.object({
  serviceId: yup.number().integer().positive().required('Please choose a service.'),
  startsAt: yup.date().typeError('Please choose a time.').nullable(),
  date: yup
    .string()
    .test('date', 'Please choose a day.', (v) => !v || isDate(v))
    .nullable(),
  name: yup.string().trim().min(2, 'Please enter your name.').max(120).required('Please enter your name.'),
  email: email().required('Please enter your email address.'),
  phone: optionalText(40),
  note: optionalText(1000),
  // Honeypot: real people never see or fill it.
  website: yup.string().max(200).nullable(),
});

export const rescheduleSchema = yup.object({
  startsAt: yup.date().typeError('Please choose a time.').nullable(),
  date: yup
    .string()
    .test('date', 'Please choose a day.', (v) => !v || isDate(v))
    .nullable(),
});

export const cancelSchema = yup.object({
  reason: optionalText(500),
  notify: yup.boolean().default(true),
});

export const inviteSchema = yup.object({
  email: email().required('Please enter an email address.'),
  role: yup.string().oneOf(['owner', 'admin', 'staff'], 'Choose a role.').required(),
});
export const roleSchema = yup.object({ role: yup.string().oneOf(['owner', 'admin', 'staff']).required() });
// The email is the sign-in identity and can't be changed here.
export const profileSchema = yup.object({
  firstName: firstName(),
  lastName: lastName(),
  phone: optionalText(40),
  email: yup.mixed().test('email', "Your email can't be changed.", (v) => v === undefined),
});
export const businessNameSchema = yup.object({
  name: yup.string().trim().min(2, 'Please enter the company name.').max(120, 'At most 120 characters.').required('Please enter the company name.'),
});
export const fullName = (first: string, last?: string | null) => [first, last].filter(Boolean).join(' ');
export const activeOrgSchema = yup.object({ organizationId: yup.string().trim().max(64).required() });
