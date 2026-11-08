// Security alerts about admin sign-in activity, emailed to ALERT_EMAILS (and optionally POSTed
// to SECURITY_ALERT_WEBHOOK_URL). Subjects start with "[Byte Bun Security]" so they're easy to filter.
//
// Throttled: at most one email per event type per account email per 10 minutes. The next alert
// after a quiet window says how many similar events were suppressed in the window before, so an
// attack shows up as a count rather than a flood.
//
// Everything runs in the background: an alert can never slow down or break a sign-in.
import type { PrismaClient } from '@prisma/client';
import type { AppConfig } from '../config/config';
import { logger } from '../logging/logger';
import { adminName } from './admins';
import { renderEmail, type Tone } from './email-template';
import type { Mailer } from './mailer';
import type { RequestMeta } from './request-meta';
import { hitCounter } from './security-counter';

export const ALERT_WINDOW_MS = 10 * 60_000;

const EVENTS = {
  code_requested: 'Sign-in code requested',
  unknown_email: 'Sign-in attempt with an email that is not an admin',
  wrong_email_code: 'Wrong email sign-in code',
  email_code_locked: 'Too many wrong email codes',
  email_code_ok: 'Email code correct, waiting for the authenticator',
  wrong_authenticator_code: 'Wrong authenticator code',
  wrong_backup_code: 'Wrong backup code',
  second_step_locked: 'Too many wrong authenticator or backup codes',
  signed_in: 'Successful sign-in',
  backup_code_used: 'Backup code used',
  authenticator_enrolled: 'New authenticator set up',
  authenticator_reset: 'Authenticator reset',
  backup_codes_regenerated: 'Backup codes regenerated',
} as const;

export type AlertEvent = keyof typeof EVENTS;

// Extra lines for some events.
const ADVICE: Partial<Record<AlertEvent, string>> = {
  email_code_ok:
    "This person has access to the inbox; if this wasn't you, secure your email now (change its password and sign out its other sessions). They still need the authenticator app to get in.",
  unknown_email: 'No code was sent and no account was created. Someone may be guessing addresses.',
  wrong_email_code: 'If this wasn\'t you, someone is guessing codes. Each code allows 3 tries.',
  email_code_locked: 'The code was invalidated after 3 wrong tries. A new code is needed.',
  wrong_authenticator_code: 'This person already passed the email code step. If this wasn\'t you, secure your email now.',
  wrong_backup_code: 'This person already passed the email code step. If this wasn\'t you, secure your email now.',
  second_step_locked: 'The second step is locked for now. If this wasn\'t you, secure your email now.',
  backup_code_used: 'That backup code no longer works. If this wasn\'t you, reset this admin\'s authenticator (see the README) and secure the email account.',
  authenticator_enrolled: 'If this wasn\'t you, reset this admin\'s authenticator right away (see the README) and secure the email account.',
  signed_in: 'If this wasn\'t you, sign that session out from the Security page and reset the authenticator.',
};

// Email color per event: danger = someone may be past the email step; warning = suspicious;
// success / info = expected activity worth knowing about.
const TONES: Record<AlertEvent, Tone> = {
  code_requested: 'info',
  unknown_email: 'warning',
  wrong_email_code: 'warning',
  email_code_locked: 'warning',
  email_code_ok: 'danger',
  wrong_authenticator_code: 'danger',
  wrong_backup_code: 'danger',
  second_step_locked: 'danger',
  signed_in: 'success',
  backup_code_used: 'danger',
  authenticator_enrolled: 'danger',
  authenticator_reset: 'danger',
  backup_codes_regenerated: 'warning',
};

export interface AlertDetails extends Partial<RequestMeta> {
  /** The account email the event is about (the address typed, for unknown emails). */
  email: string;
  note?: string;
}

const TIME_ZONE = 'Asia/Manila';

export class SecurityAlerts {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly cfg: AppConfig,
    private readonly mailer: Mailer,
  ) {}

  /** Fire and forget. */
  notify(event: AlertEvent, details: AlertDetails): void {
    this.deliver(event, details).catch((err: unknown) =>
      logger.error({ event, reason: err instanceof Error ? err.message : String(err) }, 'Security alert failed'),
    );
  }

  /** Same as notify(), but the caller can wait for it (the CLI, which exits right after). */
  async deliver(event: AlertEvent, details: AlertDetails): Promise<void> {
    const email = (details.email || 'unknown').toLowerCase().slice(0, 254);
    logger.warn({ securityEvent: event, ip: details.ip }, `Security event: ${EVENTS[event]}`);

    const hit = await hitCounter(this.prisma, `alert:${event}:${email}`, ALERT_WINDOW_MS);
    if (hit.count > 1) return; // already alerted in this window; counted for the next alert

    const time = new Date();
    const title = EVENTS[event];
    const payload = {
      event,
      title,
      email,
      ip: details.ip ?? 'unknown',
      location: details.location ?? 'unknown',
      userAgent: details.userAgent ?? 'unknown',
      time: time.toISOString(),
      suppressedInPreviousWindow: hit.prevSuppressed,
      note: details.note,
    };

    const tone = TONES[event];
    const { html, text } = renderEmail({
      preheader: `${title} · ${email} · ${payload.ip}`,
      label: tone === 'danger' ? 'Security alert · action may be needed' : tone === 'warning' ? 'Security alert' : 'Security notice',
      tone,
      title,
      details: [
        ['Account', email],
        ['Time', formatTime(time)],
        ['IP', payload.ip],
        ['Location', payload.location],
        ['Browser', payload.userAgent],
        ...(details.note ? ([['Note', details.note]] as [string, string][]) : []),
      ],
      ...(ADVICE[event] ? { callout: { tone: tone === 'success' ? 'info' : tone, title: tone === 'danger' ? 'If this wasn’t you' : undefined, text: ADVICE[event]! } } : {}),
      outro:
        hit.prevSuppressed > 0
          ? [`${hit.prevSuppressed} more "${title}" event(s) for this account were not emailed in the previous 10-minute window.`]
          : undefined,
      footer: 'Sent to both Byte Bun admins. Alerts of the same type for the same account are sent at most once every 10 minutes.',
    });

    const tasks: Promise<unknown>[] = [];
    if (this.cfg.auth.alertEmails.length) {
      // "[Byte Bun Security] Wrong authenticator code: Arvi Genio" (the address, for unknown emails)
      tasks.push(this.mailer.send({ to: this.cfg.auth.alertEmails, subject: `[Byte Bun Security] ${title}: ${adminName(email) ?? email}`, text, html }));
    }
    const url = this.cfg.auth.alertWebhookUrl;
    if (url) {
      tasks.push(
        fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ type: 'security.alert', ...payload }),
          signal: AbortSignal.timeout(5_000),
        }).then((res) => {
          if (!res.ok) logger.warn({ status: res.status }, 'Security alert webhook returned an error status');
        }),
      );
    }
    const results = await Promise.allSettled(tasks);
    for (const r of results) if (r.status === 'rejected') logger.error({ reason: String(r.reason) }, 'Security alert delivery failed');
  }
}

export function formatTime(d: Date): string {
  const local = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    dateStyle: 'medium',
    timeStyle: 'long',
  }).format(d);
  return `${local} (${d.toISOString()})`;
}
