import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { generateSlots, publicAvailability } from './availability';

@Injectable()
export class BookingService {
  constructor(private readonly prisma: PrismaService) {}

  /** Every call time in the booking window, plus the ones already booked (shown disabled). */
  async listSlots() {
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
  }
}
