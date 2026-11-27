// A consolidated PDF of check-in QR codes (bulk bookings: every place's code in one file), written
// by hand: A4 pages, six codes per page (2 × 3), each with its place number, name and code. The
// QR codes go in as JPEG images (sharp turns the PNGs into JPEGs), the text in Helvetica.
import sharp from 'sharp';
import { checkInQrPng, checkInUrl } from './check-in';

const W = 595.28; // A4, in points
const H = 841.89;

/** PDF text: Latin-1 only (Helvetica's WinAnsi), with ( ) \ escaped. */
const pdfText = (s: string) =>
  s
    .normalize('NFKD')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, '')
    .replace(/([()\\])/g, '\\$1');

export interface QrPdfItem {
  /** "ABCD-EFGH" */
  code: string;
  /** The raw code, for the QR's link. */
  raw: string;
  label: string;
}

export async function qrPdf(bookingsUrl: string, items: QrPdfItem[], heading: { title: string; sub: string }) {
  const images = await Promise.all(
    items.map(async (it) => {
      const png = await checkInQrPng(checkInUrl(bookingsUrl, it.raw));
      const jpg = await sharp(png).flatten({ background: '#ffffff' }).jpeg({ quality: 92 }).toBuffer();
      const meta = await sharp(jpg).metadata();
      return { jpg, w: meta.width ?? 320, h: meta.height ?? 320 };
    }),
  );

  const objects: Buffer[] = [];
  const add = (body: Buffer | string) => {
    objects.push(Buffer.isBuffer(body) ? body : Buffer.from(body, 'latin1'));
    return objects.length; // object number
  };
  // 1 catalog, 2 pages (filled in at the end), 3 font
  add('<< /Type /Catalog /Pages 2 0 R >>');
  add(''); // placeholder for Pages
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');

  const perPage = 6;
  const pageIds: number[] = [];
  for (let p = 0; p * perPage < items.length; p++) {
    const slice = items.slice(p * perPage, p * perPage + perPage);
    const xobjects: string[] = [];
    let content = '';
    // Heading
    content += `BT /F2 16 Tf 40 ${H - 50} Td (${pdfText(heading.title)}) Tj ET\n`;
    content += `BT /F1 10 Tf 40 ${H - 66} Td (${pdfText(heading.sub)}) Tj ET\n`;
    content += `BT /F1 9 Tf 40 ${H - 80} Td (${pdfText(`${items.length} place${items.length === 1 ? '' : 's'} - show one QR code per person at the entrance. Page ${p + 1} of ${Math.ceil(items.length / perPage)}.`)}) Tj ET\n`;
    slice.forEach((it, i) => {
      const n = p * perPage + i;
      const img = images[n];
      const imgId = add(Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${img.w} /Height ${img.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.jpg.length} >>\nstream\n`, 'latin1'), img.jpg, Buffer.from('\nendstream', 'latin1')]));
      const name = `Im${n}`;
      xobjects.push(`/${name} ${imgId} 0 R`);
      const col = i % 2;
      const row = Math.floor(i / 2);
      const cellW = (W - 80) / 2;
      const cellH = 235;
      const x0 = 40 + col * cellW;
      const yTop = H - 100 - row * cellH;
      const size = 160;
      const ix = x0 + (cellW - size) / 2;
      const iy = yTop - size - 8;
      // A light frame around each code
      content += `0.85 G 0.8 w ${x0 + 6} ${yTop - cellH + 14} ${cellW - 12} ${cellH - 12} re S 0 G\n`;
      content += `q ${size} 0 0 ${size} ${ix} ${iy} cm /${name} Do Q\n`;
      content += `BT /F2 18 Tf ${x0 + cellW / 2 - it.code.length * 5.4} ${iy - 24} Td (${pdfText(it.code)}) Tj ET\n`;
      const label = it.label.length > 42 ? `${it.label.slice(0, 41)}...` : it.label;
      content += `BT /F1 10 Tf ${x0 + cellW / 2 - label.length * 2.45} ${iy - 40} Td (${pdfText(label)}) Tj ET\n`;
    });
    const stream = Buffer.from(content, 'latin1');
    const contentId = add(Buffer.concat([Buffer.from(`<< /Length ${stream.length} >>\nstream\n`, 'latin1'), stream, Buffer.from('\nendstream', 'latin1')]));
    const pageId = add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> /XObject << ${xobjects.join(' ')} >> >> /Contents ${contentId} 0 R >>`);
    pageIds.push(pageId);
  }
  objects[1] = Buffer.from(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`, 'latin1');

  const parts: Buffer[] = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1')];
  const offsets: number[] = [];
  let pos = parts[0].length;
  objects.forEach((body, i) => {
    offsets.push(pos);
    const chunk = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`, 'latin1'), body, Buffer.from('\nendobj\n', 'latin1')]);
    parts.push(chunk);
    pos += chunk.length;
  });
  const xref = [`xref\n0 ${objects.length + 1}\n`, '0000000000 65535 f \n', ...offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`)].join('');
  parts.push(Buffer.from(`${xref}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${pos}\n%%EOF\n`, 'latin1'));
  return Buffer.concat(parts);
}
