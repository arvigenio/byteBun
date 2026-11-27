// Uploads: images are shrunk to WebP in the browser before sending (faster on mobile data); the
// server converts and compresses again either way (images to WebP, PDFs re-written smaller).

export const MAX_UPLOAD_MB = 10;
export const PROOF_ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf';
export const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp';

/** JPEG/PNG/WebP -> WebP, at most `maxSide` pixels. Anything else (PDFs) is returned as is. */
export async function compressImage(file, { maxSide = 2000, quality = 0.75 } = {}) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || typeof createImageBitmap !== 'function') return file;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', quality));
    // Some browsers can't encode WebP (they return PNG): keep whichever is smaller.
    if (!blob || blob.type !== 'image/webp' || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.webp', { type: 'image/webp' });
  } catch {
    return file;
  }
}

/** Why a picked file can't be sent, or null. */
export function fileProblem(file, { pdf = true } = {}) {
  if (!file) return 'Please choose a file.';
  const ok = pdf ? /^(image\/(jpeg|png|webp)|application\/pdf)$/ : /^image\/(jpeg|png|webp)$/;
  if (!ok.test(file.type)) return pdf ? 'Please choose an image (JPG, PNG or WebP) or a PDF.' : 'Please choose an image (JPG, PNG or WebP).';
  if (file.size > MAX_UPLOAD_MB * 1024 * 1024) return `The file is too big: at most ${MAX_UPLOAD_MB} MB, please.`;
  return null;
}

export const fmtBytes = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
