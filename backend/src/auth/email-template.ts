// One template for every email the app sends: admin emails (sign-in codes, security alerts, lead
// notifications) and customer emails to leads (booking confirmation, reminder, changes).
//
// Each email goes out as HTML plus a plain-text copy (multipart/alternative): mail apps show the
// designed version, phone notifications and text-only clients show the text one.
// Deliverability rules followed here:
//  - no images and no web fonts (graphics are drawn with tables and CSS), so it renders the same
//    with images turned off; admin emails have no links at all (nothing that looks like phishing),
//    customer emails only have their action buttons (add to calendar, reschedule, cancel)
//  - table layout with inline styles (the only thing Outlook and Gmail both render reliably)
//  - the subject carries the important bit (the code), so it shows in notifications
//  - every value is HTML-escaped (user agents and typed emails come from whoever is signing in)

/** Byte Bun brand colors (same tokens as frontend/src/index.css), and where emails use them. */
export const EMAIL_COLORS = {
  bytePurple: '#331165', // header background, code digits, headings accent
  bunOrange: '#FFA612', // accent bar under the header
  midnightPlum: '#1A0A33', // headings and strong text
  muted: '#4A3B63', // body text
  softViolet: '#6B4FBF', // labels, code panel border, info callouts
  lavenderMist: '#EDE7F8', // code panel and info callout background
  creamDough: '#FFF8EC', // page background around the card
  line: '#D9CFEE', // card border and table dividers
  white: '#FFFFFF', // card background, header text
  honeyGold: '#EDB330', // warning callout border
  goldTint: '#FBEFC8', // warning callout background
  goldText: '#5C4300', // warning callout text (7:1 on goldTint)
  danger: '#B42318', // urgent callout border and label
  dangerTint: '#FDECEA', // urgent callout background
  circuitTeal: '#14B8A6', // "all good" label (successful sign-in)
} as const;

const C = EMAIL_COLORS;
const FONT = "'Plus Jakarta Sans', 'Segoe UI', Helvetica, Arial, sans-serif";
const MONO = "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace";

export type Tone = 'info' | 'success' | 'warning' | 'danger';

export interface EmailContent {
  /** Shown in the inbox list next to the subject (hidden in the body). */
  preheader: string;
  /** Small label above the title, e.g. "Sign-in code" or "Security alert". */
  label: string;
  /** Color of the label. */
  tone?: Tone;
  title: string;
  /** Paragraphs before the code/details. */
  intro?: string[];
  /** A one-time code, shown big. */
  code?: string;
  /** Text under the code, e.g. "Expires in 5 minutes". */
  codeNote?: string;
  /** Label/value rows (time, IP, location, browser, ...). */
  details?: [string, string][];
  /** A highlighted box (advice, warnings). */
  callout?: { tone: Tone; title?: string; text: string };
  /** Paragraphs after everything else. */
  outro?: string[];
  /** Small print in the footer, under the brand name. */
  footer?: string;

  // ---- Customer emails (to leads) ----
  /** 'admin' (default): "Byte Bun Admin" branding, no links. 'customer': "Byte Bun Tech" branding, may have buttons. */
  audience?: 'admin' | 'customer';
  /** A colored band at the top with a round badge (e.g. ✓) and a headline. */
  hero?: { badge: string; title: string; subtitle?: string; tone?: 'brand' | 'muted' };
  /** A tear-off calendar page graphic with the date, plus the time next to it. */
  event?: { month: string; day: string; weekday: string; label: string; time: string; sub: string; struck?: boolean };
  /** Buttons (customer emails only). `primary` buttons are full width. */
  actions?: { title?: string; buttons: { label: string; href: string; primary?: boolean }[]; note?: string }[];
  /** Numbered steps, e.g. "What we'll cover". */
  steps?: { title: string; items: { title: string; text: string }[] };
}

export interface RenderedEmail {
  html: string;
  text: string;
}

export const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const toneColors: Record<Tone, { bg: string; border: string; text: string; label: string }> = {
  info: { bg: C.lavenderMist, border: C.softViolet, text: C.midnightPlum, label: C.softViolet },
  success: { bg: C.lavenderMist, border: C.circuitTeal, text: C.midnightPlum, label: '#0F766E' },
  warning: { bg: C.goldTint, border: C.honeyGold, text: C.goldText, label: C.goldText },
  danger: { bg: C.dangerTint, border: C.danger, text: '#7A1A12', label: C.danger },
};

