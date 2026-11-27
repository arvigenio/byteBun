// Uploaded files for paid events, kept on this server (UPLOADS_DIR, config.clients.uploadsDir):
//   event-proofs/      attendees' proofs of payment (image or PDF). Private: only the business
//                      sees them. Deleted when the payment is approved or the registration is
//                      removed (code deleted, re-upload time ran out, event deleted).
//   event-payment-qr/  the business's payment QR codes (public: shown on the event page).
//   event-refund-details/  attendees' QR codes for receiving a refund (private: the business only).
//   plan-proofs/       businesses' proofs of payment for a Byte Bun plan (private: admins only).
//   plan-payment-qr/   Byte Bun's own payment QR codes (shown on the Plan page).
//   chat-files/        team chat attachments (images and PDFs; private to the room's members).
// Files get random names; the type is checked from the file's first bytes, never trusted from
// the browser. An hourly sweep (PaymentReviewJob) deletes files no row points to any more.
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { Inject, Injectable } from '@nestjs/common';
import sharp from 'sharp';
import { ApiError } from '../../common/api-error';
import { APP_CONFIG, type AppConfig } from '../../config/config';
import { logger } from '../../logging/logger';

const execFileAsync = promisify(execFile);

export type UploadKind = 'event-proofs' | 'event-payment-qr' | 'event-refund-details' | 'event-media' | 'event-refund-proofs' | 'plan-proofs' | 'plan-payment-qr' | 'chat-files';

/** What multer hands over (memory storage). */
export interface UploadedFileLike {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
/** Multer options for one file in memory (the size is checked again below, with a clear message). */
export const UPLOAD_OPTIONS = { limits: { fileSize: MAX_UPLOAD_BYTES + 1, files: 1, fields: 20 } };

const NAME_RE = /^[0-9a-f-]{36}\.(pdf|png|jpg|webp)$/;

/** The real type, from the first bytes: JPEG, PNG, WebP or PDF (PDFs only where allowed). */
export function sniff(buf: Buffer, allowPdf: boolean): { type: string; ext: string } | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { type: 'image/jpeg', ext: 'jpg' };
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { type: 'image/png', ext: 'png' };
  if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return { type: 'image/webp', ext: 'webp' };
  if (allowPdf && buf.length >= 5 && buf.subarray(0, 5).toString('latin1') === '%PDF-') return { type: 'application/pdf', ext: 'pdf' };
  return null;
}

/** Proofs: readable receipts and screenshots. QR codes: kept sharp so they still scan. */
const PROOF_IMAGE = { maxSide: 2000, quality: 72 };
const QR_IMAGE = { maxSide: 1200, quality: 90 };

/** Any JPEG/PNG/WebP -> WebP: turned upright (EXIF), at most maxSide pixels, metadata dropped. */
export async function toWebp(buf: Buffer, o: { maxSide: number; quality: number }) {
  return sharp(buf, { failOn: 'error', limitInputPixels: 50_000_000 })
    .rotate()
    .resize({ width: o.maxSide, height: o.maxSide, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: o.quality, effort: 4 })
    .toBuffer();
}

/**
 * Re-writes a PDF smaller with Ghostscript (images downsampled to 150 dpi, "ebook" quality), in a
 * safe mode with a time limit. Keeps the original when Ghostscript isn't installed, fails, or
 * the result isn't smaller.
 */
