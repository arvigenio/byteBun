import * as yup from 'yup';

// Mirrors backend/src/routes/leads.js (leadSchema). Keep the two in step: same rules, same
// messages. The server stays the authority; this copy just gives instant feedback.
// `source` is not here: the form doesn't edit it, the submit thunk adds it.
const emptyToNull = (v) => (typeof v === 'string' && v.trim() === '' ? null : v);

export const leadSchema = yup.object({
  name: yup.string().trim().required('Please enter your name.').max(120, 'Name is too long (120 characters max).'),
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
  businessName: yup.string().trim().required('Please enter your business name.').max(160, 'Business name is too long (160 characters max).'),
  businessType: yup.string().trim().required('Please choose your type of business.').max(80, 'Business type is too long.'),
  message: yup.string().transform(emptyToNull).nullable().trim().max(2000, 'Message is too long (2,000 characters max).'),
  // Honeypot: hidden from people, often filled by bots. Not validated; the server checks it.
  website: yup.string().transform(emptyToNull).nullable(),
});

export const emptyLead = { name: '', email: '', phone: '', businessName: '', businessType: '', message: '', website: '' };
