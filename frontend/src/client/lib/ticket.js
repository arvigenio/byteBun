// An event ticket to keep: the event, the attendee, the QR code and its code, drawn on a canvas.
// Saved as a PNG image or a one-page PDF (built here: one JPEG image on a page, no PDF library).
//
//   const canvas = await drawTicket({ businessName, title, when, place, name, code, qrDataUrl, color });
//   downloadPng(canvas, 'ticket.png');   downloadPdf(canvas, 'ticket.pdf');

const W = 1200;
const H = 1700;

const loadImage = (src) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });

/** Wraps `text` into lines no wider than `max` (at most `lines`, the last one ellipsized). */
function wrap(g, text, max, lines) {
  const words = String(text).split(/\s+/);
  const out = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (g.measureText(next).width <= max) line = next;
    else {
      if (line) out.push(line);
      line = w;
    }
  }
  if (line) out.push(line);
  if (out.length > lines) {
    out.length = lines;
    out[lines - 1] = `${out[lines - 1].replace(/\s*\S*$/, '')}…`;
  }
  return out;
}

export async function drawTicket({ businessName, title, when, place, name, code, qrDataUrl, color = '#2563EB' }) {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d');
  const font = (weight, size) => `${weight} ${size}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;

  g.fillStyle = '#FFFFFF';
  g.fillRect(0, 0, W, H);
  // Header band in the business's color.
  g.fillStyle = color;
  g.fillRect(0, 0, W, 300);
  g.fillStyle = '#FFFFFF';
  g.font = font(600, 40);
  g.fillText(businessName, 80, 110, W - 160);
  g.font = font(800, 64);
  wrap(g, title, W - 160, 2).forEach((l, i) => g.fillText(l, 80, 195 + i * 74, W - 160));

  g.fillStyle = '#111827';
  g.font = font(600, 40);
  g.fillText(when, 80, 400, W - 160);
  g.fillStyle = '#4B5563';
  g.font = font(400, 36);
  wrap(g, place, W - 160, 2).forEach((l, i) => g.fillText(l, 80, 460 + i * 46, W - 160));

  // The QR code, centered, in a dashed frame.
  const qr = await loadImage(qrDataUrl);
  const size = 760;
  const x = (W - size) / 2;
  const y = 590;
  g.setLineDash([18, 14]);
  g.strokeStyle = color;
  g.lineWidth = 6;
  g.strokeRect(x - 30, y - 30, size + 60, size + 60);
  g.setLineDash([]);
  g.imageSmoothingEnabled = false;
  g.drawImage(qr, x, y, size, size);

  g.textAlign = 'center';
  g.fillStyle = '#111827';
  g.font = font(800, 76);
  g.fillText(code.split('').join(' '), W / 2, 1480);
  g.fillStyle = '#4B5563';
  g.font = font(600, 40);
  g.fillText(name, W / 2, 1560, W - 160);
  g.font = font(400, 30);
  g.fillStyle = '#9CA3AF';
  g.fillText('Show this QR code at the entrance. If it won’t scan, give them the code.', W / 2, 1630, W - 120);
  return c;
}

function save(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export const downloadPng = (canvas, filename) => canvas.toBlob((b) => b && save(b, filename), 'image/png');

/** A one-page PDF: the canvas as a JPEG (DCTDecode), filling a page of the same proportions. */
export function downloadPdf(canvas, filename) {
  const jpeg = atob(canvas.toDataURL('image/jpeg', 0.92).split(',')[1]);
  const pageW = 360; // points (5 x 7.08 in)
  const pageH = Math.round((pageW * canvas.height) / canvas.width);
  const enc = new TextEncoder();
  const parts = [];
  const offsets = [];
  let length = 0;
  const push = (bytes) => {
    parts.push(bytes);
    length += bytes.length;
  };
  const text = (s) => push(enc.encode(s));
  const binary = (s) => push(Uint8Array.from(s, (ch) => ch.charCodeAt(0)));
  const object = (n, body) => {
    offsets[n] = length;
    text(`${n} 0 obj\n${body}\nendobj\n`);
  };

  text('%PDF-1.4\n%âãÏÓ\n');
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  object(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageW} ${pageH}] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>`);
  const content = `q ${pageW} 0 0 ${pageH} 0 0 cm /Im0 Do Q`;
  object(4, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  offsets[5] = length;
  text(`5 0 obj\n<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
  binary(jpeg);
  text('\nendstream\nendobj\n');
  const xref = length;
  text(`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`);
  text(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  save(new Blob(parts, { type: 'application/pdf' }), filename);
}
