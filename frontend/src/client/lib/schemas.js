import * as yup from 'yup';

// Mirrors backend/src/clients/booking/schemas.ts (the API checks again).
export const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,58}[a-z0-9])$/;
const slug = () => yup.string().trim().lowercase().matches(SLUG_RE, 'Use 3-60 lowercase letters, numbers and dashes.').required('Please choose your booking link.');
const num = (label, min, max) =>
  yup
    .number()
    .transform((v, o) => (o === '' || o === null ? undefined : v))
    .typeError(`${label} must be a number.`)
    .integer(`${label} must be a whole number.`)
    .min(min, `${label}: at least ${min}.`)
    .max(max, `${label}: at most ${max}.`);

export const emailSchema = yup.object({ email: yup.string().trim().email('Please enter a valid email address.').required('Please enter your email address.') });
export const codeSchema = yup.object({ otp: yup.string().trim().matches(/^\d{6}$/, 'Enter the 6-digit code from the email.').required('Enter the 6-digit code from the email.') });

const firstName = () => yup.string().trim().required('Please enter your first name.').max(60, 'At most 60 characters.');
const lastName = () => yup.string().trim().max(60, 'At most 60 characters.');

export const onboardingSchema = yup.object({
  firstName: firstName(),
  lastName: lastName(),
  businessName: yup.string().trim().min(2, 'Please enter the business name.').max(120).required('Please enter the business name.'),
  slug: slug(),
  timeZone: yup.string().required('Please choose a time zone.'),
});

export const profileSchema = yup.object({
  firstName: firstName(),
  lastName: lastName(),
  phone: yup.string().trim().max(40, 'At most 40 characters.'),
});
export const companySchema = yup.object({
  name: yup.string().trim().min(2, 'Please enter the company name.').max(120, 'At most 120 characters.').required('Please enter the company name.'),
});

export const serviceSchema = yup.object({
  name: yup.string().trim().required('Please enter a name.').max(120),
  description: yup.string().trim().max(1000),
  durationMinutes: num('Duration', 5, 720).required('Please enter the duration.'),
  bufferMinutes: num('Buffer', 0, 240).default(0),
  locationType: yup.string().oneOf(['in_person', 'online', 'phone']).required(),
  address: yup.string().trim().max(300),
  meetingUrl: yup
    .string()
    .trim()
    .max(500)
    .matches(/^https:\/\/\S+$/, { message: 'Use a link starting with https://', excludeEmptyString: true }),
  instructions: yup.string().max(5000),
});

export const rulesSchema = yup.object({
  timeZone: yup.string().required(),
  mode: yup.string().oneOf(['slots', 'date']).required(),
  intervalMinutes: num('Interval', 5, 480).required('Please enter the interval.'),
  bookersPerSlot: num('Bookers per slot', 1, 100).required('Please enter a number.'),
  maxPerDay: num('Max per day', 1, 1000).nullable(),
  minNoticeMinutes: num('Minimum notice', 0, 43200).required(),
  windowDays: num('Booking window', 1, 365).required(),
  changeCutoffHours: num('Change cutoff', 0, 336).nullable(),
});

export const pageSchema = yup.object({
  businessName: yup.string().trim().min(2, 'Please enter the business name.').max(120).required('Please enter the business name.'),
  slug: slug(),
  pageInstructions: yup.string().trim().max(2000),
  privateInstructions: yup.string().max(5000),
  primaryColor: yup.string().matches(/^#[0-9a-fA-F]{6}$/, 'Use a hex color like #0F766E.').required(),
  phone: yup.string().trim().max(40),
  contactEmail: yup.string().trim().email('Please enter a valid email address.').max(254),
});

export const bookingSchema = yup.object({
  name: yup.string().trim().min(2, 'Please enter your name.').max(120).required('Please enter your name.'),
  email: yup.string().trim().email('Please enter a valid email address.').required('Please enter your email address.'),
  phone: yup.string().trim().max(40),
  note: yup.string().trim().max(1000),
  website: yup.string(),
});

export const inviteSchema = yup.object({
  email: yup.string().trim().email('Please enter a valid email address.').required('Please enter an email address.'),
  role: yup.string().oneOf(['owner', 'admin', 'staff']).required(),
});
