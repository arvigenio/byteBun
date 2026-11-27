const cx = (...c) => c.filter(Boolean).join(' ');

// Bulk bookings stand out on Attendees, Statuses and Collections: their spots are kept together
// under one highlighted header.

/**
 * Splits a list into blocks: one per bulk booking (its spots, kept together where its first spot
 * is) and one per single registration. `consecutive`: only neighbours are grouped (Collections,
 * which stays in time order). `keyOf` decides what belongs together (default: the booking's group).
 */
export function bulkBlocks(list, { consecutive = false, keyOf = (x) => x.groupId ?? null } = {}) {
  const blocks = [];
  const open = new Map();
  for (const x of list) {
    const k = keyOf(x);
    if (!k) {
      blocks.push({ key: `one-${x.id}`, groupId: null, items: [x] });
      continue;
    }
    const last = blocks[blocks.length - 1];
    if (consecutive) {
      if (last?.groupId === k) last.items.push(x);
      else blocks.push({ key: `bulk-${k}-${blocks.length}`, groupId: k, items: [x] });
      continue;
    }
    if (open.has(k)) open.get(k).items.push(x);
    else {
      const b = { key: `bulk-${k}`, groupId: k, items: [x] };
      open.set(k, b);
      blocks.push(b);
    }
  }
  return blocks;
}

/** The "Bulk booking" pill. */
export function BulkPill({ className }) {
  return <span className={cx('inline-flex items-center gap-1 rounded-full bg-brand px-2 py-0.5 text-[11px] font-bold tracking-wide text-brand-ink uppercase', className)}>
    <svg viewBox="0 0 24 24" className="size-3" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M16 19v-1a4 4 0 00-4-4H6a4 4 0 00-4 4v1M9 10a3 3 0 100-6 3 3 0 000 6zM22 19v-1a4 4 0 00-3-3.9M16 4.1a3 3 0 010 5.8" />
    </svg>
    Bulk booking
  </span>;
}

/** The header of a bulk booking's block: who, how many spots, and a few facts. */
export function BulkHeader({ name, spots, facts = [], className }) {
  return (
    <div className={cx('flex flex-wrap items-center gap-x-3 gap-y-1', className)}>
      <BulkPill />
      <span className="font-semibold text-ink">{name}</span>
      <span className="text-sm font-semibold text-brand">{spots} spots</span>
      {facts.filter(Boolean).map((f, i) => (
        <span key={i} className="text-xs text-muted">
          · {f}
        </span>
      ))}
    </div>
  );
}
