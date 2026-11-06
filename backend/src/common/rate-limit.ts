import { type ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { ThrottlerGuard, type ThrottlerModuleOptions } from '@nestjs/throttler';
import type { AppConfig } from '../config/config';
import { ApiError } from './api-error';

// Two limits, per client IP (in memory, so they reset when the API restarts):
//  - "api":    generous, every route (opt out with @SkipThrottle())
//  - "strict": only routes marked @StrictRateLimit() (the lead form), to slow down spam
const STRICT = 'bytebun:strict-rate-limit';
export const StrictRateLimit = () => SetMetadata(STRICT, true);
const isStrict = (ctx: ExecutionContext) => Reflect.getMetadata(STRICT, ctx.getHandler()) === true;

export const rateLimitOptions = (cfg: AppConfig): ThrottlerModuleOptions => ({
  throttlers: [
    { name: 'api', ttl: 15 * 60_000, limit: 300 },
    { name: 'strict', ttl: cfg.leadsRateLimit.windowMs, limit: cfg.leadsRateLimit.max, skipIf: (ctx) => !isStrict(ctx) },
  ],
});

// Same limits as the stock guard, with our error body.
@Injectable()
export class ApiThrottlerGuard extends ThrottlerGuard {
  protected override async throwThrottlingException(context: ExecutionContext): Promise<void> {
    throw new ApiError(429, {
      error: 'rate_limited',
      message: isStrict(context)
        ? 'You have sent several messages in a short time. Please wait a little and try again, or email us directly.'
        : 'Too many requests. Please wait a few minutes and try again.',
    });
  }
}
