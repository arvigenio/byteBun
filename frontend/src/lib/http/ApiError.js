// The one error type every request made with lib/http rejects with.
//  - message: safe to show to visitors
//  - status:  HTTP status, or undefined when the server never answered
//  - fields:  per-field messages from server validation (e.g. { email: 'Please enter...' })
//  - code:    'network' | 'timeout' | 'http'
export class ApiError extends Error {
  constructor(message, { status, fields, code = 'http', cause } = {}) {
    super(message, { cause });
    this.name = 'ApiError';
    this.status = status;
    this.fields = fields ?? {};
    this.code = code;
  }

  get isValidation() {
    return this.status === 400 || this.status === 422;
  }
}

export const isApiError = (err) => err instanceof ApiError;
