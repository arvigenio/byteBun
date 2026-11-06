import { type PipeTransform } from '@nestjs/common';
import { type AnyObject, type ObjectSchema, ValidationError } from 'yup';
import { ApiError } from './api-error';

// Validates a request body against a yup schema: @Body(new YupValidationPipe(schema)).
// On success the body is replaced with the cleaned value (trimmed, unknown fields stripped).
// On failure: 400 with one message per field.
// yup (not class-validator) so the rules and messages stay a mirror of the frontend's schema
// (frontend/src/lib/leadSchema.js).
export class YupValidationPipe<T extends AnyObject> implements PipeTransform<unknown, Promise<T>> {
  constructor(private readonly schema: ObjectSchema<T>) {}

  async transform(value: unknown): Promise<T> {
    try {
      return (await this.schema.validate(value ?? {}, { abortEarly: false, stripUnknown: true })) as T;
    } catch (err) {
      if (!(err instanceof ValidationError)) throw err;
      const fields: Record<string, string> = {};
      for (const issue of err.inner.length ? err.inner : [err]) {
        const key = (issue.path || 'form').replace(/[[.].*$/, ''); // "goals[2]" -> "goals"
        fields[key] ??= issue.message;
      }
      throw new ApiError(400, { error: 'validation_failed', message: 'Please check the highlighted fields.', fields });
    }
  }
}