export async function compressPdf(buf: Buffer): Promise<Buffer> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pdf-'));
  const input = path.join(dir, 'in.pdf');
  const output = path.join(dir, 'out.pdf');
  try {
    await fs.writeFile(input, buf);
    await execFileAsync(
      process.platform === 'win32' ? 'gswin64c' : 'gs',
      ['-dSAFER', '-dBATCH', '-dNOPAUSE', '-dQUIET', '-sDEVICE=pdfwrite', '-dCompatibilityLevel=1.5', '-dPDFSETTINGS=/ebook', '-dDetectDuplicateImages=true', '-dCompressFonts=true', `-sOutputFile=${output}`, input],
      { timeout: 30_000, windowsHide: true },
    );
    const out = await fs.readFile(output);
    return out.length >= 100 && out.length < buf.length && sniff(out, true)?.type === 'application/pdf' ? out : buf;
  } catch (err) {
    logger.warn({ reason: err instanceof Error ? err.message : String(err) }, 'PDF not compressed (kept as uploaded)');
    return buf;
  } finally {
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** A clean original file name, for display only. */
const displayName = (name: string) => name.replace(/[\\/\r\n\t"<>]/g, '_').slice(0, 200) || 'file';

@Injectable()
export class PaymentFiles {
  constructor(@Inject(APP_CONFIG) private readonly cfg: AppConfig) {}

  private dir(kind: UploadKind) {
    return path.join(this.cfg.clients.uploadsDir, kind);
  }

  /** Checks and stores an upload. Throws a friendly 400 for a missing, too big or wrong file. */
  async save(kind: UploadKind, file: UploadedFileLike | undefined, opts: { allowPdf: boolean; field: string; image?: { maxSide: number; quality: number } }) {
    const what = opts.allowPdf ? 'an image (JPG, PNG or WebP) or a PDF' : 'an image (JPG, PNG or WebP)';
    if (!file || !file.size) throw new ApiError(400, { error: 'file_missing', message: `Please choose ${what}.`, fields: { [opts.field]: 'Required.' } });
    if (file.size > MAX_UPLOAD_BYTES) throw new ApiError(400, { error: 'file_too_big', message: 'The file is too big: at most 10 MB, please.', fields: { [opts.field]: 'At most 10 MB.' } });
    const t = sniff(file.buffer, opts.allowPdf);
    const wrongType = () => new ApiError(400, { error: 'file_type', message: `That file type isn’t accepted. Please upload ${what}.`, fields: { [opts.field]: 'Wrong file type.' } });
    if (!t) throw wrongType();
    // Compressed before storing: images become WebP, PDFs are re-written smaller when possible.
    let stored: { body: Buffer; type: string; ext: string };
    if (t.type === 'application/pdf') stored = { body: await compressPdf(file.buffer), type: t.type, ext: 'pdf' };
    else {
      const webp = await toWebp(file.buffer, opts.image ?? (kind === 'event-proofs' || kind === 'plan-proofs' || kind === 'chat-files' ? PROOF_IMAGE : QR_IMAGE)).catch(() => null);
      if (!webp) throw wrongType(); // not a readable image after all
      stored = { body: webp, type: 'image/webp', ext: 'webp' };
    }
    const name = `${randomUUID()}.${stored.ext}`;
    await fs.mkdir(this.dir(kind), { recursive: true });
    await fs.writeFile(path.join(this.dir(kind), name), stored.body, { mode: 0o640 });
    logger.info({ kind, from: { type: t.type, bytes: file.size }, to: { type: stored.type, bytes: stored.body.length } }, 'Upload stored');
    return { file: name, type: stored.type, size: stored.body.length, originalName: displayName(file.originalname) };
  }

  /** Stores a file already checked (e.g. a proof of refund as emailed). */
  async store(kind: UploadKind, body: Buffer, type: string) {
    const ext = type === 'application/pdf' ? 'pdf' : type === 'image/png' ? 'png' : type === 'image/jpeg' ? 'jpg' : 'webp';
    const name = `${randomUUID()}.${ext}`;
    await fs.mkdir(this.dir(kind), { recursive: true });
    await fs.writeFile(path.join(this.dir(kind), name), body, { mode: 0o640 });
    return name;
  }

  /** The file's contents (null when it's gone). */
  async read(kind: UploadKind, name: string | null) {
    if (!name || !NAME_RE.test(name)) return null;
    try {
      return await fs.readFile(path.join(this.dir(kind), name));
    } catch {
      return null;
    }
  }

  /** Deletes files (missing ones are fine). Never throws. */
  async remove(kind: UploadKind, ...names: (string | null | undefined)[]) {
    for (const name of names) {
      if (!name || !NAME_RE.test(name)) continue;
      await fs.rm(path.join(this.dir(kind), name), { force: true }).catch((err: unknown) => logger.warn({ kind, name, reason: err instanceof Error ? err.message : String(err) }, 'Could not delete an uploaded file'));
    }
  }

  /** Deletes files no row points to, older than `minAgeMs` (left behind by cascades). */
  async sweep(kind: UploadKind, referenced: Set<string>, minAgeMs: number, now = Date.now()) {
    let names: string[];
    try {
      names = await fs.readdir(this.dir(kind));
    } catch {
      return 0;
    }
    let removed = 0;
    for (const name of names) {
      if (!NAME_RE.test(name) || referenced.has(name)) continue;
      const stat = await fs.stat(path.join(this.dir(kind), name)).catch(() => null);
      if (!stat || now - stat.mtimeMs < minAgeMs) continue;
      await this.remove(kind, name);
      removed++;
    }
    return removed;
  }
}

/** A payment channel as the business and the event page see it (the QR image by its public URL). */
export const channelRow = (c: { id: number; type: string; label: string; bankName: string | null; accountName: string | null; accountNumber: string | null; qrFile: string | null }) => ({
  id: c.id,
  type: c.type as 'qr' | 'bank',
  label: c.label,
  bankName: c.bankName,
  accountName: c.accountName,
  accountNumber: c.accountNumber,
  qrUrl: c.qrFile ? `/api/public/event-files/qr/${c.qrFile}` : null,
});
