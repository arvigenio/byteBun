import { rateLimit } from 'express-rate-limit';
import { config } from '../config.js';

const handler = (message) => (req, res) => res.status(429).json({ error: 'rate_limited', message });

// Generous limit for the whole API.
export const apiLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 300,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: handler('Too many requests. Please wait a few minutes and try again.'),
});

// Strict limit for the lead form, to slow down spam.
export const leadsLimiter = rateLimit({
  windowMs: config.leadsRateLimit.windowMs,
  limit: config.leadsRateLimit.max,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: handler('You have sent several messages in a short time. Please wait a little and try again, or email us directly.'),
});
