import { HttpException } from '@nestjs/common';

// Every error response has this shape (the frontend's HTTP client reads `message` and `fields`):
//   { error: 'validation_failed', message: 'Please check the highlighted fields.', fields: { email: '...' } }
export interface ApiErrorBody {
  error: string;
  message: string;
  /** Per-field messages, shown next to the form fields. */
  fields?: Record<string, string>;
  /** Bookings: the existing bookings a change would affect (e.g. blocking a date), for the UI to list. */
  conflicts?: unknown[];
  /** Check-in: the event a scanned code belongs to (when it isn't for this scanner). */
  event?: unknown;
}

export class ApiError extends HttpException {
  constructor(status: number, body: ApiErrorBody) {
    super(body, status);
  }
}
