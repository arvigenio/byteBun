import pino from 'pino';
import { config } from './config.js';

// Structured JSON logs. Personal data is never logged: request bodies are not passed to the
// logger, and these paths are redacted as a safety net in case someone logs an object by mistake.
export const logger = pino({
  level: config.logLevel,
  base: { service: 'bytebun-api' },
  redact: {
    paths: ['body', 'req.body', 'lead', '*.lead', 'email', '*.email', 'phone', '*.phone', 'password', '*.password'],
    censor: '[redacted]',
  },
});
