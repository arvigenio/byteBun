// Emails of the client apps: sign-in codes and invitations (Byte Bun Bookings branding), and
// booking emails to customers and owners in the BUSINESS's branding (name, color), with a
// "Powered by Byte Bun Bookings" footer on the free plan.
//
// Private details (meeting links, gate codes, the business's instructions) appear only here and
// in reminders, never on the public booking page.
import sanitizeHtml from 'sanitize-html';
import { escapeHtml as e } from '../auth/email-template';
import type { Mail, MailAttachment } from '../auth/mailer';
import type { AppConfig } from '../config/config';
import { formatLocalDate } from './booking/time';

const FONT = "'Segoe UI', Helvetica, Arial, sans-serif";
const PRODUCT = { name: 'Byte Bun Bookings', color: '#0F766E' };

export interface Brand {
  businessName: string;
  primaryColor: string;
  poweredBy: boolean;
  replyTo?: string | null;
  phone?: string | null;
}

/** Rich text allowed in instructions: paragraphs, emphasis, lists and links. */
export const INSTRUCTIONS_HTML: sanitizeHtml.IOptions = {
  allowedTags: ['p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'ul', 'ol', 'li', 'a', 'h3', 'h4', 'blockquote'],
  allowedAttributes: { a: ['href', 'target', 'rel'] },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  transformTags: { a: sanitizeHtml.simpleTransform('a', { target: '_blank', rel: 'noopener noreferrer' }) },
};
export const cleanInstructions = (html: string | null | undefined) => {
  const out = sanitizeHtml(html ?? '', INSTRUCTIONS_HTML).trim();
  return out.replace(/<p>\s*<\/p>/g, '').trim() || null;
};
const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Instructions that may still be plain text (saved before the editor): paragraphs from blank lines, then cleaned. */
export const richInstructions = (value: string | null | undefined) => {
  if (!value?.trim()) return null;
  const html = /<[a-z][^>]*>/i.test(value)
    ? value
    : value
        .trim()
        .split(/\n\s*\n/)
        .map((p) => `<p>${escapeHtml(p.trim()).replace(/\n/g, '<br>')}</p>`)
        .join('');
  return cleanInstructions(html);
};
export const instructionsToText = (html: string) =>
  sanitizeHtml(html.replace(/<a [^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gi, '$2 ($1)').replace(/<\/(p|li|h3|h4)>|<br\s*\/?>/gi, '\n'), { allowedTags: [] })
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

/** Readable text color (black or white) on a background. */
export function onColor(hex: string) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return (1.05 / (lum + 0.05) >= (lum + 0.05) / 0.05 ? '#FFFFFF' : '#111111');
}

interface Button {
  label: string;
  href: string;
  primary?: boolean;
}

interface Content {
  brandName: string;
  color: string;
  preheader: string;
  title: string;
  intro?: string[];
  code?: string;
  details?: [string, string][];
  /** Trusted HTML blocks (already sanitized) with their plain-text copy. */
  blocks?: { title: string; html: string; text: string }[];
  /** The check-in QR code (an inline image, cid:checkin-qr) and its code. */
  checkIn?: { code: string };
  buttons?: Button[];
  note?: string;
  footer: string;
}

function render(c: Content): { html: string; text: string } {
  const fg = onColor(c.color);
  const btn = (b: Button) =>
    `<a href="${e(b.href)}" target="_blank" style="display:inline-block;margin:0 8px 10px 0;padding:11px 18px;border-radius:8px;font:600 14px/20px ${FONT};text-decoration:none;${
      b.primary ? `background:${c.color};color:${fg};border:2px solid ${c.color};` : `background:#FFFFFF;color:${c.color};border:2px solid ${c.color};`
    }">${e(b.label)}</a>`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${e(c.title)}</title></head>
<body style="margin:0;padding:0;background:#F4F5F7;">
<div style="display:none;max-height:0;overflow:hidden;">${e(c.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F5F7;"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#FFFFFF;border-radius:14px;overflow:hidden;border:1px solid #E3E5EA;">
<tr><td style="background:${c.color};padding:18px 28px;font:700 18px/26px ${FONT};color:${fg};">${e(c.brandName)}</td></tr>
<tr><td style="padding:28px;">
<h1 style="margin:0 0 14px;font:700 22px/30px ${FONT};color:#111827;">${e(c.title)}</h1>
${(c.intro ?? []).map((t) => `<p style="margin:0 0 14px;font:15px/24px ${FONT};color:#374151;">${e(t)}</p>`).join('')}
${c.code ? `<div style="margin:8px 0 20px;padding:18px;border-radius:10px;background:#F3F4F6;text-align:center;font:700 34px/40px Consolas,Menlo,monospace;letter-spacing:8px;color:#111827;">${e(c.code)}</div>` : ''}
${
  c.details?.length
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:6px 0 20px;border-top:1px solid #E5E7EB;">${c.details
        .map(
          ([k, v]) =>
            `<tr><td valign="top" style="padding:10px 12px 10px 0;border-bottom:1px solid #E5E7EB;font:600 13px/20px ${FONT};color:#6B7280;width:110px;">${e(k)}</td><td style="padding:10px 0;border-bottom:1px solid #E5E7EB;font:14px/20px ${FONT};color:#111827;">${e(v)}</td></tr>`,
        )
        .join('')}</table>`
    : ''
}
${
  c.checkIn
    ? `<div style="margin:6px 0 22px;padding:20px 16px;border:2px dashed ${c.color};border-radius:12px;text-align:center;">
<div style="font:700 13px/18px ${FONT};color:#374151;margin:0 0 4px;text-transform:uppercase;letter-spacing:.5px;">Your check-in code</div>
<div style="font:13px/20px ${FONT};color:#6B7280;margin:0 0 12px;">Show this QR code at the front desk when you arrive.</div>
<img src="cid:checkin-qr" width="160" height="160" alt="Check-in QR code" style="display:block;margin:0 auto 12px;width:160px;height:160px;border:0;">
<div style="font:700 26px/32px Consolas,Menlo,monospace;letter-spacing:6px;color:#111827;">${e(c.checkIn.code)}</div>
<div style="font:12px/18px ${FONT};color:#6B7280;margin:6px 0 0;">If the scan doesn't work, give them this code.</div>
</div>`
    : ''
}
${(c.blocks ?? [])
  .map(
    (b) =>
      `<div style="margin:0 0 18px;padding:14px 16px;border-left:4px solid ${c.color};background:#F9FAFB;border-radius:6px;font:14px/22px ${FONT};color:#1F2937;"><div style="font:700 13px/18px ${FONT};color:#374151;margin:0 0 6px;text-transform:uppercase;letter-spacing:.5px;">${e(b.title)}</div>${b.html}</div>`,
  )
  .join('')}
${c.buttons?.length ? `<div style="margin:4px 0 8px;">${c.buttons.map(btn).join('')}</div>` : ''}
${c.note ? `<p style="margin:8px 0 0;font:13px/20px ${FONT};color:#6B7280;">${e(c.note)}</p>` : ''}
</td></tr>
<tr><td style="padding:16px 28px;border-top:1px solid #E5E7EB;font:12px/18px ${FONT};color:#9CA3AF;">${e(c.footer)}</td></tr>
</table></td></tr></table></body></html>`;

  const text = [
    c.title,
    '',
    ...(c.intro ?? []).flatMap((t) => [t, '']),
    ...(c.code ? [c.code, ''] : []),
    ...(c.details ?? []).map(([k, v]) => `${k}: ${v}`),
    ...(c.details?.length ? [''] : []),
    ...(c.checkIn ? ['YOUR CHECK-IN CODE', `${c.checkIn.code} (show the QR code in this email, or give this code, at the front desk)`, ''] : []),
    ...(c.blocks ?? []).flatMap((b) => [b.title.toUpperCase(), b.text, '']),
    ...(c.buttons ?? []).map((b) => `${b.label}: ${b.href}`),
    ...(c.note ? ['', c.note] : []),
    '',
    '--',
    c.footer,
  ].join('\n');
  return { html, text };
}

const productFooter = 'Byte Bun Bookings · bytebuntech.com';
const brandFooter = (b: Brand) => (b.poweredBy ? `${b.businessName} · Powered by Byte Bun Bookings` : b.businessName);
/** "Clinic Name via Byte Bun Bookings <bookings@...>" */
const fromFor = (cfg: AppConfig, name: string) => {
  const m = /<([^>]+)>/.exec(cfg.clients.mailFrom);
  const address = m ? m[1] : cfg.clients.mailFrom;
  return `"${name.replace(/["\\]/g, '')}" <${address}>`;
};

export function signInCodeMail(cfg: AppConfig, to: string, otp: string, minutes: number): Mail {
  const { html, text } = render({
    brandName: PRODUCT.name,
    color: PRODUCT.color,
    preheader: `Your code is ${otp}`,
    title: 'Your sign-in code',
    intro: ['Enter this code to sign in to Byte Bun.'],
    code: otp,
    note: `It expires in ${minutes} minutes and works once. If you didn't ask for it, you can ignore this email.`,
    footer: productFooter,
  });
  return { to, subject: `Your Byte Bun sign-in code: ${otp}`, text, html, from: cfg.clients.mailFrom };
}

export function invitationMail(cfg: AppConfig, d: { to: string; businessName: string; inviterName: string; role: string; url: string }): Mail {
  const { html, text } = render({
    brandName: PRODUCT.name,
    color: PRODUCT.color,
    preheader: `${d.inviterName} invited you to ${d.businessName}`,
    title: `Join ${d.businessName}`,
    intro: [`${d.inviterName} invited you to join ${d.businessName} on Byte Bun as ${d.role}.`],
    buttons: [{ label: 'Accept invitation', href: d.url, primary: true }],
    note: 'The invitation expires in 7 days. Sign in with this email address to accept it.',
    footer: productFooter,
  });
  return { to: d.to, subject: `You're invited to ${d.businessName}`, text, html, from: cfg.clients.mailFrom };
}

// ---- Booking emails ----

export interface BookingView {
  bookingId: number;
  brand: Brand;
  customerName: string;
  customerEmail: string;
  customerPhone: string | null;
  serviceName: string;
  dateLabel: string;
  /** null for date-only bookings. */
  timeLabel: string | null;
  zone: string;
  location: { type: string; address: string | null; meetingUrl: string | null };
  /** General + service instructions, sanitized. */
  instructions: { title: string; html: string }[];
  manageUrl: string;
  /** Inside the change cutoff (or already started): no reschedule/cancel buttons. */
  canChange: boolean;
  calendar: { google: string; outlook: string; ics: string };
  note: string | null;
  /** In-person services: the attendance code ("ABCD-EFGH") and its QR code (PNG). */
  checkIn: { code: string; qrPng: Buffer } | null;
}

const whenOf = (v: BookingView) => (v.timeLabel ? `${v.dateLabel}, ${v.timeLabel} (${v.zone})` : `${v.dateLabel} (any time during opening hours)`);
const mapsUrl = (address: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;

function locationDetails(v: BookingView): [string, string][] {
  if (v.location.type === 'online') return [['Where', 'Online meeting']];
  if (v.location.type === 'phone') return [['Where', 'Phone call']];
  return v.location.address ? [['Where', v.location.address]] : [];
}

function locationButtons(v: BookingView): Button[] {
  if (v.location.type === 'online' && v.location.meetingUrl) return [{ label: 'Join meeting', href: v.location.meetingUrl, primary: true }];
  if (v.location.type === 'in_person' && v.location.address) return [{ label: 'Open in Google Maps', href: mapsUrl(v.location.address) }];
  return [];
}

const calendarButtons = (v: BookingView): Button[] => [
  { label: 'Google Calendar', href: v.calendar.google },
  { label: 'Outlook', href: v.calendar.outlook },
];

const changeButtons = (v: BookingView): Button[] =>
  v.canChange
    ? [
        { label: 'Reschedule', href: v.manageUrl },
        { label: 'Cancel', href: v.manageUrl },
      ]
    : [];

const blocks = (v: BookingView) => v.instructions.map((i) => ({ title: i.title, html: i.html, text: instructionsToText(i.html) }));

const ics = (v: BookingView): MailAttachment => ({ filename: 'appointment.ics', content: v.calendar.ics, contentType: 'text/calendar; charset=utf-8; method=PUBLISH' });

/** The QR code and code, for the emails a customer brings to the appointment (confirmation, moved, reminder). */
const withCheckIn = (v: BookingView) => (v.checkIn ? { checkIn: { code: v.checkIn.code } } : {});
const qrAttachment = (v: BookingView): MailAttachment[] => (v.checkIn ? [{ filename: 'check-in.png', content: v.checkIn.qrPng, contentType: 'image/png', cid: 'checkin-qr' }] : []);

function customerMail(cfg: AppConfig, v: BookingView, subject: string, c: Omit<Content, 'brandName' | 'color' | 'footer'>, withIcs: boolean): Mail {
  const { html, text } = render({ ...c, brandName: v.brand.businessName, color: v.brand.primaryColor, footer: brandFooter(v.brand) });
  const attachments = [...(withIcs ? [ics(v)] : []), ...(c.checkIn ? qrAttachment(v) : [])];
  return {
    to: v.customerEmail,
    names: { [v.customerEmail]: v.customerName },
    subject,
    text,
    html,
    from: fromFor(cfg, v.brand.businessName),
    replyTo: v.brand.replyTo ?? undefined,
    attachments: attachments.length ? attachments : undefined,
  };
}

const callNote = (v: BookingView) =>
  v.canChange ? 'Need to change it? Use the Reschedule or Cancel button.' : v.brand.phone ? `To change this booking, please call ${v.brand.phone}.` : 'To change this booking, please contact us.';

export function confirmationMail(cfg: AppConfig, v: BookingView): Mail {
  return customerMail(
    cfg,
    v,
    `Booking confirmed: ${v.serviceName}, ${v.dateLabel}`,
    {
      preheader: `${v.serviceName} on ${whenOf(v)}`,
      title: "You're booked!",
      intro: [`Hi ${v.customerName}, your booking with ${v.brand.businessName} is confirmed.`],
      details: [['Service', v.serviceName], ['When', whenOf(v)], ...locationDetails(v)],
      ...withCheckIn(v),
      blocks: blocks(v),
      buttons: [...locationButtons(v), ...calendarButtons(v), ...changeButtons(v)],
      note: callNote(v),
    },
    true,
  );
}

export function rescheduledMail(cfg: AppConfig, v: BookingView, previous: string): Mail {
  return customerMail(
    cfg,
    v,
    `Booking moved: ${v.serviceName}, ${v.dateLabel}`,
    {
      preheader: `New time: ${whenOf(v)}`,
      title: 'Your booking was moved',
      intro: [`Hi ${v.customerName}, your booking with ${v.brand.businessName} has a new time.`],
      details: [['Service', v.serviceName], ['New time', whenOf(v)], ['Was', previous], ...locationDetails(v)],
      ...withCheckIn(v),
      blocks: blocks(v),
      buttons: [...locationButtons(v), ...calendarButtons(v), ...changeButtons(v)],
      note: callNote(v),
    },
    true,
  );
}

export function reminderMail(cfg: AppConfig, v: BookingView): Mail {
  return customerMail(
    cfg,
    v,
    `Reminder: ${v.serviceName}, ${v.dateLabel}${v.timeLabel ? ` at ${v.timeLabel}` : ''}`,
    {
      preheader: `${v.serviceName} on ${whenOf(v)}`,
      title: 'See you soon',
      intro: [`Hi ${v.customerName}, this is a reminder of your booking with ${v.brand.businessName}.`],
      details: [['Service', v.serviceName], ['When', whenOf(v)], ...locationDetails(v)],
      ...withCheckIn(v),
      blocks: blocks(v),
      buttons: [...locationButtons(v), ...changeButtons(v)],
      note: callNote(v),
    },
    false,
  );
}

export function noShowMail(cfg: AppConfig, v: BookingView, bookAgainUrl: string): Mail {
  return customerMail(
    cfg,
    v,
    `We missed you at ${v.brand.businessName}`,
    {
      preheader: 'Book another time that works for you',
      title: 'We missed you',
      intro: [`Hi ${v.customerName}, we didn't see you for your ${v.serviceName} on ${whenOf(v)}. No problem: book another time whenever it suits you.`],
      buttons: [{ label: 'Book another time', href: bookAgainUrl, primary: true }],
      note: v.brand.phone ? `Questions? Call ${v.brand.phone}.` : undefined,
    },
    false,
  );
}

/** Account notice to owners: the business was deactivated or deleted by Byte Bun. */
export function accountNoticeMail(cfg: AppConfig, to: string, d: { businessName: string; kind: 'deactivated' | 'reactivated' | 'deleted'; reason: string | null; deleteAfter?: string }): Mail {
  const title = { deactivated: `${d.businessName} is deactivated`, reactivated: `${d.businessName} is active again`, deleted: `${d.businessName} is scheduled for deletion` }[d.kind];
  const intro = {
    deactivated: ['Byte Bun deactivated this account. Sign-in, the booking page and reminders are paused. All your data is kept.'],
    reactivated: ['Byte Bun reactivated this account. Sign-in, the booking page and reminders work again.'],
    deleted: [`Byte Bun deleted this account. Its data will be permanently removed on ${d.deleteAfter}. Until then it can still be restored by Byte Bun.`],
  }[d.kind];
  const { html, text } = render({
    brandName: PRODUCT.name,
    color: PRODUCT.color,
    preheader: title,
    title,
    intro: [...intro, ...(d.reason ? [`Reason: ${d.reason}`] : []), 'Questions? Reply to this email.'],
    footer: productFooter,
  });
  return { to, subject: title, text, html, from: cfg.clients.mailFrom };
}

/** Plain-text WhatsApp message for n8n (it adds the template / buttons it needs). */
export function whatsappText(kind: string, v: BookingView): string {
  const when = whenOf(v);
  const lines: Record<string, string[]> = {
    reminder: [`Reminder: ${v.serviceName} with ${v.brand.businessName}`, when],
    confirmation: [`Booked: ${v.serviceName} with ${v.brand.businessName}`, when],
    reschedule: [`Moved: ${v.serviceName} with ${v.brand.businessName}`, `New time: ${when}`],
    cancellation: [`Cancelled: ${v.serviceName} with ${v.brand.businessName}`, when],
    owner_new: [`New booking: ${v.customerName}`, `${v.serviceName}, ${when}`],
    owner_reschedule: [`Rescheduled: ${v.customerName}`, `${v.serviceName}, ${when}`],
    owner_cancel: [`Cancelled: ${v.customerName}`, `${v.serviceName}, ${when}`],
  };
  const base = lines[kind] ?? [`${v.serviceName} with ${v.brand.businessName}`, when];
  const customer = !kind.startsWith('owner_');
  return [
    ...base,
    ...(customer && v.location.type === 'online' && v.location.meetingUrl ? [`Join: ${v.location.meetingUrl}`] : []),
    ...(customer && v.location.type === 'in_person' && v.location.address ? [v.location.address] : []),
    ...(customer && v.checkIn && ['confirmation', 'reschedule', 'reminder'].includes(kind) ? [`Check-in code: ${v.checkIn.code}`] : []),
    ...(customer && v.canChange && kind !== 'cancellation' ? [`Reschedule or cancel: ${v.manageUrl}`] : []),
  ].join('\n');
}

export function cancelledMail(cfg: AppConfig, v: BookingView, opts: { by: string; reason: string | null; bookAgainUrl: string }): Mail {
  return customerMail(
    cfg,
    v,
    `Booking cancelled: ${v.serviceName}, ${v.dateLabel}`,
    {
      preheader: `${v.serviceName} on ${whenOf(v)} is cancelled`,
      title: 'Your booking is cancelled',
      intro: [
        opts.by === 'customer'
          ? `Hi ${v.customerName}, your booking with ${v.brand.businessName} is cancelled, as you asked.`
          : `Hi ${v.customerName}, ${v.brand.businessName} had to cancel your booking. Sorry for the inconvenience.`,
      ],
      details: [['Service', v.serviceName], ['Was', whenOf(v)], ...(opts.reason ? ([['Reason', opts.reason]] as [string, string][]) : [])],
      buttons: opts.bookAgainUrl ? [{ label: 'Book another time', href: opts.bookAgainUrl, primary: true }] : [],
      note: v.brand.phone ? `Questions? Call ${v.brand.phone}.` : undefined,
    },
    false,
  );
}

export type OwnerAlertKind = 'new' | 'cancelled' | 'rescheduled';

export function ownerAlertMail(cfg: AppConfig, to: string, kind: OwnerAlertKind, v: BookingView, dashboardUrl: string, extra?: { previous?: string; by?: string }): Mail {
  const title = { new: 'New booking', cancelled: 'Booking cancelled', rescheduled: 'Booking rescheduled' }[kind];
  const by = extra?.by === 'customer' ? 'by the customer' : extra?.by === 'business' ? 'by your team' : '';
  const { html, text } = render({
    brandName: v.brand.businessName,
    color: v.brand.primaryColor,
    preheader: `${v.customerName}: ${v.serviceName}, ${whenOf(v)}`,
    title,
    intro: [`${v.customerName} · ${v.serviceName}${by ? ` (${kind} ${by})` : ''}`],
    details: [
      ['When', whenOf(v)],
      ...(extra?.previous ? ([['Was', extra.previous]] as [string, string][]) : []),
      ['Customer', v.customerName],
      ['Email', v.customerEmail],
      ...(v.customerPhone ? ([['Phone', v.customerPhone]] as [string, string][]) : []),
      ...(v.note ? ([['Note', v.note]] as [string, string][]) : []),
    ],
    buttons: [{ label: 'Open bookings', href: dashboardUrl, primary: true }],
    footer: 'Byte Bun Bookings · Choose which alerts you get in Settings.',
  });
  return { to, subject: `${title}: ${v.customerName}, ${v.dateLabel}${v.timeLabel ? ` ${v.timeLabel}` : ''}`, text, html, from: cfg.clients.mailFrom };
}

/** Free plan: bookings are deleted N days after the appointment; a heads-up ~7 days before. */
export function retentionWarningMail(cfg: AppConfig, to: string, d: { businessName: string; count: number; deleteOn: string; retentionDays: number; exportUrl: string; upgradeUrl: string }): Mail {
  const when = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }).format(new Date(`${d.deleteOn}T12:00:00Z`));
  const n = `${d.count} booking${d.count === 1 ? '' : 's'}`;
  const { html, text } = render({
    brandName: PRODUCT.name,
    color: PRODUCT.color,
    preheader: `${n} will be deleted on ${when}`,
    title: `${n} will be deleted on ${when}`,
    intro: [
      `On the free plan, ${d.businessName}'s bookings are deleted ${d.retentionDays} days after the appointment date. ${n} reach that point on ${when}.`,
      'Download a CSV copy to keep them, or upgrade to keep all your booking history (deletion stops right away).',
    ],
    buttons: [
      { label: 'Download CSV', href: d.exportUrl, primary: true },
      { label: 'Upgrade', href: d.upgradeUrl },
    ],
    footer: productFooter,
  });
  return { to, subject: `${n} will be deleted on ${when}`, text, html, from: cfg.clients.mailFrom };
}

export function monthlyLimitMail(cfg: AppConfig, to: string, d: { businessName: string; used: number; limit: number; upgradeUrl: string }): Mail {
  const reached = d.used >= d.limit;
  const { html, text } = render({
    brandName: PRODUCT.name,
    color: PRODUCT.color,
    preheader: reached ? 'Your booking page is paused until next month' : `You've used ${d.used} of ${d.limit} free bookings`,
    title: reached ? 'Monthly booking limit reached' : `${d.used} of ${d.limit} free bookings used`,
    intro: reached
      ? [`${d.businessName} has reached the free plan's ${d.limit} bookings this month. Your booking page now shows "No more online bookings available this month" until the 1st.`]
      : [`${d.businessName} has used ${d.used} of the ${d.limit} bookings included in the free plan this month (cancelled bookings count too).`],
    buttons: [{ label: 'Upgrade for unlimited bookings', href: d.upgradeUrl, primary: true }],
    footer: productFooter,
  });
  return { to, subject: reached ? 'Your free booking limit is reached for this month' : `You've used ${d.used} of ${d.limit} free bookings`, text, html, from: cfg.clients.mailFrom };
}

// ---- Calendar ----

const icsDate = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
const icsDay = (date: string) => date.replace(/-/g, '');
const icsEscape = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const nextDay = (date: string) => new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

// ---- Event emails (seminars, webinars: booking/events.ts) ----

export interface EventView {
  brand: Brand;
  attendeeName: string;
  attendeeEmail: string;
  title: string;
  /** "Thursday, December 3, 2026, 2:00 PM – 5:00 PM (PST)" */
  when: string;
  dateLabel: string;
  format: 'onsite' | 'online';
  address: string | null;
  /** Onsite: the exact map pin, for directions. */
  pin: { lat: number; lng: number } | null;
  /** Online: may come later. */
  meetingUrl: string | null;
  pageUrl: string;
  calendar: { google: string; outlook: string; ics: string };
  /** Onsite events: the QR code and code for the entrance. Online events: none (just the link). */
  checkIn: { code: string; qrPng: Buffer } | null;
  /** Free events: the attendee's private link to cancel (paid events can't be cancelled). */
  cancelUrl: string | null;
}

function eventDetails(v: EventView): [string, string][] {
  return [
    ['Event', v.title],
    ['When', v.when],
    v.format === 'online' ? ['Where', v.meetingUrl ? 'Online (link below)' : 'Online: we’ll email you the link'] : ['Where', v.address || v.brand.businessName],
  ];
}

function eventButtons(v: EventView, calendar: boolean): Button[] {
  return [
    ...(v.format === 'online' && v.meetingUrl ? [{ label: 'Join online', href: v.meetingUrl, primary: true }] : []),
    ...(v.format === 'onsite' && (v.pin || v.address) ? [{ label: 'Open in Google Maps', href: v.pin ? `https://www.google.com/maps/search/?api=1&query=${v.pin.lat},${v.pin.lng}` : mapsUrl(v.address!) }] : []),
    ...(calendar ? [{ label: 'Google Calendar', href: v.calendar.google }, { label: 'Outlook', href: v.calendar.outlook }] : []),
    { label: 'Event page', href: v.pageUrl },
  ];
}

function eventMail(cfg: AppConfig, v: EventView, subject: string, c: Omit<Content, 'brandName' | 'color' | 'footer'>, extras: { qr: boolean; ics: boolean }): Mail {
  const qr = extras.qr && v.checkIn ? v.checkIn : null;
  const { html, text } = render({ ...c, ...(qr ? { checkIn: { code: qr.code } } : {}), brandName: v.brand.businessName, color: v.brand.primaryColor, footer: brandFooter(v.brand) });
  const attachments: MailAttachment[] = [
    ...(extras.ics ? [{ filename: 'event.ics', content: v.calendar.ics, contentType: 'text/calendar; charset=utf-8; method=PUBLISH' }] : []),
    ...(qr ? [{ filename: 'check-in.png', content: qr.qrPng, contentType: 'image/png', cid: 'checkin-qr' }] : []),
  ];
  return { to: v.attendeeEmail, names: { [v.attendeeEmail]: v.attendeeName }, subject, text, html, from: fromFor(cfg, v.brand.businessName), replyTo: v.brand.replyTo ?? undefined, attachments: attachments.length ? attachments : undefined };
}

export function eventConfirmationMail(cfg: AppConfig, v: EventView): Mail {
  return eventMail(
    cfg,
    v,
    `You're registered: ${v.title}, ${v.dateLabel}`,
    {
      preheader: `${v.title} · ${v.when}`,
      title: "You're registered!",
      intro: [`Hi ${v.attendeeName}, your place at ${v.title} with ${v.brand.businessName} is confirmed.`],
      details: eventDetails(v),
      buttons: [...eventButtons(v, true), ...(v.cancelUrl ? [{ label: 'Cancel my registration', href: v.cancelUrl }] : [])],
      note: [
        v.format === 'online' && !v.meetingUrl ? 'We’ll email you the link to join before the event.' : null,
        v.cancelUrl ? 'Can’t come? Please cancel, so someone else can have your place.' : null,
        v.brand.phone ? `Questions? Call ${v.brand.phone}.` : null,
      ]
        .filter(Boolean)
        .join(' ') || undefined,
    },
    { qr: true, ics: true },
  );
}

export function eventLinkMail(cfg: AppConfig, v: EventView, changed: boolean): Mail {
  return eventMail(
    cfg,
    v,
    `${changed ? 'New link' : 'Your link'} to join: ${v.title}`,
    {
      preheader: `Join ${v.title} online`,
      title: changed ? 'The link to join has changed' : 'Here’s your link to join',
      intro: [changed ? `Hi ${v.attendeeName}, ${v.brand.businessName} changed the link for ${v.title}. Please use this one.` : `Hi ${v.attendeeName}, here is the link to join ${v.title} online.`],
      details: [...eventDetails(v), ['Link', v.meetingUrl ?? '']],
      buttons: eventButtons(v, false),
    },
    { qr: true, ics: false },
  );
}

/** Sent when the attendee is checked in at the event (scanned, typed code, or by hand). */
export function eventCheckedInMail(cfg: AppConfig, v: EventView, checkedInAt: string): Mail {
  return eventMail(
    cfg,
    v,
    `You're checked in: ${v.title}`,
    {
      preheader: `Checked in at ${checkedInAt}`,
      title: "You're checked in!",
      intro: [`Hi ${v.attendeeName}, welcome to ${v.title}. You were checked in at ${checkedInAt}.`, 'Enjoy the event!'],
      details: [['Event', v.title], ['When', v.when], ['Checked in', checkedInAt]],
      buttons: v.format === 'online' && v.meetingUrl ? [{ label: 'Join online', href: v.meetingUrl, primary: true }] : [],
      note: `If this wasn't you, please tell ${v.brand.businessName}${v.brand.phone ? ` (${v.brand.phone})` : ''}.`,
    },
    { qr: false, ics: false },
  );
}

/** The attendee cancelled their own registration (free events). */
export function eventCancelledMail(cfg: AppConfig, v: EventView): Mail {
  return eventMail(
    cfg,
    v,
    `Registration cancelled: ${v.title}`,
    {
      preheader: `You cancelled your registration for ${v.title}`,
      title: 'Your registration is cancelled',
      intro: [`Hi ${v.attendeeName}, you cancelled your registration for ${v.title} with ${v.brand.businessName}. Your QR code no longer works.`, 'Changed your mind? You can register again on the event page while places are left.'],
      details: [['Event', v.title], ['When', v.when]],
      buttons: [{ label: 'Event page', href: v.pageUrl }],
    },
    { qr: false, ics: false },
  );
}

export function eventRevokedMail(cfg: AppConfig, v: EventView, reason: string | null): Mail {
  return eventMail(
    cfg,
    v,
    `Registration cancelled: ${v.title}`,
    {
      preheader: `Your registration for ${v.title} was cancelled`,
      title: 'Your registration was cancelled',
      intro: [`Hi ${v.attendeeName}, ${v.brand.businessName} cancelled your registration for ${v.title}.`, ...(reason ? [`Reason: ${reason}`] : [])],
      details: [['Event', v.title], ['When', v.when]],
      note: v.brand.phone ? `Questions? Call ${v.brand.phone}.` : 'If you have questions, reply to this email.',
    },
    { qr: false, ics: false },
  );
}

/** The code that confirms deleting an event (to the person who asked). */
export function eventDeleteCodeMail(cfg: AppConfig, d: { to: string; name: string; businessName: string; eventTitle: string; code: string; minutes: number; registrations: number }): Mail {
  const { html, text } = render({
    brandName: PRODUCT.name,
    color: PRODUCT.color,
    preheader: `Your code to delete ${d.eventTitle}: ${d.code}`,
    title: 'Confirm deleting the event',
    intro: [
      `Hi ${d.name}, someone signed in as you asked to delete “${d.eventTitle}” (${d.businessName}).`,
      d.registrations ? `It has ${d.registrations} registration${d.registrations === 1 ? '' : 's'}. Deleting it removes them, its scanners and claimables, and can’t be undone.` : 'Deleting it can’t be undone.',
      'Enter this code in the confirmation window:',
    ],
    code: d.code,
    note: `It expires in ${d.minutes} minutes. If you didn’t ask for this, ignore this email: nothing is deleted without the code.`,
    footer: productFooter,
  });
  return { to: d.to, names: { [d.to]: d.name }, subject: `Code to delete “${d.eventTitle}”: ${d.code}`, text, html, from: cfg.clients.mailFrom };
}

/** The business deleted (cancelled) an event someone was registered for. */
export function eventCancelledByBusinessMail(cfg: AppConfig, v: EventView): Mail {
  return eventMail(
    cfg,
    v,
    `Event cancelled: ${v.title}`,
    {
      preheader: `${v.title} on ${v.dateLabel} is cancelled`,
      title: 'This event is cancelled',
      intro: [`Hi ${v.attendeeName}, ${v.brand.businessName} cancelled ${v.title}. Your registration and QR code no longer work.`, 'Sorry for the change of plans.'],
      details: [['Event', v.title], ['Was', v.when]],
      note: v.brand.phone ? `Questions? Call ${v.brand.phone}.` : 'If you have questions, reply to this email.',
    },
    { qr: false, ics: false },
  );
}

/** The event will be deleted soon (events without a voucher: 3 months after they end). */
export function eventRetentionReminderMail(cfg: AppConfig, d: { to: string; businessName: string; eventTitle: string; deleteOn: string; daysLeft: number; eventUrl: string }): Mail {
  const when = d.daysLeft <= 1 ? 'tomorrow' : `in ${d.daysLeft} days`;
  const { html, text } = render({
    brandName: PRODUCT.name,
    color: PRODUCT.color,
    preheader: `“${d.eventTitle}” is deleted ${when}`,
    title: `“${d.eventTitle}” is deleted ${when}`,
    intro: [
      `${d.businessName}’s event “${d.eventTitle}” will be deleted automatically on ${formatLocalDate(d.deleteOn)}, 3 months after it ended, as agreed when it was created.`,
      'On that day we’ll email you the complete event (registrations, check-ins, claims and scanners) as CSV and JSON files. You can also export it yourself now.',
    ],
    buttons: [{ label: 'Open the event', href: d.eventUrl, primary: true }],
    note: 'Want to keep it longer? Contact Byte Bun about a bigger-event voucher before it’s deleted.',
    footer: productFooter,
  });
  return { to: d.to, subject: `Reminder: “${d.eventTitle}” is deleted ${when}`, text, html, from: cfg.clients.mailFrom };
}

/** The event was deleted: the complete event attached (CSV + JSON). */
export function eventArchivedMail(cfg: AppConfig, d: { to: string; businessName: string; eventTitle: string; file: string; csv: string; json: string; registrations: number }): Mail {
  const { html, text } = render({
    brandName: PRODUCT.name,
    color: PRODUCT.color,
    preheader: `“${d.eventTitle}” was deleted. Its data is attached.`,
    title: `“${d.eventTitle}” was deleted`,
    intro: [
      `As agreed when it was created, ${d.businessName}’s event “${d.eventTitle}” was deleted 3 months after it ended.`,
      `Attached is the complete event: ${d.registrations} registration${d.registrations === 1 ? '' : 's'} with check-ins and claims (CSV, opens in Excel), and everything in JSON (registrations, claims, scanners and the event’s details).`,
    ],
    note: 'Keep these files: the event can’t be restored.',
    footer: productFooter,
  });
  return {
    to: d.to,
    subject: `Event deleted: “${d.eventTitle}” (data attached)`,
    text,
    html,
    from: cfg.clients.mailFrom,
    attachments: [
      { filename: `${d.file}.csv`, content: d.csv, contentType: 'text/csv; charset=utf-8' },
      { filename: `${d.file}.json`, content: d.json, contentType: 'application/json; charset=utf-8' },
    ],
  };
}

// ---- Event scanner emails (booking/event-scanners.ts) ----

export interface ScannerAccessView {
  brand: Brand;
  name: string;
  email: string;
  role: string;
  eventTitle: string;
  /** "Thursday, December 3, 2026, 2:00 PM (PST)" */
  when: string;
  /** The scanner site, where they sign in with both codes. */
  siteUrl: string;
  /** Their own link: only the access code to enter. */
  linkUrl: string;
  scannerCode: string;
  accessCode: string;
  /** A replacement access code (the old one no longer works). */
  replaced: boolean;
}

/** The scanner's codes: sent when the scanner is made, and when it gets a new access code. */
export function scannerAccessMail(cfg: AppConfig, v: ScannerAccessView): Mail {
  const { html, text } = render({
    brandName: v.brand.businessName,
    color: v.brand.primaryColor,
    preheader: `Your event scanner codes for ${v.eventTitle}`,
    title: v.replaced ? 'Your new scanner access code' : 'You’re an event scanner',
    intro: [
      v.replaced
        ? `Hi ${v.name}, ${v.brand.businessName} gave you a new access code for scanning ${v.eventTitle}. Your old code no longer works.`
        : `Hi ${v.name}, ${v.brand.businessName} added you as an event scanner (${v.role}) for ${v.eventTitle}. You’ll check in attendees by scanning the QR codes in their emails.`,
      'Open the link below on the phone or tablet you’ll scan with, and enter your access code. It works on one device only, so keep it to yourself.',
    ],
    details: [
      ['Event', v.eventTitle],
      ['When', v.when],
      ['Role', v.role],
      ['Scanner code', v.scannerCode],
      ['Access code', v.accessCode],
    ],
    buttons: [{ label: 'Open the scanner', href: v.linkUrl, primary: true }],
    note: `Or go to ${v.siteUrl.replace(/^https?:\/\//, '')} and enter both codes. Questions? Contact ${v.brand.businessName}${v.brand.phone ? ` (${v.brand.phone})` : ''}.`,
    footer: v.brand.poweredBy ? `${v.brand.businessName} · Powered by Byte Bun Bookings` : v.brand.businessName,
  });
  return { to: v.email, names: { [v.email]: v.name }, subject: v.replaced ? `New scanner access code: ${v.eventTitle}` : `Your event scanner codes: ${v.eventTitle}`, text, html, from: fromFor(cfg, v.brand.businessName), replyTo: v.brand.replyTo ?? undefined };
}

export interface CalendarEvent {
  uid: string;
  sequence: number;
  title: string;
  description: string;
  location: string;
  start: Date;
  end: Date;
  /** Date-only bookings are all-day events. */
  allDay: string | null;
}

export function calendarFor(ev: CalendarEvent) {
  const dates = ev.allDay ? `${icsDay(ev.allDay)}/${icsDay(nextDay(ev.allDay))}` : `${icsDate(ev.start)}/${icsDate(ev.end)}`;
  const google = `https://calendar.google.com/calendar/render?${new URLSearchParams({ action: 'TEMPLATE', text: ev.title, dates, details: ev.description, location: ev.location })}`;
  const outlook = `https://outlook.live.com/calendar/0/deeplink/compose?${new URLSearchParams({
    path: '/calendar/action/compose',
    rru: 'addevent',
    subject: ev.title,
    startdt: ev.allDay ?? ev.start.toISOString(),
    enddt: ev.allDay ? nextDay(ev.allDay) : ev.end.toISOString(),
    allday: ev.allDay ? 'true' : 'false',
    body: ev.description,
    location: ev.location,
  })}`;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Byte Bun//Bookings//EN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${ev.uid}`,
    `SEQUENCE:${ev.sequence}`,
    `DTSTAMP:${icsDate(new Date())}`,
    ...(ev.allDay ? [`DTSTART;VALUE=DATE:${icsDay(ev.allDay)}`, `DTEND;VALUE=DATE:${icsDay(nextDay(ev.allDay))}`] : [`DTSTART:${icsDate(ev.start)}`, `DTEND:${icsDate(ev.end)}`]),
    `SUMMARY:${icsEscape(ev.title)}`,
    `DESCRIPTION:${icsEscape(ev.description)}`,
    `LOCATION:${icsEscape(ev.location)}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return { google, outlook, ics: lines.join('\r\n') + '\r\n' };
}