const p = (text: string) =>
  `<p style="margin:0 0 16px;font-family:${FONT};font-size:15px;line-height:24px;color:${C.muted};">${escapeHtml(text)}</p>`;

export function renderEmail(content: EmailContent): RenderedEmail {
  const tone = toneColors[content.tone ?? 'info'];
  const e = escapeHtml;

  const codeBlock = content.code
    ? `
          <tr><td style="padding:8px 0 24px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.lavenderMist};border:1px solid ${C.softViolet};border-radius:12px;">
              <tr><td align="center" style="padding:24px 16px 8px;font-family:${MONO};font-size:36px;line-height:44px;font-weight:700;letter-spacing:10px;color:${C.bytePurple};">${e(content.code)}</td></tr>
              ${content.codeNote ? `<tr><td align="center" style="padding:0 16px 20px;font-family:${FONT};font-size:13px;line-height:20px;color:${C.muted};">${e(content.codeNote)}</td></tr>` : '<tr><td style="padding:0 0 16px;"></td></tr>'}
            </table>
          </td></tr>`
    : '';

  const detailsBlock = content.details?.length
    ? `
          <tr><td style="padding:0 0 24px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${C.line};">
              ${content.details
                .map(
                  ([k, v]) => `
              <tr>
                <td valign="top" style="padding:10px 12px 10px 0;border-bottom:1px solid ${C.line};font-family:${FONT};font-size:12px;line-height:20px;font-weight:700;letter-spacing:0.6px;text-transform:uppercase;color:${C.softViolet};white-space:nowrap;width:96px;">${e(k)}</td>
                <td valign="top" style="padding:10px 0;border-bottom:1px solid ${C.line};font-family:${FONT};font-size:14px;line-height:20px;color:${C.midnightPlum};word-break:break-word;">${e(v)}</td>
              </tr>`,
                )
                .join('')}
            </table>
          </td></tr>`
    : '';

  const callout = content.callout;
  const calloutColors = callout ? toneColors[callout.tone] : null;
  const calloutBlock =
    callout && calloutColors
      ? `
          <tr><td style="padding:0 0 24px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${calloutColors.bg};border-left:4px solid ${calloutColors.border};border-radius:8px;">
              <tr><td style="padding:16px 18px;font-family:${FONT};font-size:14px;line-height:22px;color:${calloutColors.text};">
                ${callout.title ? `<strong style="display:block;margin:0 0 4px;color:${calloutColors.text};">${e(callout.title)}</strong>` : ''}${e(callout.text)}
              </td></tr>
            </table>
          </td></tr>`
      : '';

  const customer = content.audience === 'customer';
  const brand = customer ? 'Byte Bun Tech' : 'Byte Bun Admin';
  const headerNote = customer ? 'Web &amp; automation studio' : 'Admin';
  const footer = content.footer ?? (customer ? '' : 'Sent automatically by the Byte Bun admin site to its administrators. Please do not reply.');

  const hero = content.hero;
  const heroBlock = hero
    ? `
        <tr><td bgcolor="${hero.tone === 'muted' ? C.muted : C.bytePurple}" style="background:${hero.tone === 'muted' ? C.muted : C.bytePurple};background-image:linear-gradient(135deg,${hero.tone === 'muted' ? `${C.muted} 0%,${C.midnightPlum} 100%` : `${C.bytePurple} 0%,${C.softViolet} 100%`});padding:36px 32px 32px;text-align:center;">
          <table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:0 auto 16px;"><tr>
            <td width="64" height="64" align="center" valign="middle" style="width:64px;height:64px;border-radius:32px;background:${C.bunOrange};font-family:${FONT};font-size:32px;line-height:64px;font-weight:800;color:${C.midnightPlum};">${e(hero.badge)}</td>
          </tr></table>
          <div style="font-family:${FONT};font-size:26px;line-height:34px;font-weight:800;color:${C.white};">${e(hero.title)}</div>
          ${hero.subtitle ? `<div style="margin-top:8px;font-family:${FONT};font-size:15px;line-height:22px;color:${C.lavenderMist};">${e(hero.subtitle)}</div>` : ''}
        </td></tr>`
    : '';

  const ev = content.event;
  const eventBlock = ev
    ? `
          <tr><td style="padding:4px 0 24px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid ${C.line};border-radius:14px;overflow:hidden;background:${C.white};">
              <tr>
                <td width="112" align="center" valign="top" style="width:112px;border-right:1px solid ${C.line};background:${C.creamDough};">
                  <div style="background:${C.bunOrange};padding:7px 0;font-family:${FONT};font-size:12px;line-height:16px;font-weight:800;letter-spacing:2px;text-transform:uppercase;color:${C.midnightPlum};">${e(ev.month)}</div>
                  <div style="padding:8px 0 0;font-family:${FONT};font-size:44px;line-height:50px;font-weight:800;color:${ev.struck ? C.muted : C.bytePurple};${ev.struck ? 'text-decoration:line-through;' : ''}">${e(ev.day)}</div>
                  <div style="padding:0 0 12px;font-family:${FONT};font-size:11px;line-height:16px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:${C.muted};">${e(ev.weekday)}</div>
                </td>
                <td valign="middle" style="padding:16px 20px;">
                  <div style="font-family:${FONT};font-size:12px;line-height:16px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:${C.softViolet};">${e(ev.label)}</div>
                  <div style="padding:4px 0;font-family:${FONT};font-size:21px;line-height:28px;font-weight:800;color:${C.midnightPlum};${ev.struck ? 'text-decoration:line-through;' : ''}">${e(ev.time)}</div>
                  <div style="font-family:${FONT};font-size:14px;line-height:20px;color:${C.muted};">${e(ev.sub)}</div>
                </td>
              </tr>
            </table>
          </td></tr>`
    : '';

  const button = (b: { label: string; href: string; primary?: boolean }) =>
    `<a href="${e(b.href)}" target="_blank" style="display:block;padding:12px 14px;border-radius:10px;font-family:${FONT};font-size:14px;line-height:20px;font-weight:700;text-align:center;text-decoration:none;${
      b.primary ? `background:${C.bytePurple};color:${C.white};border:2px solid ${C.bytePurple};` : `background:${C.white};color:${C.bytePurple};border:2px solid ${C.line};`
    }">${e(b.label)}</a>`;
  const actionsBlock = customer
    ? (content.actions ?? [])
        .map((group) => {
          const primary = group.buttons.filter((b) => b.primary);
          const others = group.buttons.filter((b) => !b.primary);
          const rows: string[] = [];
          for (const b of primary) rows.push(`<tr><td colspan="2" style="padding:0 0 10px;">${button(b)}</td></tr>`);
          for (let i = 0; i < others.length; i += 2) {
            rows.push(
              `<tr><td width="50%" style="padding:0 5px 10px 0;">${button(others[i])}</td><td width="50%" style="padding:0 0 10px 5px;">${others[i + 1] ? button(others[i + 1]) : ''}</td></tr>`,
            );
          }
          return `
          <tr><td style="padding:0 0 18px;">
            ${group.title ? `<div style="padding:0 0 10px;font-family:${FONT};font-size:12px;line-height:16px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:${C.softViolet};">${e(group.title)}</div>` : ''}
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows.join('')}</table>
            ${group.note ? `<div style="font-family:${FONT};font-size:12px;line-height:18px;color:${C.muted};">${e(group.note)}</div>` : ''}
          </td></tr>`;
        })
        .join('')
    : '';

  const steps = content.steps;
  const stepsBlock = steps
    ? `
          <tr><td style="padding:4px 0 24px;">
            <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.creamDough};border-radius:14px;">
              <tr><td colspan="2" style="padding:18px 20px 6px;font-family:${FONT};font-size:16px;line-height:22px;font-weight:800;color:${C.midnightPlum};">${e(steps.title)}</td></tr>
              ${steps.items
                .map(
                  (s, i) => `
              <tr>
                <td width="48" valign="top" style="width:48px;padding:10px 0 10px 20px;">
                  <div style="width:30px;height:30px;border-radius:15px;background:${C.bytePurple};font-family:${FONT};font-size:14px;line-height:30px;font-weight:800;text-align:center;color:${C.white};">${i + 1}</div>
                </td>
                <td valign="top" style="padding:10px 20px 10px 8px;font-family:${FONT};">
                  <div style="font-size:15px;line-height:22px;font-weight:700;color:${C.midnightPlum};">${e(s.title)}</div>
                  <div style="font-size:14px;line-height:21px;color:${C.muted};">${e(s.text)}</div>
                </td>
              </tr>`,
                )
                .join('')}
              <tr><td colspan="2" style="height:10px;line-height:10px;font-size:0;">&nbsp;</td></tr>
            </table>
          </td></tr>`
    : '';

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${e(content.title)}</title>
</head>
<body style="margin:0;padding:0;background:${C.creamDough};-webkit-text-size-adjust:100%;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${C.creamDough};">${e(content.preheader)}&#8199;&#65279;&#847;&#8199;&#65279;&#847;&#8199;&#65279;&#847;</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.creamDough};">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:${C.white};border:1px solid ${C.line};border-radius:16px;overflow:hidden;">
        <tr><td style="background:${C.bytePurple};padding:22px 32px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
            <td style="font-family:${FONT};font-size:20px;line-height:28px;font-weight:800;color:${C.white};letter-spacing:-0.2px;">Byte Bun<span style="color:${C.bunOrange};">.</span></td>
            <td align="right" style="font-family:${FONT};font-size:12px;line-height:28px;font-weight:600;letter-spacing:1.2px;text-transform:uppercase;color:${C.lavenderMist};">${headerNote}</td>
          </tr></table>
        </td></tr>
        <tr><td style="background:${C.bunOrange};height:4px;line-height:4px;font-size:0;">&nbsp;</td></tr>${heroBlock}
        <tr><td style="padding:32px 32px 8px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="padding:0 0 8px;font-family:${FONT};font-size:12px;line-height:16px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:${tone.label};">${e(content.label)}</td></tr>
            <tr><td style="padding:0 0 16px;font-family:${FONT};font-size:24px;line-height:32px;font-weight:800;color:${C.midnightPlum};">${e(content.title)}</td></tr>
            ${content.intro?.length ? `<tr><td>${content.intro.map(p).join('')}</td></tr>` : ''}${eventBlock}${codeBlock}${actionsBlock}${detailsBlock}${stepsBlock}${calloutBlock}
            ${content.outro?.length ? `<tr><td>${content.outro.map(p).join('')}</td></tr>` : ''}
          </table>
        </td></tr>
        <tr><td style="padding:20px 32px 28px;border-top:1px solid ${C.line};background:${C.white};">
          <p style="margin:0 0 4px;font-family:${FONT};font-size:13px;line-height:20px;font-weight:700;color:${C.bytePurple};">${brand}</p>
          ${footer ? `<p style="margin:0;font-family:${FONT};font-size:12px;line-height:18px;color:${C.muted};">${e(footer)}</p>` : ''}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return { html, text: renderText(content) };
}

