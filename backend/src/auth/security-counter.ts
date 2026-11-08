// Fixed-window counters in the security_counters table, shared by every API instance and kept
// across restarts. One atomic upsert per hit, so concurrent requests can't lose counts.
import type { PrismaClient } from '@prisma/client';

export interface CounterHit {
  /** Hits in the current window, including this one. */
  count: number;
  /** When this hit opened a new window: how many hits beyond the first the previous window had. */
  prevSuppressed: number;
}

export async function hitCounter(prisma: PrismaClient, key: string, windowMs: number): Promise<CounterHit> {
  const windowSeconds = windowMs / 1000;
  // In an UPDATE, every expression sees the old row, so the CASEs all test the same window.
  const rows = await prisma.$queryRaw<{ count: number; prev_suppressed: number }[]>`
    INSERT INTO security_counters (key, window_start, count, prev_suppressed)
    VALUES (${key}, now(), 1, 0)
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN security_counters.window_start <= now() - ${windowSeconds}::float8 * interval '1 second'
                   THEN 1 ELSE security_counters.count + 1 END,
      prev_suppressed = CASE WHEN security_counters.window_start <= now() - ${windowSeconds}::float8 * interval '1 second'
                   THEN GREATEST(security_counters.count - 1, 0) ELSE security_counters.prev_suppressed END,
      window_start = CASE WHEN security_counters.window_start <= now() - ${windowSeconds}::float8 * interval '1 second'
                   THEN now() ELSE security_counters.window_start END
    RETURNING count, prev_suppressed`;
  const row = rows[0];
  const count = Number(row?.count ?? 1);
  return { count, prevSuppressed: count === 1 ? Number(row?.prev_suppressed ?? 0) : 0 };
}
