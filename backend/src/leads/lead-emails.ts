// Emails about a booked call.
//  To the lead (customer template): confirmation, reminder, rescheduled, cancelled. Each has
//    "add to calendar" buttons (or an .ics that updates/removes the event) and their private
//    reschedule/cancel link.
//  To the admins (ALERT_EMAILS, admin template): new lead, and every reschedule/cancel (except to
//    the admin who made it).
// Subjects are plain sentences that always name the client, e.g.
//   "Maria, your free consultation is confirmed for Wed, Nov 18 at 7:30 PM"
//   "Josue Mapagdalita moved Maria Santos's call to Wed, Nov 18 at 7:30 PM (PH time)"
// Every send runs in the background: a slow or failing mail server never affects the visitor.
import { Inject, Injectable, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
import { MAILER } from '../auth/auth.module';
import { renderEmail } from '../auth/email-template';
import type { Mail, Mailer } from '../auth/mailer';
import { availability } from '../booking/availability';
import { ManageLinks } from '../booking/manage-link';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { PrismaService } from '../database/prisma.service';
import { logger } from '../logging/logger';
import { callEvent, calendarLinks, callTimeParts, icsFile } from './call-calendar';
import { featureLabel, goalLabel, OTHER_GOAL } from './lead-options';

const REMINDER_CHECK_MS = 60_000;

/** When the reminder goes out: 24 h before the call, or 2 h before when booked less than 30 h ahead. */
export function reminderAtFor(startsAt: Date, now = new Date()): Date {
  const hoursAhead = (startsAt.getTime() - now.getTime()) / 3_600_000;
  return new Date(startsAt.getTime() - (hoursAhead >= 30 ? 24 : 2) * 3_600_000);
}

export interface LeadForEmail {
  id: number;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  businessName: string | null;
  businessType: string;
  goals: string | null;
  goalsOther: string | null;
  features: string | null;
  message: string | null;
  source: string;
  createdAt: Date;
  manageNonce: string | null;
}

export interface BookingForEmail {
  id: number;
  startsAt: Date;
  timeZone: string | null;
  sequence: number;
}

const WHAT_WE_COVER = {
  title: "What we'll cover",
  items: [
    { title: 'Your website and first impression', text: 'Speed, mobile, and whether visitors can book with you in a few taps.' },
    { title: 'Response time and follow-up', text: 'How fast new enquiries and missed calls get an answer, and where leads slip through.' },
    { title: 'A clear plan for you', text: 'A written proposal with fixed pricing within 24 hours of the call. No obligation.' },
  ],
};

const parseKeys = (json: string | null): string[] => {
  try {
    const v: unknown = JSON.parse(json ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
};

// ---------------------------------------------------------------------------------------------
// Email content (pure functions, so they can be previewed and tested)
// ---------------------------------------------------------------------------------------------

interface LeadMailContext {
  lead: LeadForEmail;
  booking: BookingForEmail;
  manageUrl: string;
  meetingUrl: string;
  from: string;
  replyTo?: string;
}

function leadMailBase({ lead, booking, manageUrl, meetingUrl }: LeadMailContext) {
  const t = callTimeParts(booking.startsAt, booking.timeZone);
  const ev = callEvent({ bookingId: booking.id, startsAt: booking.startsAt, sequence: booking.sequence, meetingUrl, manageUrl });
  const links = calendarLinks(ev);
  const event = { month: t.month, day: t.day, weekday: t.weekday, label: 'Your free consultation', time: t.range, sub: `${t.timeZone} · ${availability.slotMinutes}-minute video call` };
  const join = meetingUrl ? [{ title: 'Video call', buttons: [{ label: 'Join the video call', href: meetingUrl, primary: true }], note: 'The link opens your call at the time above.' }] : [];
  const calendar = {
    title: 'Add it to your calendar',
    buttons: [
      { label: 'Google Calendar', href: links.google },
      { label: 'Outlook.com', href: links.outlook },
      { label: 'Office 365', href: links.office365 },
      { label: 'Yahoo Calendar', href: links.yahoo },
    ],
    note: 'Apple Calendar or another app? Open the invite.ics file attached to this email.',
  };
  const manage = {
    title: 'Need a different time?',
    buttons: [
      { label: 'Reschedule', href: manageUrl },
      { label: 'Cancel the call', href: manageUrl },
    ],
    note: 'These buttons are private to you. Please do not forward this email.',
  };
  return { t, ev, event, join, calendar, manage };
}

const fullName = (lead: { firstName: string; lastName: string }) => `${lead.firstName} ${lead.lastName}`.trim();

const leadMail = (ctx: LeadMailContext, subject: string, rendered: { html: string; text: string }, ics: string): Mail => ({
  to: ctx.lead.email,
  names: { [ctx.lead.email]: fullName(ctx.lead) },
  from: ctx.from,
  replyTo: ctx.replyTo,
  subject,
  ...rendered,
  attachments: [{ filename: 'invite.ics', content: ics, contentType: 'text/calendar; charset=utf-8; method=PUBLISH' }],
});

const LEAD_FOOTER = 'You are receiving this because you booked a free call at bytebuntech.com. Byte Bun Tech · Web and automation studio.';

export function confirmationMail(ctx: LeadMailContext): Mail {
  const { t, ev, event, join, calendar, manage } = leadMailBase(ctx);
  const business = ctx.lead.businessName ? ctx.lead.businessName : 'your business';
  const rendered = renderEmail({
    audience: 'customer',
    preheader: `${t.long}. Add it to your calendar, or reschedule in one click.`,
    hero: { badge: '✓', title: `You're booked, ${ctx.lead.firstName}!`, subtitle: `Your free ${availability.slotMinutes}-minute consultation is confirmed.` },
    label: 'Booking confirmed',
    tone: 'success',
    title: `See you on ${t.weekday}`,
    intro: [`Thanks for telling us about ${business}. Here are the details of your call. Times are shown in your time zone (${t.timeZone}).`],
    event,
    actions: [...join, calendar, manage],
    steps: WHAT_WE_COVER,
    outro: ['Questions before the call? Just reply to this email and a real person will answer.'],
    footer: LEAD_FOOTER,
  });
  return leadMail(ctx, `${ctx.lead.firstName}, your free consultation is confirmed for ${t.shortDate} at ${t.start}`, rendered, icsFile(ev));
}

export function reminderMail(ctx: LeadMailContext, now = new Date()): Mail {
  const { t, ev, event, join, calendar, manage } = leadMailBase(ctx);
  const today = callTimeParts(now, ctx.booking.timeZone).ymd;
  const tomorrow = callTimeParts(new Date(now.getTime() + 86_400_000), ctx.booking.timeZone).ymd;
  const when = t.ymd === today ? 'today' : t.ymd === tomorrow ? 'tomorrow' : `on ${t.shortDate}`;
  const rendered = renderEmail({
    audience: 'customer',
    preheader: `Your free consultation is ${when} at ${t.start}. Can't make it? Reschedule in one click.`,
    hero: { badge: '⏰', title: `Your call is ${when}`, subtitle: t.range },
    label: 'Reminder',
    tone: 'info',
    title: `Hi ${ctx.lead.firstName}, see you soon`,
    intro: ["A quick reminder about your free consultation with Byte Bun Tech. It takes 30 minutes and there's nothing to prepare: just bring your questions."],
    event,
    actions: [...join, manage, calendar],
    steps: WHAT_WE_COVER,
    outro: ["Running late or something came up? Use the Reschedule button above, or reply to this email."],
    footer: LEAD_FOOTER,
  });
  return leadMail(ctx, `Reminder for ${ctx.lead.firstName}: your free consultation is ${when} at ${t.start}`, rendered, icsFile(ev));
}

/** Who changed the booking: the lead (their link) or our team (admin site), with an optional note to the lead. */
export interface ChangeSource {
  by: 'lead' | 'admin';
  /** The admin who made the change (by: 'admin'). They are not emailed about their own change. */
  actor?: { name: string; email: string };
  note?: string | null;
}

/** Admins to email about a booking change: all of them, minus the admin who made it. */
export const adminRecipients = (all: string[], src: ChangeSource) => all.filter((e) => !(src.by === 'admin' && src.actor && e.toLowerCase() === src.actor.email.toLowerCase()));

const teamNote = (src: ChangeSource) =>
  src.by === 'admin' && src.note?.trim() ? { tone: 'info' as const, title: 'A note from our team', text: src.note.trim() } : undefined;

export function rescheduledMail(ctx: LeadMailContext, previous: { startsAt: Date; timeZone: string | null }, src: ChangeSource = { by: 'lead' }): Mail {
  const { t, ev, event, join, calendar, manage } = leadMailBase(ctx);
  const old = callTimeParts(previous.startsAt, previous.timeZone ?? ctx.booking.timeZone);
  const byTeam = src.by === 'admin';
  const rendered = renderEmail({
    audience: 'customer',
    preheader: `New time: ${t.long}. Your calendar invite is updated.`,
    hero: byTeam
      ? { badge: '↻', title: 'Your call has a new time', subtitle: 'We had to move your call. Sorry for the change.' }
      : { badge: '✓', title: "You're all set", subtitle: 'Your call has been moved to a new time.' },
    label: 'Call rescheduled',
    tone: 'success',
    title: `New time: ${t.weekday}, ${t.month} ${t.day}`,
    intro: byTeam
      ? [
          `Hi ${ctx.lead.firstName}, something came up on our side, so we have moved your free consultation to the time below. We are sorry for the inconvenience.`,
          `Your previous time (${old.long}) is cancelled. If the new time does not work for you, pick another one in a click with the Reschedule button.`,
        ]
      : [`Hi ${ctx.lead.firstName}, your free consultation has been moved. The old time (${old.long}) is cancelled.`],
    event,
    callout: teamNote(src),
    actions: [...join, { ...calendar, note: 'Already added the old time? The attached invite.ics updates it. Or add the new time with a button above.' }, manage],
    outro: byTeam ? ['Questions? Just reply to this email and we will get back to you quickly.'] : ['If you did not make this change, reply to this email and we will sort it out.'],
    footer: LEAD_FOOTER,
  });
  return leadMail(
    ctx,
    byTeam ? `${ctx.lead.firstName}, we've moved your call to ${t.shortDate} at ${t.start}` : `${ctx.lead.firstName}, your call is now on ${t.shortDate} at ${t.start}`,
    rendered,
    icsFile(ev),
  );
}

export function cancelledMail(ctx: LeadMailContext, src: ChangeSource = { by: 'lead' }): Mail {
  const { t, ev, event } = leadMailBase(ctx);
  const byTeam = src.by === 'admin';
  const rendered = renderEmail({
    audience: 'customer',
    preheader: byTeam ? 'We had to cancel your call. Pick a new time that suits you, in one click.' : 'Your call is cancelled. You can pick a new time whenever you are ready.',
    hero: byTeam
      ? { badge: '!', title: 'We had to cancel your call', subtitle: 'We are sorry. Please pick a new time that suits you.', tone: 'muted' }
      : { badge: '×', title: 'Your call is cancelled', subtitle: 'No problem. You can book a new time whenever you are ready.', tone: 'muted' },
    label: 'Call cancelled',
    tone: 'warning',
    title: byTeam ? `Sorry, ${ctx.lead.firstName}` : `Sorry we'll miss you, ${ctx.lead.firstName}`,
    intro: byTeam
      ? [
          `Unfortunately we had to cancel your free consultation on ${t.long}. We apologise for the inconvenience.`,
          'We would still love to talk. Pick a new time with the button below and it is booked straight away.',
        ]
      : [`Your free consultation on ${t.long} is cancelled.`],
    event: { ...event, label: 'Cancelled', struck: true },
    callout: teamNote(src),
    actions: [{ title: byTeam ? 'Book a new time' : 'Changed your mind?', buttons: [{ label: 'Pick a new time', href: ctx.manageUrl, primary: true }] }],
    outro: byTeam
      ? ['Questions? Just reply to this email.', 'Opening the attached invite.ics removes the old time from your calendar.']
      : ['If you did not cancel this, reply to this email and we will sort it out.', 'Opening the attached invite.ics removes the call from your calendar.'],
    footer: LEAD_FOOTER,
  });
  return {
    to: ctx.lead.email,
    names: { [ctx.lead.email]: fullName(ctx.lead) },
    from: ctx.from,
    replyTo: ctx.replyTo,
    subject: byTeam ? `${ctx.lead.firstName}, we're sorry: we had to cancel your call on ${t.shortDate}` : `${ctx.lead.firstName}, your call on ${t.shortDate} is cancelled`,
    ...rendered,
    attachments: [{ filename: 'invite.ics', content: icsFile(ev, 'CANCEL'), contentType: 'text/calendar; charset=utf-8; method=CANCEL' }],
  };
}

const PH = availability.timeZone;
const bothTimes = (startsAt: Date, timeZone: string | null) => {
  const ph = callTimeParts(startsAt, PH).long;
  const theirs = timeZone && timeZone !== PH ? callTimeParts(startsAt, timeZone).long : '';
  return theirs ? `${ph}\n(theirs: ${theirs})` : ph;
};
const leadDetails = (lead: LeadForEmail): [string, string][] => {
  const goals = parseKeys(lead.goals).map((k) => (k === OTHER_GOAL && lead.goalsOther ? `Other: ${lead.goalsOther}` : goalLabel(k)));
  return [
    ['Name', `${lead.firstName} ${lead.lastName}`],
    ['Email', lead.email],
    ['Phone', lead.phone || '—'],
    ['Business', lead.businessName || '—'],
    ['Type', lead.businessType],
    ['Goals', goals.join(', ') || '—'],
    ['Features', parseKeys(lead.features).map(featureLabel).join(', ') || '—'],
    ['Message', lead.message || '—'],
    ['Source', lead.source],
  ];
};

export function adminNewLeadMail(to: string[], lead: LeadForEmail, booking: BookingForEmail | null): Mail {
  const name = `${lead.firstName} ${lead.lastName}`;
  const call = booking ? bothTimes(booking.startsAt, booking.timeZone) : 'No call booked';
  const rendered = renderEmail({
    preheader: `${name}${lead.businessName ? ` (${lead.businessName})` : ''} booked a call: ${booking ? callTimeParts(booking.startsAt, PH).long : 'no call'}`,
    label: 'New lead',
    tone: 'success',
    title: `${name} booked a free call`,
    intro: ['A new lead just filled in the form on the website. Open the admin site to see it, change its status or edit it.'],
    details: [['Call', call], ...leadDetails(lead), ['Received', callTimeParts(lead.createdAt, PH).long]],
    footer: 'Sent to both Byte Bun admins for every new lead.',
  });
  const from = lead.businessName ? ` from ${lead.businessName}` : '';
  const ph = booking ? callTimeParts(booking.startsAt, PH) : null;
  return { to, subject: `New lead: ${name}${from}${ph ? ` booked a call for ${ph.shortDate} at ${ph.start} (PH time)` : ''}`, ...rendered };
}

export function adminBookingChangedMail(
  to: string[],
  kind: 'rescheduled' | 'cancelled',
  lead: LeadForEmail,
  booking: BookingForEmail,
  previous?: { startsAt: Date; timeZone: string | null },
  src: ChangeSource = { by: 'lead' },
): Mail {
  const name = `${lead.firstName} ${lead.lastName}`;
  const byAdmin = src.by === 'admin';
  const who = byAdmin ? (src.actor?.name ?? 'An admin') : name;
  const details: [string, string][] =
    kind === 'rescheduled'
      ? [
          ['New time', bothTimes(booking.startsAt, booking.timeZone)],
          ['Old time', previous ? bothTimes(previous.startsAt, previous.timeZone) : 'None (their earlier call had been cancelled)'],
        ]
      : [['Was', bothTimes(booking.startsAt, booking.timeZone)]];
  details.push(['Changed by', byAdmin ? `${who} (admin site)` : `${name} (their private link)`]);
  if (byAdmin && src.note?.trim()) details.push(['Note to lead', src.note.trim()]);
  const rendered = renderEmail({
    preheader: byAdmin ? `${who} ${kind} the call with ${name}.` : `${name} ${kind} their call.`,
    label: kind === 'rescheduled' ? 'Call rescheduled' : 'Call cancelled',
    tone: kind === 'rescheduled' ? 'info' : 'warning',
    title: byAdmin
      ? kind === 'rescheduled'
        ? `${who} moved the call with ${name}`
        : `${who} cancelled the call with ${name}`
      : kind === 'rescheduled'
        ? `${name} moved their call`
        : `${name} cancelled their call`,
    intro: [
      byAdmin
        ? kind === 'rescheduled'
          ? 'The call was moved from the admin site. The lead has been emailed the new time and an updated calendar invite. The old slot is free again.'
          : 'The call was cancelled from the admin site. The lead has been emailed, with a link to book a new time. The slot is free again.'
        : kind === 'rescheduled'
          ? 'The lead picked a new time using the private link in their booking email. Their old slot is free again.'
          : 'The lead cancelled using the private link in their booking email. The slot is free again, and the lead stays in the admin site.',
    ],
    details: [...details, ...leadDetails(lead).slice(1, 5)],
    footer: byAdmin ? 'Sent to the other Byte Bun admins when an admin changes a booking.' : 'Sent to both Byte Bun admins when a lead changes their booking.',
  });
  const when = callTimeParts(booking.startsAt, PH);
  const at = `${when.shortDate} at ${when.start} (PH time)`;
  const subject =
    kind === 'cancelled'
      ? byAdmin
        ? `${who} cancelled ${name}'s call on ${at}`
        : `${name} cancelled their call on ${at}`
      : !previous
        ? byAdmin
          ? `${who} booked a new call for ${name} on ${at}`
          : `${name} booked a new call for ${at}`
        : byAdmin
          ? `${who} moved ${name}'s call to ${at}`
          : `${name} moved their call to ${at}`;
  return {
    to,
    subject,
    ...rendered,
  };
}

// ---------------------------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------------------------

const leadSelect = {
  id: true,
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
  createdAt: true,
  manageNonce: true,
} as const;

@Injectable()
export class LeadEmailsService implements OnApplicationBootstrap, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    @Inject(MAILER) private readonly mailer: Mailer,
    private readonly links: ManageLinks,
  ) {}

  onApplicationBootstrap() {
    // Tests call runDueReminders() themselves.
    if (this.cfg.nodeEnv === 'test') return;
    this.timer = setInterval(() => {
      this.runDueReminders().catch((err: unknown) => logger.error({ reason: String(err) }, 'Reminder run failed'));
    }, REMINDER_CHECK_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** The lead's private reschedule/cancel link (creates its secret on first use). */
  async manageUrl(lead: Pick<LeadForEmail, 'id' | 'manageNonce'>): Promise<string> {
    let nonce = lead.manageNonce;
    if (!nonce) {
      nonce = this.links.newNonce();
      await this.prisma.lead.update({ where: { id: lead.id }, data: { manageNonce: nonce } });
      lead.manageNonce = nonce;
    }
    return this.links.url(lead.id, nonce);
  }

  private async ctx(lead: LeadForEmail, booking: BookingForEmail): Promise<LeadMailContext> {
    return {
      lead,
      booking,
      manageUrl: await this.manageUrl(lead),
      meetingUrl: this.cfg.booking.meetingUrl,
      from: this.cfg.mail.leadsFrom,
      replyTo: this.cfg.mail.leadsReplyTo || undefined,
    };
  }

  private background(what: string, task: () => Promise<unknown>) {
    task().catch((err: unknown) => logger.error({ what, reason: err instanceof Error ? err.message : String(err) }, 'Lead email failed'));
  }

  load(leadId: number) {
    return this.prisma.lead.findUnique({
      where: { id: leadId },
      select: { ...leadSelect, booking: { select: { id: true, startsAt: true, timeZone: true, sequence: true } } },
    });
  }

  /** A new lead: confirmation to them, notification to the admins. */
  newLead(leadId: number): void {
    this.background('new lead', async () => {
      const row = await this.load(leadId);
      if (!row) return;
      const { booking, ...lead } = row;
      const tasks: Promise<unknown>[] = [];
      if (booking) {
        tasks.push(
          (async () => {
            await this.mailer.send(confirmationMail(await this.ctx(lead, booking)));
            await this.prisma.booking.updateMany({ where: { id: booking.id }, data: { confirmationSentAt: new Date() } });
          })(),
        );
      }
      if (this.cfg.auth.alertEmails.length) tasks.push(this.mailer.send(adminNewLeadMail(this.cfg.auth.alertEmails, lead, booking)));
      const results = await Promise.allSettled(tasks);
      for (const r of results) if (r.status === 'rejected') logger.error({ leadId, reason: String(r.reason) }, 'New lead email failed');
    });
  }

  // Every change is emailed to the lead and to the admins, except the admin who made it (they see
  // it on screen; the other admins also see it live in the admin site).
  private toAdmins(src: ChangeSource, build: (to: string[]) => Mail) {
    const to = adminRecipients(this.cfg.auth.alertEmails, src);
    return to.length ? this.mailer.send(build(to)) : null;
  }

  /** A call was moved, by the lead (their link) or by an admin. The lead is always told. */
  rescheduled(leadId: number, previous: { startsAt: Date; timeZone: string | null }, src: ChangeSource): void {
    this.background('rescheduled', async () => {
      const row = await this.load(leadId);
      if (!row?.booking) return;
      const { booking, ...lead } = row;
      const results = await Promise.allSettled([
        this.mailer.send(rescheduledMail(await this.ctx(lead, booking), previous, src)),
        this.toAdmins(src, (to) => adminBookingChangedMail(to, 'rescheduled', lead, booking, previous, src)),
      ]);
      for (const r of results) if (r.status === 'rejected') logger.error({ leadId, reason: String(r.reason) }, 'Reschedule email failed');
    });
  }

  /** A cancelled call booked again (from the lead's link, or by an admin): a fresh confirmation. */
  rebooked(leadId: number, src: ChangeSource): void {
    this.background('rebooked', async () => {
      const row = await this.load(leadId);
      if (!row?.booking) return;
      const { booking, ...lead } = row;
      const results = await Promise.allSettled([
        this.mailer.send(confirmationMail(await this.ctx(lead, booking))),
        this.toAdmins(src, (to) => adminBookingChangedMail(to, 'rescheduled', lead, booking, undefined, src)),
      ]);
      for (const r of results) if (r.status === 'rejected') logger.error({ leadId, reason: String(r.reason) }, 'Rebook email failed');
    });
  }

  /** A call was cancelled, by the lead or by an admin. `booking` is the deleted booking. */
  cancelled(lead: LeadForEmail, booking: BookingForEmail, src: ChangeSource): void {
    this.background('cancelled', async () => {
      const results = await Promise.allSettled([
        this.mailer.send(cancelledMail(await this.ctx(lead, booking), src)),
        this.toAdmins(src, (to) => adminBookingChangedMail(to, 'cancelled', lead, booking, undefined, src)),
      ]);
      for (const r of results) if (r.status === 'rejected') logger.error({ leadId: lead.id, reason: String(r.reason) }, 'Cancel email failed');
    });
  }

  /**
   * Sends every reminder that is due. Each booking is claimed with an atomic UPDATE first, so two
   * API instances (or overlapping runs) can't both send it. A failed send is released for retry.
   */
  async runDueReminders(now = new Date()): Promise<number> {
    const claimed = await this.prisma.$queryRaw<{ id: number; lead_id: number }[]>`
      UPDATE bookings SET reminder_sent_at = now()
      WHERE id IN (
        SELECT id FROM bookings
        WHERE reminder_sent_at IS NULL AND reminder_at <= ${now} AND starts_at > ${now}
        ORDER BY starts_at LIMIT 25
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, lead_id`;
    let sent = 0;
    for (const { id, lead_id } of claimed) {
      try {
        const row = await this.load(lead_id);
        if (!row?.booking || row.booking.id !== id) continue;
        const { booking, ...lead } = row;
        await this.mailer.send(reminderMail(await this.ctx(lead, booking), now));
        sent++;
      } catch (err) {
        logger.error({ bookingId: id, reason: err instanceof Error ? err.message : String(err) }, 'Reminder email failed; will retry');
        await this.prisma.booking.updateMany({ where: { id }, data: { reminderSentAt: null } });
      }
    }
    return sent;
  }
}
