// The event as one zip: the same data as the other exports (Excel, CSV, JSON) plus every proof of
// payment, in a folder per attendee. Payment channels' QR codes are not included.
//
//   {event}-{date}/
//     README.txt
//     event.xlsx                  Details, Attendees, Claimables, Scanners tabs
//     attendees.csv
//     event.json
//     proofs-of-payment/
//       001 Maria Santos (ABCD-EFGH)/
//         1 approved - receipt.webp
//         2 replaced - screenshot.webp
//
// Used by GET /api/client/bookings/events/:id/export.zip and by the automatic deletion (the
// zip is emailed to the owners and admins before the event and its files are deleted).
import { xlsx } from '../../common/xlsx';
import { zip } from '../../common/zip';
import type { ClientsDb } from '../clients-db';
import { formatCheckInCode } from './check-in';
import { eventCsv, eventExportData, eventSheets } from './events';
import type { PaymentFiles } from './payment-files';

/** Safe in a zip path on Windows, macOS and Linux. */
const safe = (s: string, max = 80) =>
  s
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '')
    .slice(0, max) || 'file';

const OUTCOME: Record<string, string> = { approved: 'approved', rejected: 'rejected', replaced: 'replaced', refunded: 'refunded', expired: 'expired', removed: 'removed' };

export async function eventZip(db: ClientsDb, files: PaymentFiles, orgId: string, eventId: number) {
  const d = await eventExportData(db, orgId, eventId);
  const root = safe(d.file);
  const tickets = await db.eventTicket.findMany({ where: { eventId }, orderBy: { createdAt: 'asc' }, include: { proofs: { orderBy: { id: 'asc' } }, refunds: { orderBy: { id: 'asc' } } } });
  const entries: { name: string; data: Buffer; date?: Date }[] = [];
  let proofCount = 0;
  let missing = 0;
  let n = 0;
  for (const t of tickets) {
    const refundProofs = t.refunds.filter((r) => r.proofFile);
    if (!t.proofs.length && !refundProofs.length) continue;
    n++;
    const folder = `${root}/proofs-of-payment/${String(n).padStart(3, '0')} ${safe(t.name, 60)}${t.code ? ` (${formatCheckInCode(t.code)})` : ''}`;
    let i = 0;
    for (const p of t.proofs) {
      i++;
      const body = await files.read('event-proofs', p.file);
      if (!body) {
        missing++;
        continue;
      }
      const ext = p.file.split('.').pop();
      const base = safe(p.name.replace(/\.[^.]+$/, ''), 60);
      entries.push({ name: `${folder}/${i} ${OUTCOME[p.outcome ?? ''] ?? 'to verify'} - ${base}.${ext}`, data: body, date: p.createdAt });
      proofCount++;
    }
    // Proofs of refund, in the same folder.
    let k = 0;
    for (const r of refundProofs) {
      k++;
      const body = await files.read('event-refund-proofs', r.proofFile);
      if (!body) {
        missing++;
        continue;
      }
      entries.push({ name: `${folder}/refund ${k} - ${r.type}${r.amount ? ` ${safe(r.amount, 20)}` : ''}.${r.proofFile!.split('.').pop()}`, data: body, date: r.createdAt });
      proofCount++;
    }
  }
  const now = new Date();
  const readme = [
    `${d.json.event.title} (${d.json.event.business})`,
    `${d.json.event.date}, ${d.json.event.startTime} – ${d.json.event.endTime} (${d.json.event.timeZone})`,
    '',
    'event.xlsx      Details (with the dashboard numbers), Attendees, Attendance analysis,',
    '                Collections, Refunds, Promo codes (paid events), Claimables and Scanners',
    'attendees.csv   The attendees',
    'event.json      Everything, structured',
    `proofs-of-payment/   ${proofCount} file${proofCount === 1 ? '' : 's'}, a folder per attendee (name and check-in code).`,
    '                Each file is numbered in upload order, with what became of it:',
    '                approved, to verify, replaced, rejected, refunded, expired or removed.',
    '                Proofs of refund sent to them are there too ("refund 1 - full ₱500.pdf").',
    ...(missing ? ['', `${missing} file${missing === 1 ? ' was' : 's were'} missing on the server and couldn’t be included.`] : []),
    '',
    `Exported ${now.toISOString()}`,
  ].join('\r\n');
  const all = [
    { name: `${root}/README.txt`, data: Buffer.from(readme, 'utf8'), date: now },
    {
      name: `${root}/event.xlsx`,
      data: xlsx(eventSheets(d)),
      date: now,
    },
    { name: `${root}/attendees.csv`, data: Buffer.from(eventCsv(d), 'utf8'), date: now },
    { name: `${root}/event.json`, data: Buffer.from(JSON.stringify(d.json, null, 2), 'utf8'), date: now },
    ...entries,
  ];
  return { file: `${root}.zip`, body: zip(all), proofs: proofCount, data: d };
}
