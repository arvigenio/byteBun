import { toast } from 'sonner';
import { useQrCode } from '../../hooks/admin/useQrCode.js';
import { Badge, Button, Dialog, Icon, ICONS } from '../ui.jsx';

// A registration's check-in codes, kept out of the list: one per spot (a bulk booking has a code
// and a QR code for each of its spots), each with its QR code, copyable.

const STATUS = {
  confirmed: ['ok', 'Confirmed'],
  pending: ['neutral', 'Not used yet'],
  reserved: ['neutral', 'Reserved'],
  waitlist: ['neutral', 'Waitlist'],
  review: ['warn', 'For verification'],
  rejected: ['danger', 'Waiting for a new proof'],
  revoked: ['danger', 'Revoked'],
  cancelled: ['neutral', 'Cancelled'],
};

const scanUrl = (code) => `${window.location.origin}/app/scan?code=${code.replace(/-/g, '')}`;

function CodeCard({ t, n, total, online, paid }) {
  const qr = useQrCode(online ? null : scanUrl(t.code));
  const [tone, label] = t.status === 'confirmed' && paid ? ['ok', 'Verified'] : (STATUS[t.status] ?? ['neutral', t.status]);
  const copy = () => navigator.clipboard?.writeText(t.code).then(() => toast.success(`Code ${t.code} copied`));
  return (
    <li className="flex items-center gap-4 rounded-card border border-line p-3">
      {!online && (qr ? <img src={qr} alt={`QR code for ${t.code}`} className="size-24 shrink-0 rounded-md border border-line bg-white p-1" /> : <span className="size-24 shrink-0 rounded-md bg-sunken" aria-hidden />)}
      <div className="min-w-0 flex-1">
        {total > 1 && <p className="text-xs font-semibold uppercase tracking-wide text-faint">Spot {n} of {total}</p>}
        <p className="font-mono text-lg font-semibold tracking-wider text-ink">{t.code}</p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <Badge tone={tone}>{label}</Badge>
          {t.checkedInAt && <Badge tone="ok">Admitted</Badge>}
        </div>
      </div>
      <Button variant="ghost" size="sm" onClick={copy}>
        Copy
      </Button>
    </li>
  );
}

export function TicketCodesDialog({ e, t, spots = [t], onClose }) {
  const online = e.format === 'online';
  const copyAll = () => navigator.clipboard?.writeText(spots.map((x) => x.code).join('\n')).then(() => toast.success(`${spots.length} codes copied`));
  return (
    <Dialog
      open
      onClose={onClose}
      title={spots.length > 1 ? `${t.name}’s codes (${spots.length} spots)` : `${t.name}’s code`}
      footer={
        <>
          {spots.length > 1 && (
            <Button variant="ghost" onClick={copyAll}>
              Copy all codes
            </Button>
          )}
          <Button onClick={onClose}>Done</Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-muted">
        {spots.length > 1 ? 'Each spot has its own check-in code and QR code.' : 'Their check-in code.'} {online ? 'Online event: nothing to scan.' : 'Scan a QR code or type the code at the entrance.'}
      </p>
      <ul className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto">
        {spots.map((x, i) => (
          <CodeCard key={x.id} t={x} n={i + 1} total={spots.length} online={online} paid={e.kind === 'paid'} />
        ))}
      </ul>
    </Dialog>
  );
}

/** The row's button that opens the codes. */
export function ShowCodesButton({ count, onClick }) {
  return (
    <button type="button" onClick={onClick} className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-line px-2 py-1 text-xs font-semibold text-muted hover:border-line-strong hover:text-ink" title="Show the check-in code">
      <Icon d={ICONS.qr} className="size-3.5" />
      {count > 1 ? `Codes (${count})` : 'Show code'}
    </button>
  );
}
