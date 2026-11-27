import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useDeleteEventMediaMutation, useMeQuery, useUploadEventMediaMutation } from '../api.js';
import { compressImage, fileProblem, IMAGE_ACCEPT } from '../lib/upload.js';
import { Button, Card, Dialog, Icon, useConfirm } from '../ui.jsx';

// The event page's cover photo and logo (Details tab): images only, previewed before saving.

const SLOTS = {
  cover: { title: 'Cover photo', hint: 'Wide, e.g. 1500 × 500. Shown across the top of the event page.', box: 'aspect-[3/1] w-full', fit: 'object-cover', compress: { maxSide: 2000, quality: 0.82 } },
  logo: { title: 'Logo', hint: 'Square works best. Shown next to the event name.', box: 'size-28', fit: 'object-contain p-1', compress: { maxSide: 600, quality: 0.9 } },
};

function MediaSlot({ e, kind, current, canEdit, onPending }) {
  const slot = SLOTS[kind];
  const input = useRef(null);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [upload, upState] = useUploadEventMediaMutation();
  const [del, delState] = useDeleteEventMediaMutation();
  const confirm = useConfirm();
  useEffect(() => {
    if (!file) {
      setPreview(null);
      onPending?.(kind, null);
      return undefined;
    }
    const u = URL.createObjectURL(file);
    setPreview(u);
    onPending?.(kind, u);
    return () => URL.revokeObjectURL(u);
  }, [file]); // eslint-disable-line react-hooks/exhaustive-deps
  const problem = file ? fileProblem(file, { pdf: false }) : null;
  const pick = (f) => {
    if (!f) return;
    const p = fileProblem(f, { pdf: false });
    if (p) return toast.error(p);
    setFile(f);
  };
  const save = async () => {
    const up = await compressImage(file, slot.compress);
    const form = new FormData();
    form.append('file', up, up.name);
    const r = await upload({ id: e.id, kind, form });
    if (r.error) return toast.error(r.error.message);
    toast.success(`${slot.title} saved`);
    setFile(null);
  };
  const shown = preview ?? current;
  return (
    <div className="flex flex-col gap-2">
      <div>
        <p className="text-sm font-semibold">{slot.title}</p>
        <p className="text-xs text-muted">{slot.hint}</p>
      </div>
      <input ref={input} type="file" accept={IMAGE_ACCEPT} className="sr-only" onChange={(x) => (pick(x.target.files?.[0] ?? null), (x.target.value = ''))} />
      <button
        type="button"
        disabled={!canEdit}
        onClick={() => input.current?.click()}
        className={`group relative grid cursor-pointer place-items-center overflow-hidden rounded-card border-2 bg-sunken ${slot.box} ${preview ? 'border-brand' : 'border-dashed border-line-strong'} disabled:cursor-default`}
        title={canEdit ? `Choose a ${slot.title.toLowerCase()}` : undefined}
      >
        {shown ? (
          <img src={shown} alt={`${slot.title} preview`} className={`size-full ${slot.fit}`} />
        ) : (
          <span className="flex flex-col items-center gap-1 p-2 text-center text-xs font-semibold text-muted">
            <Icon d="M4 16l4-4 3 3 5-5 4 4M4 5h16v14H4zM9 9h.01" className="size-6 text-brand" />
            {canEdit ? 'Choose an image' : 'None'}
          </span>
        )}
        {preview && <span className="absolute top-2 left-2 rounded-full bg-brand px-2 py-0.5 text-[11px] font-bold text-brand-ink">Preview: not saved yet</span>}
      </button>
      {canEdit && (
        <div className="flex flex-wrap gap-2">
          {file ? (
            <>
              <Button size="sm" onClick={save} loading={upState.isLoading} disabled={!!problem}>
                Save {slot.title.toLowerCase()}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setFile(null)} disabled={upState.isLoading}>
                Cancel
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" variant="secondary" onClick={() => input.current?.click()}>
                {current ? 'Change' : 'Choose'}
              </Button>
              {current && (
                <Button
                  size="sm"
                  variant="ghost"
                  loading={delState.isLoading}
                  onClick={async () => {
                    if (!(await confirm({ title: `Remove the ${slot.title.toLowerCase()}?`, body: 'It’s no longer shown on the event page.', action: 'Remove' }))) return;
                    const r = await del({ id: e.id, kind });
                    if (r.error) toast.error(r.error.message);
                    else toast.success(`${slot.title} removed`);
                  }}
                >
                  Remove
                </Button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function EventMediaCard({ e, canEdit }) {
  // Images chosen but not saved yet: the page preview shows them.
  const [pending, setPending] = useState({ cover: null, logo: null });
  const [previewing, setPreviewing] = useState(false);
  const onPending = (kind, url) => setPending((x) => ({ ...x, [kind]: url }));
  const cover = pending.cover ?? e.coverUrl;
  const logo = pending.logo ?? e.logoUrl;
  const unsaved = !!(pending.cover || pending.logo);
  return (
    <Card
      title="Cover photo and logo"
      description="Images only (JPG, PNG or WebP). You see a preview before saving."
      actions={
        (cover || logo) && (
          <Button size="sm" variant="secondary" onClick={() => setPreviewing(true)}>
            <Icon d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 15a3 3 0 100-6 3 3 0 000 6z" className="size-4" /> Preview event page
          </Button>
        )
      }
    >
      <div className="grid gap-5 desktop:grid-cols-[1fr_auto]">
        <MediaSlot e={e} kind="cover" current={e.coverUrl} canEdit={canEdit} onPending={onPending} />
        <MediaSlot e={e} kind="logo" current={e.logoUrl} canEdit={canEdit} onPending={onPending} />
      </div>
      {previewing && <PagePreview e={e} cover={cover} logo={logo} unsaved={unsaved} onClose={() => setPreviewing(false)} />}
    </Card>
  );
}

/** The top of the event page as attendees see it, with the chosen (even unsaved) images. */
function PagePreview({ e, cover, logo, unsaved, onClose }) {
  const { data: me } = useMeQuery();
  const when = new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' }).format(new Date(`${e.date}T12:00:00Z`));
  const time = (m) => `${Math.floor(m / 60) % 12 || 12}:${String(m % 60).padStart(2, '0')} ${m % 1440 < 720 ? 'AM' : 'PM'}`;
  return (
    <Dialog open wide onClose={onClose} title="Event page preview" footer={<Button onClick={onClose}>Close</Button>}>
      {unsaved && <p className="mb-3 rounded-btn bg-warn/10 px-3 py-2 text-sm text-ink">This preview includes images you haven’t saved yet. Save them to show them on the real page.</p>}
      <div className="mx-auto max-w-2xl overflow-hidden rounded-card border border-line bg-surface shadow-sm">
        {cover && (
          <div className="aspect-[3/1] bg-sunken">
            <img src={cover} alt="" className="size-full object-cover" />
          </div>
        )}
        <div className={`bg-brand-soft px-5 pb-4 ${cover && logo ? 'pt-0' : 'pt-4'}`}>
          <div className="flex items-end gap-3">
            {logo && <img src={logo} alt="" className={`size-16 shrink-0 rounded-2xl border-4 border-surface bg-surface object-contain shadow-sm ${cover ? '-mt-8' : ''}`} />}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-brand">{me?.business?.name}</p>
              <p className="mt-0.5 text-2xl leading-tight font-bold tracking-tight text-ink">{e.title}</p>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <span className="rounded-full bg-surface px-2.5 py-1 text-xs font-semibold text-brand">{e.kind === 'paid' ? `Paid${e.priceLabel ? ` · ${e.priceLabel}` : ''}` : 'Free'}</span>
            <span className="rounded-full bg-surface px-2.5 py-1 text-xs font-semibold text-muted">
              {when} · {time(e.startMinute)} – {time(e.endMinute)}
            </span>
            <span className="rounded-full bg-surface px-2.5 py-1 text-xs font-semibold text-muted">{e.format === 'online' ? 'Online' : 'Onsite'}</span>
          </div>
          <span className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-btn border-2 border-brand bg-surface px-4 text-sm font-bold text-brand">Show details</span>
        </div>
        <div className="border-t border-line px-5 py-6 text-center text-sm text-faint">The registration form appears here.</div>
      </div>
    </Dialog>
  );
}
