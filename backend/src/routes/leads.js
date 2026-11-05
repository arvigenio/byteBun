import { Router } from 'express';
import * as yup from 'yup';
import { getPrisma } from '../db/prisma.js';
import { logger } from '../logger.js';
import { leadsLimiter } from '../middleware/rateLimit.js';
import { validateBody } from '../middleware/validate.js';
import { notifyLeadWebhook } from '../integrations/webhook.js';

const emptyToNull = (v) => (typeof v === 'string' && v.trim() === '' ? null : v);

// Field limits match the Leads table columns (prisma/schema.prisma).
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
  // Where on the site the form was opened (e.g. "hero", "final-cta"). Optional, for reporting.
  source: yup
    .string()
    .transform(emptyToNull)
    .nullable()
    .trim()
    .max(50)
    .matches(/^[a-z0-9_-]+$/i, { message: 'Invalid source.', excludeEmptyString: true }),
  // Honeypot: hidden from people, often filled by bots. Must be empty.
  website: yup.string().transform(emptyToNull).nullable(),
});

export const leadsRouter = Router();

leadsRouter.post('/', leadsLimiter, validateBody(leadSchema), async (req, res, next) => {
  const { website, ...data } = req.body;

  if (website) {
    // Looks like a bot. Pretend it worked so it doesn't retry, but save nothing.
    logger.warn('Lead rejected by honeypot');
    return res.status(201).json({ ok: true });
  }

  try {
    const lead = await getPrisma().lead.create({
      data: {
        name: data.name,
        email: data.email,
        phone: data.phone ?? null,
        businessName: data.businessName,
        businessType: data.businessType,
        message: data.message ?? null,
        source: data.source || 'website',
      },
      select: { id: true, createdAt: true, name: true, email: true, phone: true, businessName: true, businessType: true, message: true, source: true, status: true },
    });

    logger.info({ leadId: lead.id }, 'Lead saved');
    notifyLeadWebhook(lead); // fire and forget; never affects the response
    res.status(201).json({ ok: true, id: lead.id });
  } catch (err) {
    next(err);
  }
});
