import { ValidationError } from 'yup';

// Validates req.body against a yup schema. On success req.body is replaced with the cleaned
// value (trimmed, unknown fields stripped). On failure responds 400 with one message per field.
export function validateBody(schema) {
  return async (req, res, next) => {
    try {
      req.body = await schema.validate(req.body ?? {}, { abortEarly: false, stripUnknown: true });
      next();
    } catch (err) {
      if (!(err instanceof ValidationError)) return next(err);
      const fields = {};
      for (const issue of err.inner.length ? err.inner : [err]) {
        const key = issue.path || 'form';
        if (!fields[key]) fields[key] = issue.message;
      }
      res.status(400).json({ error: 'validation_failed', message: 'Please check the highlighted fields.', fields });
    }
  };
}
