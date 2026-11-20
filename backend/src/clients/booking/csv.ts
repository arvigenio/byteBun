// Every booking of a business as CSV (the business's export and the admin site's). Excel opens
// it as UTF-8 (BOM); cells that look like formulas are neutralized.
import { ApiError } from '../../common/api-error';
import type { ClientsDb } from '../clients-db';
import { dateFromDb, todayIn } from './time';

/** One quoted cell, never read as a formula by spreadsheet apps. */
export const csvCell = (v: string) => {
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return `"${safe.replace(/"/g, '""')}"`;
};

export async function csvFor(db: ClientsDb, organizationId: string) {
  const settings = await db.bookingSettings.findUnique({ where: { organizationId } });
  if (!settings) throw new ApiError(404, { error: 'not_found', message: 'This business has no bookings data.' });
  const rows = await db.booking.findMany({
    where: { organizationId },
    include: { service: { select: { name: true } }, customer: { select: { name: true, email: true, phone: true } } },
    orderBy: { startsAt: 'asc' },
  });
  const tz = settings.timeZone;
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const header = ['Date', 'Time', 'Time zone', 'Service', 'Customer', 'Email', 'Phone', 'Status', 'No-show', 'Note', 'Booked at (UTC)', 'Cancelled by', 'Cancel reason'];
  const lines = rows.map((b) => [
    dateFromDb(b.localDate),
    b.dateOnly ? '' : time.format(b.startsAt),
    tz,
    b.service.name,
    b.customer.name,
    b.customer.email,
    b.customer.phone ?? '',
    b.status,
    b.noShowAt ? 'yes' : '',
    b.note ?? '',
    b.createdAt.toISOString(),
    b.cancelledBy ?? '',
    b.cancelReason ?? '',
  ]);
  const csv = '﻿' + [header, ...lines].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
  return { filename: `bookings-${settings.slug}-${todayIn(tz)}.csv`, csv };
}
