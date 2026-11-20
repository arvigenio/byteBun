// Reminder rules (booking.settings.reminders): when each reminder goes out and on which channel.
//   Free:  email only, 2 days and/or 1 day before.
//   Paid (feature bookings.custom_reminders): up to 3, from 30 days down to 1 hour before;
//         WhatsApp needs feature bookings.whatsapp.
// The plan is checked when saving AND when queueing/sending, so a downgrade quietly falls back to
// what the new plan allows.
import { type Entitlements, hasFeature } from '../entitlements';

export interface ReminderRule {
  offsetMinutes: number;
  channel: 'email' | 'whatsapp';
}

export const FREE_OFFSETS = [2880, 1440];
export const MIN_OFFSET = 60;
export const MAX_OFFSET = 30 * 24 * 60;
export const MAX_REMINDERS = 3;

export function parseReminders(v: unknown): ReminderRule[] {
  if (!Array.isArray(v)) return [];
  const out: ReminderRule[] = [];
  for (const r of v) {
    const offset = Number((r as ReminderRule)?.offsetMinutes);
    const channel = (r as ReminderRule)?.channel === 'whatsapp' ? 'whatsapp' : 'email';
    if (Number.isInteger(offset) && offset >= MIN_OFFSET && offset <= MAX_OFFSET && !out.some((x) => x.offsetMinutes === offset)) out.push({ offsetMinutes: offset, channel });
  }
  return out.sort((a, b) => b.offsetMinutes - a.offsetMinutes).slice(0, MAX_REMINDERS);
}

/** What the plan allows of the saved rules (used when queueing). */
export function allowedReminders(rules: ReminderRule[], e: Entitlements): ReminderRule[] {
  if (!hasFeature(e, 'bookings.custom_reminders')) {
    return rules.filter((r) => FREE_OFFSETS.includes(r.offsetMinutes)).map((r) => ({ ...r, channel: 'email' as const }));
  }
  return rules.map((r) => (r.channel === 'whatsapp' && !hasFeature(e, 'bookings.whatsapp') ? { ...r, channel: 'email' as const } : r));
}

/** Why the plan refuses these rules when saving, or null. */
export function planProblem(rules: ReminderRule[], e: Entitlements): string | null {
  if (!hasFeature(e, 'bookings.custom_reminders')) {
    if (rules.some((r) => !FREE_OFFSETS.includes(r.offsetMinutes))) return 'The free plan has reminders 1 day and/or 2 days before. Upgrade for custom times.';
    if (rules.some((r) => r.channel !== 'email')) return 'WhatsApp reminders are on paid plans.';
  }
  if (rules.some((r) => r.channel === 'whatsapp') && !hasFeature(e, 'bookings.whatsapp')) return 'WhatsApp reminders are on paid plans.';
  return null;
}

/** "1 day before", "2 hours before", ... */
export function offsetLabel(min: number) {
  if (min % 1440 === 0) return `${min / 1440} day${min === 1440 ? '' : 's'} before`;
  if (min % 60 === 0) return `${min / 60} hour${min === 60 ? '' : 's'} before`;
  return `${min} minutes before`;
}
