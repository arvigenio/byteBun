import { type ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { normalizeIp, ThrottlerGuard, type ThrottlerModuleOptions } from '@nestjs/throttler';
import type { Request } from 'express';
import type { AppConfig } from '../config/config';
import { ApiError } from './api-error';
import { clientIp } from './client-ip';

// Two limits, per client IP (in memory, so they reset when the API restarts). The IP is the
// visitor's real one, also behind Cloudflare (client-ip.ts); IPv6 is counted per /64 network.
//  - "api":    generous, every route (opt out with @SkipThrottle())
//  - "strict": only routes marked @StrictRateLimit() (the lead form), to slow down spam
const STRICT = 'bytebun:strict-rate-limit';
export const StrictRateLimit = () => SetMetadata(STRICT, true);
const isStrict = (ctx: ExecutionContext) => Reflect.getMetadata(STRICT, ctx.getHandler()) === true;

export const rateLimitOptions = (cfg: AppConfig): ThrottlerModuleOptions => ({
  throttlers: [
    // RATE_LIMITS_DISABLED=true turns both off (testing only).
    { name: 'api', ttl: 15 * 60_000, limit: 300, skipIf: () => cfg.rateLimitsDisabled },
    { name: 'strict', ttl: cfg.leadsRateLimit.windowMs, limit: cfg.leadsRateLimit.max, skipIf: (ctx) => cfg.rateLimitsDisabled || !isStrict(ctx) },
  ],
});

// The stock guard, keyed by the real client IP, with our error body.
@Injectable()
export class ApiThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, any>): Promise<string> {
    return normalizeIp(clientIp(req as Request), this.ipv6SubnetPrefix);
  }

  protected override async throwThrottlingException(context: ExecutionContext): Promise<void> {
    throw new ApiError(429, {
      error: 'rate_limited',
      message: isStrict(context)
        ? 'You have sent several messages in a short time. Please wait a little and try again, or email us directly.'
        : 'Too many requests. Please wait a few minutes and try again.',
    });
  }
}
