import * as yup from 'yup';

// Forms in the admin app. The server checks everything again.
export const emailSchema = yup.object({
  email: yup.string().trim().lowercase().required('Enter your email address.').email('Enter a valid email address.').max(254),
});

const sixDigits = (message) =>
  yup
    .string()
    .transform((v) => (typeof v === 'string' ? v.replace(/\s+/g, '') : v))
    .required(message)
    .matches(/^\d{6}$/, message);

export const emailCodeSchema = yup.object({ otp: sixDigits('Enter the 6-digit code from the email.') });
export const authenticatorCodeSchema = yup.object({ code: sixDigits('Enter the 6-digit code from your authenticator app.') });
export const backupCodeSchema = yup.object({
  code: yup.string().trim().required('Enter one of your backup codes.').max(40, 'That is not a backup code.'),
});
export const savedCodesSchema = yup.object({
  saved: yup.boolean().oneOf([true], 'Confirm you have saved your backup codes.'),
});

// Mirrors LEAD_STATUSES in backend/src/admin/admin-leads.ts.
export const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'won', 'lost', 'spam'];
// The "Came from" filter. Mirrors LEAD_FROM in backend/src/admin/admin-leads.ts.
export const LEAD_FROM_KEYS = ['web_form', 'chatbot', 'admin', 'social', 'search', 'ads', 'email', 'referral', 'direct', 'unknown'];
export const leadFilterSchema = yup.object({
  q: yup.string().trim().max(100, 'Search is too long.'),
  status: yup.string().oneOf(['', ...LEAD_STATUSES]),
  from: yup.string().oneOf(['', ...LEAD_FROM_KEYS]),
});

// Edit a lead (admin). Mirrors updateSchema in backend/src/admin/admin-leads.ts: same limits
// and messages as the public lead form.
const emptyToNull = (v) => (typeof v === 'string' && v.trim() === '' ? null : v);
export const OTHER_GOAL = 'other';
export const leadEditSchema = yup.object({
  firstName: yup.string().trim().required('Please enter a first name.').max(50, 'First name is too long (50 characters max).'),
  lastName: yup.string().trim().required('Please enter a last name.').max(50, 'Last name is too long (50 characters max).'),
  email: yup
    .string()
    .trim()
    .lowercase()
    .required('Please enter an email address.')
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
  // May be empty: calls booked by an admin often start without a type or goals.
  businessType: yup.string().trim().max(80, 'Business type is too long.'),
  goals: yup.array(yup.string().required()),
  goalsOther: yup
    .string()
    .transform(emptyToNull)
    .nullable()
    .trim()
    .max(200, 'This is too long (200 characters max).')
    .when('goals', { is: (g) => g?.includes(OTHER_GOAL), then: (s) => s.required('Please describe the "Other" goal.') }),
  features: yup.array(yup.string().required()),
  message: yup.string().transform(emptyToNull).nullable().trim().max(2000, 'Message is too long (2,000 characters max).'),
  status: yup.string().oneOf(LEAD_STATUSES, 'Choose a valid status.'),
});

// Admin reschedule / cancel (backend/src/admin/admin-leads.ts rescheduleSchema / cancelSchema).
// The note is optional and shown to the lead in their email.
const note = yup.string().transform(emptyToNull).nullable().trim().max(1000, 'The note is too long (1,000 characters max).');
export const adminRescheduleSchema = yup.object({
  startsAt: yup.string().required('Choose a new time.'),
  note,
});
export const adminCancelSchema = yup.object({ note });

// An admin books a call for someone (Bookings page). Mirrors adminBookingSchema in
// backend/src/leads/lead.schema.ts: only the name, email and time are needed.
export const ORIGIN_KEYS = ['social', 'search', 'ads', 'email', 'referral', 'direct'];
export const adminBookingSchema = yup.object({
  firstName: leadEditSchema.fields.firstName,
  lastName: leadEditSchema.fields.lastName,
  email: yup
    .string()
    .trim()
    .lowercase()
    .required('Please enter their email address: the confirmation goes there.')
    .max(254, 'Email is too long.')
    .email('Please enter a valid email address, like name@example.com.'),
  phone: leadEditSchema.fields.phone,
  businessName: leadEditSchema.fields.businessName,
  businessType: yup.string().transform(emptyToNull).nullable().trim().max(80, 'Business type is too long (80 characters max).'),
  origin: yup.string().transform(emptyToNull).nullable().oneOf([...ORIGIN_KEYS, null], 'Choose one of the listed options.'),
  // What they want (optional): the lead page's goals and features.
  goals: yup.array(yup.string().required()).default([]),
  goalsOther: leadEditSchema.fields.goalsOther,
  features: yup.array(yup.string().required()).default([]),
  message: leadEditSchema.fields.message,
  startsAt: yup.string().required('Choose a time for the call.'),
  timeZone: yup.string().trim().required('Choose their time zone.'),
});

// Prospecting search. Mirrors searchSchema in backend/src/prospects/prospects.controller.ts.
const PROSPECT_TEXT = /^[\p{L}\p{N}][\p{L}\p{N}\p{M} &'’.,()/-]*$/u;
export const prospectSearchSchema = yup.object({
  industry: yup
    .string()
    .trim()
    .required('Enter an industry, like "dentist" or "hair salon".')
    .min(2, 'Enter at least 2 characters.')
    .max(80, 'Industry is too long (80 characters max).')
    .matches(PROSPECT_TEXT, 'Use letters, numbers and spaces only.'),
  location: yup
    .string()
    .trim()
    .required('Enter a city or a country, like "Makati" or "Philippines".')
    .min(2, 'Enter at least 2 characters.')
    .max(120, 'Location is too long (120 characters max).')
    .matches(PROSPECT_TEXT, 'Use letters, numbers and spaces only.'),
});

// Saved prospects. Mirror groupSchema / updateSchema in backend/src/prospects/saved-prospects.controller.ts.
export const prospectGroupSchema = yup.object({
  name: yup
    .string()
    .trim()
    .required('Enter a name for the group.')
    .max(80, 'Group name is too long (80 characters max).')
    .matches(/^[^<>]*$/, 'Leave out < and >.'),
});
export const savedProspectNoteSchema = yup.object({
  note: yup.string().trim().max(2000, 'Note is too long (2000 characters max).'),
});

// Task board. Mirrors backend/src/tasks/tasks.schema.ts.
export const taskSchema = yup.object({
  title: yup.string().trim().required('Enter a title for the task.').max(200, 'Title is too long (200 characters max).'),
  description: yup.string().trim().max(2000, 'Description is too long (2000 characters max).'),
});
/** The task dialog: title, description, its column (state) and who it is assigned to ('' = nobody). */
export const TASK_STATUSES = ['todo', 'in_progress', 'done'];
export const taskDialogSchema = taskSchema.shape({
  status: yup.string().oneOf(TASK_STATUSES, 'Pick a state.').required('Pick a state.'),
  assignedTo: yup.string().trim(),
});
export const subtaskSchema = yup.object({
  title: yup.string().trim().required('Enter the subtask.').max(200, 'Subtask is too long (200 characters max).'),
});
/** The subtask dialog: its name and its column (state) on the task's own board. */
export const subtaskDialogSchema = subtaskSchema.shape({
  status: yup.string().oneOf(TASK_STATUSES, 'Pick a state.').required('Pick a state.'),
});
