import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { MemoryCache } from '../realtime/memory-cache';
import { generateSlots, publicAvailability } from './availability';

// Slots are cached briefly (every visitor on the lead page asks for them); any booking change
// clears the cache (realtime/admin-events.ts), so a just-booked time never shows as free.
const SLOTS_TTL_MS = 15_000;

@Injectable()
export class BookingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: MemoryCache,
  ) {}

  /** Every call time in the booking window, plus the ones already booked (shown disabled). */
  listSlots() {
    return this.cache.getOrSet('slots', 'all', SLOTS_TTL_MS, async () => {
      const all = generateSlots();
      const taken = all.length
        ? await this.prisma.booking.findMany({
            where: { startsAt: { gte: all[0], lte: all[all.length - 1] } },
            select: { startsAt: true },
          })
        : [];
      return {
        availability: publicAvailability(),
        slots: all.map((s) => s.toISOString()),
        taken: taken.map((b) => b.startsAt.toISOString()),
      };
    });
  }
}
