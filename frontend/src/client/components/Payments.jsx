import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { fmtBytes } from '../lib/upload.js';
import { Button, Dialog, Icon, ICONS } from '../ui.jsx';

// Paid events: how to pay (the event's payment channels), the proof-of-payment picker, and the
// file viewer the business uses to check a proof.

const copyText = async (text, what) => {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(`${what} copied`);
  } catch {
    toast.error('Couldn’t copy. Please copy it by hand.');
  }
};

const BANK_ICON = 'M3 10l9-6 9 6M5 10v8M19 10v8M9 10v8M15 10v8M3 20h18';
const WALLET_ICON = 'M4 7a2 2 0 012-2h11a1 1 0 011 1v2M4 7v10a2 2 0 002 2h13a1 1 0 001-1v-3M4 7h15a1 1 0 011 1v3m0 4h-4a2 2 0 010-4h4m0 4v-4';

/** "0012 3456 7890" -> "•••• 7890" for the card face (the full number is a tap away). */
const masked = (n) => {
  const digits = n.replace(/\s/g, '');
  return digits.length > 6 ? `•••• ${digits.slice(-4)}` : n;
};

/**
 * The payment channels as cards, like the ones in a wallet. QR codes stay hidden until tapped
 * (then shown big in a modal, ready to scan or save); bank cards flip open to the full details
 * with copy buttons. `onPick` tells the form which one the attendee is using.
 */
export function PaymentChannelsView({ channels, picked, onPick }) {
  const [open, setOpen] = useState(null);
  if (!channels?.length) return null;
  const choose = (c) => {
    onPick?.(c.id);
    setOpen(c);
  };
  return (
    <>
      <div className="grid gap-3 desktop:grid-cols-2">
        {channels.map((c, i) => {
          const qr = c.type === 'qr' && c.qrUrl;
          const isPicked = picked === c.id;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => choose(c)}
              aria-label={qr ? `Show the ${c.label} QR code` : `Show the ${c.label} bank details`}
              className={`group relative isolate flex min-h-36 cursor-pointer flex-col justify-between overflow-hidden rounded-2xl p-4 text-left text-white shadow-md transition duration-300 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand/40 motion-safe:hover:-translate-y-1 motion-safe:hover:shadow-xl ${isPicked ? 'ring-4 ring-brand/50' : ''}`}
              style={{
                // Each card its own shade of the business's color.
                background: `linear-gradient(135deg, color-mix(in oklab, var(--color-brand) ${100 - i * 12}%, #0b1020), color-mix(in oklab, var(--color-brand) ${55 - i * 8}%, #000))`,
              }}
            >
              {/* Light and shapes, like a card's foil. */}
              <span aria-hidden="true" className="pointer-events-none absolute -top-10 -right-10 -z-10 size-36 rounded-full bg-white/15 blur-sm transition-transform duration-500 motion-safe:group-hover:scale-125" />
              <span aria-hidden="true" className="pointer-events-none absolute -bottom-14 -left-8 -z-10 size-32 rounded-full bg-black/15" />
              <span aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 -translate-x-full bg-linear-to-r from-transparent via-white/20 to-transparent transition-transform duration-700 motion-safe:group-hover:translate-x-full" />

              <span className="flex items-start justify-between gap-2">
                <span className="grid size-10 place-items-center rounded-xl bg-white/20 backdrop-blur-sm">
                  <Icon d={qr ? WALLET_ICON : BANK_ICON} className="size-5" />
                </span>
                <span className="rounded-full bg-white/20 px-2.5 py-1 text-[11px] font-bold tracking-wider uppercase">{qr ? 'Scan to pay' : 'Bank transfer'}</span>
              </span>

              <span className="mt-4 block">
                <span className="block text-lg leading-tight font-bold">{c.label}</span>
                {c.bankName && <span className="block text-sm text-white/80">{c.bankName}</span>}
                {c.accountNumber && <span className="mt-1 block font-mono text-base tracking-[0.15em] text-white/90">{masked(c.accountNumber)}</span>}
              </span>

              <span className="mt-3 flex items-center justify-between gap-2 text-sm font-semibold">
                <span className="truncate text-white/80">{c.accountName ?? ''}</span>
                <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-xs font-bold text-ink shadow-sm transition motion-safe:group-hover:scale-105">
                  <Icon d={qr ? ICONS.qr : ICONS.eye} className="size-3.5" />
                  {qr ? 'Show QR code' : 'Show details'}
                </span>
              </span>
            </button>
          );
        })}
      </div>
      {open && <ChannelModal channel={open} onClose={() => setOpen(null)} />}
    </>
  );
}

