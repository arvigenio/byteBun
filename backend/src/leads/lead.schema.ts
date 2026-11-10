import * as yup from 'yup';
import { ORIGINS } from './attribution';
import { FEATURE_KEYS, GOAL_KEYS, OTHER_GOAL } from './lead-options';

// POST /api/leads body. Field limits match the Leads table columns (prisma/schema.prisma).
// Mirrored by frontend/src/lib/leadSchema.js: keep the two in step (same rules, same messages).
const emptyToNull = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? null : v);

// The "Other" business type option; its description is required and saved as "Other: <text>".
export const OTHER_BUSINESS_TYPE = 'Other';

const isTimeZone = (tz: string) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

// Optional fields both the lead page and the admin booking dialog have (same rules, same messages).
const phoneField = () =>
  yup
    .string()
    .transform(emptyToNull)
    .nullable()
    .trim()
    .max(40, 'Phone number is too long.')
    .matches(/^[0-9+()\-.\s]{6,40}$/, { message: 'Please enter a valid phone number, or leave it empty.', excludeEmptyString: true });
const businessNameField = () => yup.string().transform(emptyToNull).nullable().trim().max(160, 'Business name is too long (160 characters max).');
const messageField = () => yup.string().transform(emptyToNull).nullable().trim().max(2000, 'Message is too long (2,000 characters max).');
const timeZoneField = () =>
  yup
    .string()
    .transform(emptyToNull)
    .nullable()
    .trim()
    .max(64)
    .test('time-zone', 'Invalid time zone.', (v) => !v || isTimeZone(v));

export const leadSchema = yup.object({
  firstName: yup.string().trim().required('Please enter your first name.').max(50, 'First name is too long (50 characters max).'),
  lastName: yup.string().trim().required('Please enter your last name.').max(50, 'Last name is too long (50 characters max).'),
  email: yup
    .string()
    .trim()
    .lowercase()
    .required('Please enter your email address.')
    .max(254, 'Email is too long.')
    .email('Please enter a valid email address, like name@example.com.'),
  phone: phoneField(),
  businessName: businessNameField(),
  businessType: yup.string().trim().required('Please choose your type of business.').max(80, 'Business type is too long.'),
  businessTypeOther: yup
    .string()
    .transform(emptyToNull)
    .nullable()
    .trim()
    .max(70, 'Business type is too long (70 characters max).')
    .when('businessType', { is: OTHER_BUSINESS_TYPE, then: (s) => s.required('Please tell us your type of business.') }),
  goals: yup
    .array(yup.string().required().oneOf(GOAL_KEYS, 'Please choose from the listed goals.'))
    .required('Please choose at least one goal.')
    .min(1, 'Please choose at least one goal.'),
  goalsOther: yup
    .string()
    .transform(emptyToNull)
    .nullable()
    .trim()
    .max(200, 'This is too long (200 characters max).')
    .when('goals', { is: (goals?: string[]) => goals?.includes(OTHER_GOAL), then: (s) => s.required('Please tell us what you want to achieve.') }),
  // Optional.
  features: yup.array(yup.string().required().oneOf(FEATURE_KEYS, 'Please choose from the listed features.')).default([]),
  message: messageField(),
  // Start of the free call (ISO 8601). Must be an open slot from GET /api/booking/slots.
  meetingAt: yup.date().typeError('Please choose a time for your call.').required('Please choose a time for your call.'),
  // The visitor's IANA time zone (e.g. "America/New_York"), so the team knows their local time.
  timeZone: timeZoneField(),
  // Where on the site the form was opened (e.g. "hero", "final-cta"). Optional, for reporting.
  source: yup
    .string()
    .transform(emptyToNull)
    .nullable()
    .trim()
    .max(50)
    .matches(/^[a-z0-9_-]+$/i, { message: 'Invalid source.', excludeEmptyString: true }),
  // How the visitor reached the site: { utmSource, utmMedium, utmCampaign, referrer, clickIds,
  // landingPath } (frontend/src/lib/attribution.js). Optional and never rejected: the server
  // cleans and classifies it (src/leads/attribution.ts) and drops anything it doesn't understand.
  attribution: yup.mixed<Record<string, unknown>>().nullable().optional(),
  // Honeypot: hidden from people, often filled by bots. Must be empty.
  website: yup.string().transform(emptyToNull).nullable(),
  // Milliseconds between the form opening and submit, sent by the site (not a form field).
  // Too fast means a bot (see LeadsService). Optional, so a page loaded before this existed still works.
  fillMs: yup.number().integer().min(0).nullable(),
});

export type LeadInput = yup.InferType<typeof leadSchema>;

// POST /api/admin/bookings body: an admin books a call for someone (LeadsService.bookByAdmin).
// The same limits as the lead page, worded for the admin; only the name, email and time are needed.
// What they want (goals, features) and notes for the team are optional.
// Mirrored by frontend/src/lib/adminSchemas.js (adminBookingSchema).
export const adminBookingSchema = yup.object({
  firstName: yup.string().trim().required('Please enter a first name.').max(50, 'First name is too long (50 characters max).'),
  lastName: yup.string().trim().required('Please enter a last name.').max(50, 'Last name is too long (50 characters max).'),
  email: yup
    .string()
    .trim()
    .lowercase()
    .required('Please enter their email address: the confirmation goes there.')
    .max(254, 'Email is too long.')
    .email('Please enter a valid email address, like name@example.com.'),
  phone: phoneField(),
  businessName: businessNameField(),
  businessType: yup.string().transform(emptyToNull).nullable().trim().max(80, 'Business type is too long (80 characters max).'),
  // How they found us, when the admin knows (src/leads/attribution.ts ORIGINS).
  origin: yup.string().transform(emptyToNull).nullable().oneOf([...ORIGINS, null], 'Choose one of the listed options.'),
  // What they want: the lead page's goals and features (optional here), so the team can prepare.
  goals: yup.array(yup.string().required().oneOf(GOAL_KEYS, 'Please choose from the listed goals.')).default([]),
  goalsOther: yup
    .string()
    .transform(emptyToNull)
    .nullable()
    .trim()
    .max(200, 'This is too long (200 characters max).')
    .when('goals', { is: (goals?: string[]) => goals?.includes(OTHER_GOAL), then: (s) => s.required('Please describe the "Other" goal.') }),
  features: yup.array(yup.string().required().oneOf(FEATURE_KEYS, 'Please choose from the listed features.')).default([]),
  // Notes for the team about the client and the call, saved as the lead's message.
  message: messageField(),
  // Must be an open slot (GET /api/admin/bookings/slots).
  startsAt: yup.date().typeError('Choose a time for the call.').required('Choose a time for the call.'),
  // Their IANA time zone: their emails show the call in it.
  timeZone: timeZoneField(),
});

export type AdminBookingInput = yup.InferType<typeof adminBookingSchema>;
