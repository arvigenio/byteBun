import { config } from '../config.js';
import { logger } from '../logger.js';

export function apiNotFound(req, res) {
  res.status(404).json({ error: 'not_found', message: 'This API route does not exist.' });
}

// Central error handler. Stack traces are logged, never sent to the client in production.
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'payload_too_large', message: 'The message is too long.' });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'invalid_json', message: 'The request could not be read.' });
  }

  const status = Number.isInteger(err.status) && err.status >= 400 && err.status < 600 ? err.status : 500;
  // Log the error itself, not the request body (it may contain personal data).
  logger.error({ err: { message: err.message, stack: err.stack, code: err.code }, method: req.method, path: req.path, status }, 'Request failed');

  if (res.headersSent) return;
  res.status(status).json({
    error: status === 500 ? 'server_error' : 'request_error',
    message: status === 500 ? 'Something went wrong on our side. Please try again in a moment.' : err.expose ? err.message : 'The request could not be completed.',
    ...(config.isProd ? {} : { debug: { message: err.message, stack: err.stack } }),
  });
}
