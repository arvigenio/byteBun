// One place where every lead/booking change is announced: it clears the cached results that
// changed, then tells signed-in admins (toast + list/calendar refresh in the admin site).
// Call it after the database change is committed.
import { Injectable } from '@nestjs/common';
import { AdminRealtimeGateway } from './admin-realtime.gateway';
import { MemoryCache } from './memory-cache';

export interface LeadSummary {
  id: number;
  firstName: string;
  lastName: string;
  businessName: string | null;
}

export type BookingChangeKind = 'booked' | 'rescheduled' | 'cancelled';

export interface BookingChange {
  kind: BookingChangeKind;
  by: 'lead' | 'admin';
  /** The admin who made the change (by: 'admin'), so the admin site can say who it was. */
  actor: { name: string; email: string } | null;
  lead: LeadSummary;
  bookingId: number | null;
  startsAt: string | null;
  previousStartsAt: string | null;
}

@Injectable()
export class AdminEvents {
  constructor(
    private readonly cache: MemoryCache,
    private readonly realtime: AdminRealtimeGateway,
  ) {}

  leadCreated(lead: LeadSummary, startsAt: Date | null) {
    this.cache.invalidate('leads', 'bookings', 'slots');
    this.realtime.emit('lead.created', { lead, startsAt: startsAt?.toISOString() ?? null });
  }

  leadUpdated(lead: LeadSummary) {
    this.cache.invalidate('leads', 'bookings'); // booking lists show lead names
    this.realtime.emit('lead.updated', { lead });
  }

  /** Prospecting: a website checkup finished, so that business's score may have changed. */
  prospectsUpdated(payload: { searchId: string; item: unknown }) {
    this.realtime.emit('prospects.updated', payload);
  }

  bookingChanged(change: BookingChange) {
    this.cache.invalidate('bookings', 'slots', 'leads'); // the leads list shows call times
    this.realtime.emit('booking.changed', change);
  }
}
