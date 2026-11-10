import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { availability, isBookableSlot } from '../booking/availability';
import { ApiError } from '../common/api-error';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { ADMIN_CHANNEL, channelOf, classifyAttribution } from './attribution';
import { PrismaService } from '../database/prisma.service';
import { LeadWebhookService } from '../integrations/lead-webhook.service';
import { logger } from '../logging/logger';
import { ManageLinks } from '../booking/manage-link';
import { AdminEvents } from '../realtime/admin-events';
import { type ChangeSource, LeadEmailsService, reminderAtFor } from './lead-emails';
import { type AdminBookingInput, OTHER_BUSINESS_TYPE, type LeadInput } from './lead.schema';
import { featureLabel, goalLabel, OTHER_GOAL } from './lead-options';

const slotTakenMessage = 'Sorry, that time was just booked. Please choose another time.';
const notAvailable = (field: string) =>
  new ApiError(400, { error: 'validation_failed', message: 'Please choose another time.', fields: { [field]: 'That time is not available. Please choose another time.' } });

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
  channel: true,
  origin: true,
  originDetail: true,
  utmSource: true,
  utmMedium: true,
  utmCampaign: true,
  status: true,
  booking: { select: { id: true, startsAt: true, timeZone: true } },
} satisfies Prisma.LeadSelect;

type LeadRow = Prisma.LeadGetPayload<{ select: typeof leadSelect }>;

/** A saved lead as the webhook sends it: goals and features as readable labels. */
export type SavedLead = Omit<LeadRow, 'goals' | 'goalsOther' | 'features' | 'booking'> & {
  goals: string[];
  features: string[];
  booking: { startsAt: Date; timeZone: string | null } | null;
};

