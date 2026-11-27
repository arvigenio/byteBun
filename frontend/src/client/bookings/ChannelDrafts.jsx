import { useEffect, useState } from 'react';
import { FilePicker } from '../components/Payments.jsx';
import { compressImage, fileProblem, IMAGE_ACCEPT, MAX_UPLOAD_MB } from '../lib/upload.js';
import { Badge, Button, Dialog, Field, Icon, IconButton, ICONS, Input } from '../ui.jsx';

// The event creator's payment channels, before the event exists: kept here (QR images in memory),
// then uploaded one by one right after the event is created (EventWizard).

export const MAX_DRAFT_CHANNELS = 4;
const BANK_ICON = 'M3 10l9-6 9 6M5 10v8M19 10v8M9 10v8M15 10v8M3 20h18';

/** Shown while the image file is only in the browser. */
function Preview({ file, className }) {
  const [url, setUrl] = useState(null);
  useEffect(() => {
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  return url ? <img src={url} alt="" className={className} /> : null;
}

/** The list (up to 4) with add, edit and remove. */
export function ChannelDrafts({ drafts, onChange, error }) {
  const [editing, setEditing] = useState(null); // null | 'new' | index
  const save = (d) => {
    onChange(editing === 'new' ? [...drafts, d] : drafts.map((x, i) => (i === editing ? d : x)));
    setEditing(null);
  };
  return (
    <div className="flex flex-col gap-3">
      {drafts.length > 0 && (
        <ul className="grid gap-3 desktop:grid-cols-2">
          {drafts.map((c, i) => (
            <li key={i} className="flex gap-3 rounded-card border border-line p-3">
              {c.type === 'qr' && c.file ? (
                <Preview file={c.file} className="size-16 shrink-0 rounded-lg border border-line bg-white object-contain p-1" />
              ) : (
                <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">
                  <Icon d={BANK_ICON} className="size-6" />
                </span>
              )}
              <div className="min-w-0 flex-1 text-sm">
                <p className="flex items-center gap-1.5 font-semibold">
                  {c.label} <Badge>{c.type === 'qr' ? 'QR code' : 'Bank'}</Badge>
                </p>
                {c.bankName && <p className="text-muted">{c.bankName}</p>}
                {c.accountName && <p className="text-muted">{c.accountName}</p>}
                {c.accountNumber && <p className="font-mono text-[13px]">{c.accountNumber}</p>}
              </div>
              <div className="flex shrink-0 flex-col gap-0.5">
                <IconButton icon={ICONS.pencil} label={`Edit ${c.label}`} onClick={() => setEditing(i)} />
                <IconButton icon={ICONS.trash} tone="danger" label={`Remove ${c.label}`} onClick={() => onChange(drafts.filter((_, j) => j !== i))} />
              </div>
            </li>
          ))}
        </ul>
      )}
      {drafts.length < MAX_DRAFT_CHANNELS && (
        <button
          type="button"
          onClick={() => setEditing('new')}
          className={`flex cursor-pointer items-center justify-center gap-2 rounded-card border-2 border-dashed px-4 py-5 text-sm font-semibold hover:border-brand hover:bg-brand-soft/40 ${error ? 'border-danger text-danger' : 'border-line-strong text-brand'}`}
        >
          <Icon d="M12 5v14M5 12h14" className="size-5" />
          {drafts.length ? `Add another payment channel (${drafts.length} of ${MAX_DRAFT_CHANNELS})` : 'Add a payment channel: a QR code or bank details'}
        </button>
      )}
      {error && <p className="text-[13px] text-danger">{error}</p>}
      {editing !== null && <DraftDialog draft={editing === 'new' ? null : drafts[editing]} onSave={save} onClose={() => setEditing(null)} />}
    </div>
  );
}

function DraftDialog({ draft, onSave, onClose }) {
  const [f, setF] = useState(() => ({ type: draft?.type ?? 'qr', label: draft?.label ?? '', bankName: draft?.bankName ?? '', accountName: draft?.accountName ?? '', accountNumber: draft?.accountNumber ?? '', file: draft?.file ?? null }));
  const [fileError, setFileError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (patch) => setF((x) => ({ ...x, ...patch }));
  const ok = f.label.trim() && (f.type === 'qr' ? f.file && !fileProblem(f.file, { pdf: false }) : f.bankName.trim() && f.accountName.trim() && f.accountNumber.trim());
  const save = async (ev) => {
    ev?.preventDefault();
    if (!ok) return;
    setBusy(true);
    // QR codes stay sharp enough to scan.
    const file = f.type === 'qr' && f.file && f.file !== draft?.file ? await compressImage(f.file, { maxSide: 1200, quality: 0.9 }) : f.file;
    setBusy(false);
    onSave({ ...f, label: f.label.trim(), bankName: f.type === 'bank' ? f.bankName.trim() : '', accountName: f.accountName.trim(), accountNumber: f.accountNumber.trim(), file: f.type === 'qr' ? file : null });
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={draft ? `Edit “${draft.label}”` : 'Add a payment channel'}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form="draft-channel" loading={busy} disabled={!ok}>
            {draft ? 'Save' : 'Add'}
          </Button>
        </>
      }
    >
      <form id="draft-channel" onSubmit={save} className="flex flex-col gap-4" noValidate>
        <div className="flex gap-1 rounded-btn bg-sunken p-1" role="tablist" aria-label="Type">
          {[
            ['qr', 'QR code'],
            ['bank', 'Bank details'],
          ].map(([k, l]) => (
            <button key={k} type="button" role="tab" aria-selected={f.type === k} onClick={() => set({ type: k })} className={`flex-1 cursor-pointer rounded-md px-3 py-1.5 text-sm font-medium ${f.type === k ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'}`}>
              {l}
            </button>
          ))}
        </div>
        <Field label="Name" hint={f.type === 'qr' ? 'E.g. GCash, Maya, InstaPay QR.' : 'E.g. BDO savings.'}>
          {(a) => <Input {...a} autoFocus value={f.label} maxLength={60} onChange={(x) => set({ label: x.target.value })} />}
        </Field>
        {f.type === 'qr' ? (
          <>
            <div>
              <p className="mb-1.5 text-sm font-medium">QR code image</p>
              <FilePicker
                id="draft-qr"
                accept={IMAGE_ACCEPT}
                file={f.file}
                onChange={(x) => {
                  setFileError(x ? (fileProblem(x, { pdf: false }) ?? '') : '');
                  set({ file: x });
                }}
                error={fileError}
                label="Upload the QR image"
                hint={`JPG, PNG or WebP · up to ${MAX_UPLOAD_MB} MB`}
              />
            </div>
            <div className="grid gap-3 desktop:grid-cols-2">
              <Field label="Account name (optional)">{(a) => <Input {...a} value={f.accountName} maxLength={120} onChange={(x) => set({ accountName: x.target.value })} />}</Field>
              <Field label="Number (optional)" hint="E.g. the GCash number.">
                {(a) => <Input {...a} value={f.accountNumber} maxLength={60} onChange={(x) => set({ accountNumber: x.target.value })} />}
              </Field>
            </div>
          </>
        ) : (
          <div className="grid gap-3">
            <Field label="Bank name">{(a) => <Input {...a} value={f.bankName} maxLength={100} onChange={(x) => set({ bankName: x.target.value })} />}</Field>
            <Field label="Account name">{(a) => <Input {...a} value={f.accountName} maxLength={120} onChange={(x) => set({ accountName: x.target.value })} />}</Field>
            <Field label="Account number">
              {(a) => <Input {...a} value={f.accountNumber} maxLength={60} inputMode="numeric" className="font-mono" onChange={(x) => set({ accountNumber: x.target.value })} />}
            </Field>
          </div>
        )}
      </form>
    </Dialog>
  );
}

/** A draft as the API's multipart form. */
export function draftForm(d) {
  const form = new FormData();
  form.append('type', d.type);
  form.append('label', d.label);
  if (d.type === 'bank') form.append('bankName', d.bankName);
  if (d.accountName) form.append('accountName', d.accountName);
  if (d.accountNumber) form.append('accountNumber', d.accountNumber);
  if (d.type === 'qr' && d.file) form.append('file', d.file, d.file.name);
  return form;
}
