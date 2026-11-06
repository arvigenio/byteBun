import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, HttpStatus, Inject } from '@nestjs/common';
import type { Request, Response } from 'express';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { logger } from '../logging/logger';
import { ApiError } from './api-error';

// Central error handler: every error becomes { error, message, fields? }.
// Stack traces are logged, never sent to the client in production.
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const http = host.switchToHttp();
    const req = http.getRequest<Request>();
    const res = http.getResponse<Response>();
    if (res.headersSent) return;

    if (exception instanceof ApiError) return res.status(exception.getStatus()).json(exception.getResponse());
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      if (status === HttpStatus.NOT_FOUND) return res.status(404).json({ error: 'not_found', message: 'This API route does not exist.' });
      if (status < 500) return res.status(status).json({ error: 'request_error', message: exception.message });
    }

    const err = exception instanceof Error ? exception : new Error(String(exception));
    // Log the error itself, not the request body (it may contain personal data).
    logger.error(
      { err: { message: err.message, stack: err.stack, code: (err as { code?: unknown }).code }, method: req.method, path: req.path, status: 500 },
      'Request failed',
    );
    res.status(500).json({
      error: 'server_error',
      message: 'Something went wrong on our side. Please try again in a moment.',
      ...(this.cfg.isProd ? {} : { debug: { message: err.message, stack: err.stack } }),
    });
  }
}