const parseKeys = (json: string | null): string[] => {
  try {
    const value: unknown = JSON.parse(json ?? '[]');
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
};

function toSavedLead({ goals, goalsOther, features, booking, ...lead }: LeadRow): SavedLead {
  return {
    ...lead,
    // The webhook payload stays as it was: the call's time, not our row id.
    booking: booking ? { startsAt: booking.startsAt, timeZone: booking.timeZone } : null,
    goals: parseKeys(goals).map((key) => (key === OTHER_GOAL && goalsOther ? `Other: ${goalsOther}` : goalLabel(key))),
    features: parseKeys(features).map(featureLabel),
  };
}

@Injectable()
export class LeadsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly webhook: LeadWebhookService,
    private readonly emails: LeadEmailsService,
    private readonly links: ManageLinks,
    private readonly events: AdminEvents,
    @Inject(APP_CONFIG) cfg: AppConfig,
  ) {
    // A referrer from the site itself is a page change, not where the visitor came from.
    this.ownHosts = [cfg.booking.siteUrl, cfg.auth.url, ...cfg.frontendOrigins].flatMap((u) => {
      try {
        return [new URL(u).hostname];
      } catch {
        return [];
      }
    });
  }

  private readonly ownHosts: string[];

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

    if (!isBookableSlot(data.meetingAt)) throw notAvailable('meetingAt');

    // Where they came from. Leads from a page without this (an old tab) keep origin empty.
    const attribution = classifyAttribution(data.attribution, this.ownHosts) ?? {};

    const lead = await this.insert(
      {
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
        channel: channelOf(data.source),
        ...attribution,
      },
      { startsAt: data.meetingAt, timeZone: data.timeZone ?? null, field: 'meetingAt' },
      (upcoming) => `You already have a call booked for ${formatCallTime(upcoming.startsAt, upcoming.timeZone)}. To change it, email us.`,
    );

    logger.info({ leadId: lead.id, ip }, 'Lead saved');
    // All fire and forget; none of them affects the response.
    this.webhook.notifyLeadCreated(toSavedLead(lead));
    this.emails.newLead(lead.id); // confirmation to the lead, notification to both admins
    this.events.leadCreated(
      { id: lead.id, firstName: lead.firstName, lastName: lead.lastName, businessName: lead.businessName },
      lead.booking?.startsAt ?? null,
    ); // clears cached lists, live update + toast in the admin site
    return { id: lead.id };
  }

  /**
   * An admin books a call for someone (they phoned, messaged, or met the team): a new lead with
   * its call, under the same rules as the lead page (an open slot, one upcoming call per email).
   * The person gets the usual confirmation and reminder; the other admins are emailed and told live.
   */
  async bookByAdmin(input: AdminBookingInput, actor: { name: string; email: string }) {
    if (!isBookableSlot(input.startsAt)) throw notAvailable('startsAt');
    const src: ChangeSource = { by: 'admin', actor };

    const lead = await this.insert(
      {
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email,
        phone: input.phone ?? null,
        businessName: input.businessName ?? null,
        businessType: input.businessType ?? '',
        goals: JSON.stringify([...new Set(input.goals)]),
        goalsOther: input.goals.includes(OTHER_GOAL) ? (input.goalsOther ?? null) : null,
        features: JSON.stringify([...new Set(input.features)]),
        message: input.message ?? null,
        source: ADMIN_CHANNEL,
        channel: ADMIN_CHANNEL,
        origin: input.origin ?? null,
      },
      { startsAt: input.startsAt, timeZone: input.timeZone ?? null, field: 'startsAt' },
      (upcoming) =>
        `${input.email} already has a call booked for ${formatCallTime(upcoming.startsAt, availability.timeZone)}. Move that call from the Bookings page instead.`,
    );
    const booking = lead.booking!;

    logger.info({ leadId: lead.id, bookingId: booking.id, by: actor.email }, 'Call booked by an admin');
    this.webhook.notifyLeadCreated(toSavedLead(lead));
    this.emails.newLead(lead.id, src); // confirmation to the lead, notification to the OTHER admins
    this.events.bookingChanged({
      kind: 'booked',
      by: 'admin',
      actor,
      lead: { id: lead.id, firstName: lead.firstName, lastName: lead.lastName, businessName: lead.businessName },
      bookingId: booking.id,
      startsAt: booking.startsAt.toISOString(),
      previousStartsAt: null,
    }); // clears cached lists and slots; the other admins see a toast
    return {
      lead: { id: lead.id, firstName: lead.firstName, lastName: lead.lastName, businessName: lead.businessName },
      booking: { id: booking.id, startsAt: booking.startsAt, timeZone: booking.timeZone },
    };
  }

  /**
   * Saves a lead and its call in one transaction, allowing one upcoming call per email.
   * `alreadyBooked` words the 409 when that email already has one; a slot someone else took a
   * moment earlier is a 409 too. Both are reported on `call.field`.
   */
  private async insert(
    fields: Omit<Prisma.LeadCreateInput, 'booking' | 'manageNonce'>,
    call: { startsAt: Date; timeZone: string | null; field: string },
    alreadyBooked: (upcoming: { startsAt: Date; timeZone: string | null }) => string,
  ) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        // The lock (held until the transaction ends) makes two bookings with the same email take
        // turns, so both can't pass the check at once.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(${LEAD_EMAIL_LOCK}::int, hashtext(${fields.email}))`;
        const upcoming = await tx.booking.findFirst({
          where: { lead: { email: fields.email }, startsAt: { gt: new Date() } },
          select: { startsAt: true, timeZone: true },
        });
        if (upcoming) {
          const message = alreadyBooked(upcoming);
          throw new ApiError(409, { error: 'already_booked', message, fields: { email: message } });
        }
        return tx.lead.create({
          data: {
            ...fields,
            // Secret behind the lead's reschedule/cancel link (booking/manage-link.ts).
            manageNonce: this.links.newNonce(),
            booking: { create: { startsAt: call.startsAt, timeZone: call.timeZone, reminderAt: reminderAtFor(call.startsAt) } },
          },
          select: leadSelect,
        });
      });
    } catch (err) {
      // Unique index on bookings.starts_at: someone else booked this slot a moment earlier.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ApiError(409, { error: 'slot_taken', message: slotTakenMessage, fields: { [call.field]: slotTakenMessage } });
      }
      throw err;
    }
  }
}
