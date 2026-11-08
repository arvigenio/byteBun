import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

/** The QR code for `text` as an image data URL, drawn in the browser (the secret never leaves it). */
export function useQrCode(text) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let live = true;
    if (!text) return undefined;
    QRCode.toDataURL(text, { margin: 1, width: 220, errorCorrectionLevel: 'M', color: { dark: '#1A0A33', light: '#FFFFFF' } })
      .then((url) => live && setSrc(url))
      .catch(() => live && setSrc(''));
    return () => {
      live = false;
    };
  }, [text]);
  return src;
}