/** One channel, big: the QR code to scan or save, or the bank details to copy. */
function ChannelModal({ channel: c, onClose }) {
  const qr = c.type === 'qr' && c.qrUrl;
  const row = (label, value, copyAs) =>
    value ? (
      <div className="flex items-center justify-between gap-3 border-b border-line py-2.5 last:border-0">
        <div className="min-w-0">
          <p className="text-xs font-semibold tracking-wide text-faint uppercase">{label}</p>
          <p className={`truncate text-ink ${copyAs ? 'font-mono text-lg tracking-wide' : 'font-medium'}`}>{value}</p>
        </div>
        {copyAs && (
          <Button size="sm" variant="secondary" onClick={() => copyText(value.replace(/\s/g, ''), copyAs)}>
            Copy
          </Button>
        )}
      </div>
    ) : null;
  return (
    <Dialog open onClose={onClose} title={c.label} footer={<Button onClick={onClose}>Done</Button>}>
      {qr ? (
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="rounded-2xl bg-white p-3 shadow-inner ring-1 ring-line motion-safe:animate-rise">
            <img src={c.qrUrl} alt={`${c.label} QR code`} className="size-64 max-w-full object-contain mobile:size-56" />
          </div>
          <p className="text-sm text-muted">Open your e-wallet or banking app and scan this code. On this phone? Save the image and upload it in your app.</p>
          <a href={c.qrUrl} download={`${c.label.replace(/[^\w-]+/g, '-')}-qr.webp`} className="inline-flex items-center gap-1.5 text-sm font-semibold text-brand underline">
            Save the QR image
          </a>
        </div>
      ) : (
        <p className="mb-2 text-sm text-muted">Transfer the amount to this account, then come back for the next step.</p>
      )}
      <div className={qr ? 'mt-4' : ''}>
        {row('Bank', c.bankName)}
        {row('Account name', c.accountName)}
        {row(qr ? 'Number' : 'Account number', c.accountNumber, 'Account number')}
      </div>
    </Dialog>
  );
}

/** A file input with a clear "chosen file" row (and a preview for images). */
export function FilePicker({ id, accept, file, onChange, label = 'Choose a file', hint, error, disabled }) {
  const input = useRef(null);
  const [preview, setPreview] = useState(null);
  useEffect(() => {
    if (!file || !file.type.startsWith('image/')) return setPreview(null);
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  return (
    <div>
      <input
        ref={input}
        id={id}
        type="file"
        accept={accept}
        className="sr-only"
        disabled={disabled}
        aria-invalid={!!error}
        onChange={(e) => {
          onChange(e.target.files?.[0] ?? null);
          e.target.value = '';
        }}
      />
      {file ? (
        <div className={`flex items-center gap-3 rounded-card border bg-surface p-3 ${error ? 'border-danger' : 'border-line'}`}>
          {preview ? <img src={preview} alt="" className="size-14 shrink-0 rounded-lg border border-line object-cover" /> : <span className="grid size-14 shrink-0 place-items-center rounded-lg bg-sunken text-xs font-bold text-muted">PDF</span>}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{file.name}</p>
            <p className="text-xs text-muted">{fmtBytes(file.size)}</p>
          </div>
          <Button size="sm" variant="ghost" disabled={disabled} onClick={() => input.current?.click()}>
            Change
          </Button>
        </div>
      ) : (
        <button
          type="button"
          disabled={disabled}
          onClick={() => input.current?.click()}
          className={`flex w-full cursor-pointer flex-col items-center gap-1 rounded-card border-2 border-dashed px-4 py-6 text-center hover:border-brand hover:bg-brand-soft/40 ${error ? 'border-danger' : 'border-line-strong'}`}
        >
          <Icon d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 001 1h14a1 1 0 001-1v-3" className="size-6 text-brand" />
          <span className="text-sm font-semibold text-ink">{label}</span>
          {hint && <span className="text-xs text-muted">{hint}</span>}
        </button>
      )}
      {error && <p className="mt-1.5 text-[13px] text-danger">{error}</p>}
    </div>
  );
}

/** The business's viewer for a proof of payment: images and PDFs, in a modal. */
export function FileViewer({ open, onClose, url, type, title, footer }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  if (!open) return null;
  const pdf = type === 'application/pdf';
  return (
    <Dialog open onClose={onClose} wide title={title} footer={footer ?? <Button onClick={onClose}>Close</Button>}>
      <div className="overflow-hidden rounded-lg border border-line bg-sunken">
        {failed ? (
          <p className="px-4 py-10 text-center text-sm text-muted">The file couldn’t be shown here. It may have been deleted (proofs are deleted once approved).</p>
        ) : pdf ? (
          <iframe src={url} title={title} className="h-[70vh] w-full bg-white" />
        ) : (
          <img src={url} alt={title} onError={() => setFailed(true)} className="mx-auto max-h-[70vh] w-auto object-contain" />
        )}
      </div>
      <a href={url} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-brand underline">
        <Icon d={ICONS.external} className="size-4" /> Open in a new tab
      </a>
    </Dialog>
  );
}
