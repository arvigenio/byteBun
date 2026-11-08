// Outgoing email (admin sign-in codes, security alerts, lead emails), over SMTP with nodemailer.
//
//  - Production: SMTP_* settings are required. SMTP_USER must be allowed to send as the From
//    addresses (MAIL_FROM for admin emails, LEADS_MAIL_FROM for lead emails).
//  - Development without SMTP_HOST: emails are written to the API log instead.
//  - TESTING_EMAIL_ADDRESS (not in production): every email goes there instead of its real
//    recipients. Subject and content stay exactly as in production; one line at the top says
//    who it was intended for ("Intended for: Maria Santos <maria@example.com>").
//  - Recipients are addressed by name ("Maria Santos" <maria@...>): leads from `names`, admins
//    from src/auth/admins.ts.
//  - Automated tests (NODE_ENV=test): emails are kept in memory (`outbox` below), never sent.
import nodemailer, { type Transporter } from 'nodemailer';
import type { AppConfig } from '../config/config';
import { logger } from '../logging/logger';
import { adminName } from './admins';
import { escapeHtml } from './email-template';

export interface MailAttachment {
  filename: string;
  content: string;
  contentType: string;
}

export interface Mail {
  to: string | string[];
  subject: string;
  /** Plain-text copy (phone notifications, text-only clients). */
  text: string;
  /** Designed version, from renderEmail() in email-template.ts. */
  html?: string;
  /** Display names by address, e.g. { "maria@example.com": "Maria Santos" }. Admins are named automatically. */
  names?: Record<string, string>;
  /** Overrides MAIL_FROM (lead emails use LEADS_MAIL_FROM). */
  from?: string;
  replyTo?: string;
  attachments?: MailAttachment[];
}

export interface SentMail extends Mail {
  from: string;
  sentAt: Date;
  /** Set when TESTING_EMAIL_ADDRESS redirected the email: who it was really for. */
  originalTo?: string[];
}

/** Test sink: every email "sent" while NODE_ENV=test. Tests read and clear it. */
export const outbox: SentMail[] = [];

const list = (to: string | string[]) => (Array.isArray(to) ? to : [to]);

const nameFor = (mail: Mail, email: string) => mail.names?.[email] ?? adminName(email);

/** "Maria Santos <maria@example.com>", or just the address when there is no name. */
export const labelFor = (mail: Mail, email: string) => {
  const name = nameFor(mail, email);
  return name ? `${name} <${email}>` : email;
};

/** TESTING_EMAIL_ADDRESS: deliver to that inbox instead, unchanged except for one "Intended for" line. */
export function redirectForTesting(mail: Mail, testingAddress: string): Mail & { originalTo?: string[] } {
  if (!testingAddress) return mail;
  const originalTo = list(mail.to);
  const note = `Intended for: ${originalTo.map((e) => labelFor(mail, e)).join(', ')}`;
  const banner = `<div style="background:#EDE7F8;border-bottom:1px solid #D9CFEE;color:#4A3B63;font:600 13px/20px Helvetica,Arial,sans-serif;padding:10px 16px;text-align:center;">${escapeHtml(note)}</div>`;
  return {
    ...mail,
    to: testingAddress,
    text: `${note}\n\n${mail.text}`,
    html: mail.html?.replace(/<body([^>]*)>/i, (m) => `${m}${banner}`),
    originalTo,
  };
}

export class Mailer {
  private readonly transporter: Transporter | null;
  private readonly mode: 'smtp' | 'log' | 'memory';

  constructor(private readonly cfg: AppConfig) {
    if (cfg.nodeEnv === 'test') this.mode = 'memory';
    else if (cfg.mail.host) this.mode = 'smtp';
    else this.mode = 'log';

    this.transporter =
      this.mode === 'smtp'
        ? nodemailer.createTransport({
            host: cfg.mail.host,
            port: cfg.mail.port,
            secure: cfg.mail.port === 465, // 465 = TLS from the start; 587 = STARTTLS
            requireTLS: cfg.mail.port !== 465,
            auth: { user: cfg.mail.user, pass: cfg.mail.pass },
            connectionTimeout: 10_000,
            greetingTimeout: 10_000,
            socketTimeout: 20_000,
          })
        : null;
    if (cfg.mail.testingAddress) logger.warn({ testingAddress: cfg.mail.testingAddress }, 'TESTING_EMAIL_ADDRESS is set: every email is delivered to that inbox instead of its recipients');
  }

  async send(original: Mail): Promise<void> {
    const mail = redirectForTesting(original, this.cfg.mail.testingAddress);
    const from = mail.from ?? this.cfg.mail.from;
    if (this.mode === 'memory') {
      outbox.push({ ...mail, from, sentAt: new Date() });
      return;
    }
    if (this.mode === 'log') {
      logger.info({ mailTo: mail.to, subject: mail.subject, text: mail.text }, 'Email (not sent: SMTP_HOST is not set)');
      return;
    }
    await this.transporter!.sendMail({
      from,
      // Named addresses: "Maria Santos" <maria@...>
      to: list(mail.to).map((address) => {
        const name = nameFor(mail, address);
        return name ? { name, address } : address;
      }),
      replyTo: mail.replyTo,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
      attachments: mail.attachments?.map((a) => ({ filename: a.filename, content: a.content, contentType: a.contentType })),
    });
  }

  /** Sends without making the caller wait. Failures are logged, never thrown. */
  sendInBackground(mail: Mail): void {
    this.send(mail).catch((err: unknown) =>
      logger.error({ subject: mail.subject, reason: err instanceof Error ? err.message : String(err) }, 'Email failed to send'),
    );
  }
}
