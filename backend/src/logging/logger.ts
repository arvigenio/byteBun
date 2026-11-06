import type { LoggerService } from '@nestjs/common';
import pino from 'pino';
import { config } from '../config/config';

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

// Routes Nest's own messages (startup, route mapping, errors) through pino, so every line is
// JSON. Nest's routine "log" messages go to debug to keep startup output short.
export class PinoNestLogger implements LoggerService {
  log(message: unknown, ...rest: unknown[]) {
    logger.debug({ context: contextOf(rest) }, String(message));
  }
  error(message: unknown, ...rest: unknown[]) {
    const [stack] = rest;
    logger.error({ context: contextOf(rest), ...(typeof stack === 'string' && stack.includes('\n') && { stack }) }, String(message));
  }
  warn(message: unknown, ...rest: unknown[]) {
    logger.warn({ context: contextOf(rest) }, String(message));
  }
  debug(message: unknown, ...rest: unknown[]) {
    logger.debug({ context: contextOf(rest) }, String(message));
  }
  verbose(message: unknown, ...rest: unknown[]) {
    logger.trace({ context: contextOf(rest) }, String(message));
  }
  fatal(message: unknown, ...rest: unknown[]) {
    logger.fatal({ context: contextOf(rest) }, String(message));
  }
}

// Nest passes the context (class name) as the last string argument.
function contextOf(rest: unknown[]): string | undefined {
  const last = rest[rest.length - 1];
  return typeof last === 'string' && !last.includes('\n') ? last : undefined;
}
