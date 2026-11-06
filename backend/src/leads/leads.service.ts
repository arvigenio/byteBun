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
  async create(input: LeadInput): Promise<{ id?: number }> {
    const { website, ...data } = input;
    if (website) {
      // Looks like a bot. Pretend it worked so it doesn't retry, but save nothing.
      logger.warn('Lead rejected by honeypot');
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
      const lead = await this.prisma.lead.create({
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

      logger.info({ leadId: lead.id }, 'Lead saved');
      this.webhook.notifyLeadCreated(toSavedLead(lead)); // fire and forget; never affects the response
      return { id: lead.id };
    } catch (err) {
      // Unique index on Bookings.StartsAt: someone else booked this slot a moment earlier.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ApiError(409, { error: 'slot_taken', message: slotTakenMessage, fields: { meetingAt: slotTakenMessage } });
      }
      throw err;
    }
  }
}