/** The plain-text copy: same content, readable in notifications and text-only clients. */
function renderText(c: EmailContent): string {
  const customer = c.audience === 'customer';
  const lines: string[] = [`${customer ? 'BYTE BUN TECH' : 'BYTE BUN ADMIN'} · ${c.label.toUpperCase()}`, ''];
  if (c.hero) lines.push(c.hero.title, ...(c.hero.subtitle ? [c.hero.subtitle] : []), '');
  lines.push(c.title, '');
  for (const para of c.intro ?? []) lines.push(para, '');
  if (c.event) lines.push(`${c.event.label}: ${c.event.weekday}, ${c.event.month} ${c.event.day} · ${c.event.time}`, c.event.sub, '');
  if (c.code) {
    lines.push(c.code, '');
    if (c.codeNote) lines.push(c.codeNote, '');
  }
  if (customer) {
    for (const group of c.actions ?? []) {
      if (group.title) lines.push(group.title);
      for (const b of group.buttons) lines.push(`${b.label}: ${b.href}`);
      if (group.note) lines.push(group.note);
      lines.push('');
    }
  }
  if (c.details?.length) {
    for (const [k, v] of c.details) lines.push(`${k}: ${v}`);
    lines.push('');
  }
  if (c.steps) {
    lines.push(c.steps.title);
    c.steps.items.forEach((s, i) => lines.push(`${i + 1}. ${s.title}: ${s.text}`));
    lines.push('');
  }
  if (c.callout) {
    if (c.callout.title) lines.push(c.callout.title);
    lines.push(c.callout.text, '');
  }
  for (const para of c.outro ?? []) lines.push(para, '');
  const footer = c.footer ?? (customer ? '' : 'Sent automatically by the Byte Bun admin site to its administrators. Please do not reply.');
  lines.push('—', customer ? 'Byte Bun Tech' : 'Byte Bun Admin', ...(footer ? [footer] : []));
  return lines.join('\n');
}
