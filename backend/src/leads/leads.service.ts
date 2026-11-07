import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { isBookableSlot } from '../booking/availability';
import { ApiError } from '../common/api-error';
import { PrismaService } from '../database/prisma.service';
import { LeadWebhookService } from '../integrations/lead-webhook.service';
import { logger } from '../logging/logger';
import { OTHER_BUSINESS_TYPE, type LeadInput } from './lead.schema';
import { featureLabel, goalLabel, OTHER_GOAL } from './lead-options';

const slotTakenMessage = 'Sorry, that time was just booked. Please choose another time.';

// No person gets through a multi-step form this fast; a script filling the real page does.
const MIN_FILL_MS = 3_000;

// Namespace for pg_advisory_xact_lock(key1, key2), so these locks can't collide with others.
const LEAD_EMAIL_LOCK = 7301;

function formatCallTime(startsAt: Date, timeZone: string | null): string {
  const tz = timeZone || 'UTC';
  const when = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(startsAt);
  return `${when} (${tz})`;
}

// What is saved and sent to the webhook (everything except internal columns).
const leadSelect = {
  id: true,
  createdAt: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  businessName: true,
  businessType: true,
  goals: true,
  goalsOther: true,
  features: true,
  message: true,
  source: true,
  status: true,
  booking: { select: { startsAt: true, timeZone: true } },
} satisfies Prisma.LeadSelect;

type LeadRow = Prisma.LeadGetPayload<{ select: typeof leadSelect }>;

/** A saved lead as the webhook sends it: goals and features as readable labels. */
export type SavedLead = Omit<LeadRow, 'goals' | 'goalsOther' | 'features'> & { goals: string[]; features: string[] };

const parseKeys = (json: string | null): string[] => {
  try {
    const value: unknown = JSON.parse(json ?? '[]');
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
};

function toSavedLead({ goals, goalsOther, features, ...lead }: LeadRow): SavedLead {
  return {
    ...lead,
    goals: parseKeys(goals).map((key) => (key === OTHER_GOAL && goalsOther ? `Other: ${goalsOther}` : goalLabel(key))),
    features: parseKeys(features).map(featureLabel),
  };
}

@Injectable()
export class LeadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly webhook: LeadWebhookService,
  ) {}

  /** Saves a lead and its booked call. Returns the new lead id (none for honeypot hits). */
  // `ip` is only logged (to spot abuse), never saved.
  async create(input: LeadInput, { ip }: { ip?: string } = {}): Promise<{ id?: number }> {
    const { website, fillMs, ...data } = input;
    // Looks like a bot. Pretend it worked so it doesn't retry, but save nothing.
    if (website) {
      logger.warn({ ip }, 'Lead rejected by honeypot');
      return {};
    }
    if (fillMs != null && fillMs < MIN_FILL_MS) {
      logger.warn({ ip, fillMs }, 'Lead rejected: form filled too fast');
      return {};
    }

    if (!isBookableSlot(data.meetingAt)) {
      throw new ApiError(400, {
        error: 'validation_failed',
        message: 'Please choose another time.',
        fields: { meetingAt: 'That time is not available. Please choose another time.' },
      });
    }

    try {
      const lead = await this.prisma.$transaction(async (tx) => {
        // One upcoming call per email. The lock (held until the transaction ends) makes two
        // submissions with the same email take turns, so both can't pass the check at once.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LEAD_EMAIL_LOCK}::int, hashtext(${data.email}))`;
        const upcoming = await tx.booking.findFirst({
          where: { lead: { email: data.email }, startsAt: { gt: new Date() } },
          select: { startsAt: true, timeZone: true },
        });
        if (upcoming) {
          const message = `You already have a call booked for ${formatCallTime(upcoming.startsAt, upcoming.timeZone)}. To change it, email us.`;
          throw new ApiError(409, { error: 'already_booked', message, fields: { email: message } });
        }

        return tx.lead.create({
          data: {
            firstName: data.firstName,
            lastName: data.lastName,
            email: data.email,
            phone: data.phone ?? null,
            businessName: data.businessName ?? null,
            businessType: data.businessType === OTHER_BUSINESS_TYPE ? `Other: ${data.businessTypeOther}` : data.businessType,
            goals: JSON.stringify([...new Set(data.goals)]),
            goalsOther: data.goals.includes(OTHER_GOAL) ? (data.goalsOther ?? null) : null,
            features: JSON.stringify([...new Set(data.features)]),
            message: data.message ?? null,
            source: data.source || 'website',
            booking: { create: { startsAt: data.meetingAt, timeZone: data.timeZone ?? null } },
          },
          select: leadSelect,
        });
      });

      logger.info({ leadId: lead.id, ip }, 'Lead saved');
      this.webhook.notifyLeadCreated(toSavedLead(lead)); // fire and forget; never affects the response
      return { id: lead.id };
    } catch (err) {
      // Unique index on bookings.starts_at: someone else booked this slot a moment earlier.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ApiError(409, { error: 'slot_taken', message: slotTakenMessage, fields: { meetingAt: slotTakenMessage } });
      }
      throw err;
    }
  }
}
