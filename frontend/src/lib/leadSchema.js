import * as yup from 'yup';

// Mirrors backend/src/leads/lead.schema.ts (leadSchema). Keep the two in step: same rules, same
// messages. The server stays the authority; this copy just gives instant feedback.
// `source` is not here: the form doesn't edit it, the submit thunk adds it.
const emptyToNull = (v) => (typeof v === 'string' && v.trim() === '' ? null : v);

// Matches OTHER_BUSINESS_TYPE in the backend: choosing it requires a description.
export const OTHER_BUSINESS_TYPE = 'Other';
// Matches OTHER_GOAL in backend/src/leads/lead-options.ts: choosing it requires a description.
export const OTHER_GOAL = 'other';

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
  phone: yup
    .string()
    .transform(emptyToNull)
    .nullable()
    .trim()
    .max(40, 'Phone number is too long.')
    .matches(/^[0-9+()\-.\s]{6,40}$/, { message: 'Please enter a valid phone number, or leave it empty.', excludeEmptyString: true }),
  businessName: yup.string().transform(emptyToNull).nullable().trim().max(160, 'Business name is too long (160 characters max).'),
  businessType: yup.string().trim().required('Please choose your type of business.').max(80, 'Business type is too long.'),
  businessTypeOther: yup
    .string()
    .transform(emptyToNull)
    .nullable()
    .trim()
    .max(70, 'Business type is too long (70 characters max).')
    .when('businessType', { is: OTHER_BUSINESS_TYPE, then: (s) => s.required('Please tell us your type of business.') }),
  // Checkbox groups (arrays of option keys from site.js). The server checks the keys.
  goals: yup.array(yup.string()).required('Please choose at least one goal.').min(1, 'Please choose at least one goal.'),
  goalsOther: yup
    .string()
    .transform(emptyToNull)
    .nullable()
    .trim()
    .max(200, 'This is too long (200 characters max).')
    .when('goals', { is: (goals) => goals?.includes(OTHER_GOAL), then: (s) => s.required('Please tell us what you want to achieve.') }),
  features: yup.array(yup.string()).default([]), // optional
  // ISO start time of the call, one of the open slots. The server checks it is still open.
  meetingAt: yup.string().required('Please choose a time for your call.'),
  timeZone: yup.string().transform(emptyToNull).nullable().trim().max(64),
  message: yup.string().transform(emptyToNull).nullable().trim().max(2000, 'Message is too long (2,000 characters max).'),
  // Honeypot: hidden from people, often filled by bots. Not validated; the server checks it.
  website: yup.string().transform(emptyToNull).nullable(),
});

export const emptyLead = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  businessName: '',
  businessType: '',
  businessTypeOther: '',
  goals: [],
  goalsOther: '',
  features: [],
  message: '',
  meetingAt: '',
  timeZone: '',
  website: '',
};

// The fields on each step of the lead page, in order. Copy for each step is in site.js
// (getStarted.steps), in the same order.
export const LEAD_STEPS = [
  ['businessType', 'businessTypeOther', 'businessName'],
  ['goals', 'goalsOther'],
  ['features', 'message'],
  [], // bonus (promo, nothing to fill in)
  ['firstName', 'lastName'],
  ['meetingAt'],
  ['email', 'phone'],
];
