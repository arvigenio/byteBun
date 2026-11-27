import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Icon } from '../ui.jsx';

/**
 * Priority+ tabs: as many tabs as fit are shown, the rest go in a "More" menu. The selected tab
 * always stays visible (it takes the last visible slot when it would overflow). Re-measured on
 * resize. tabs: [[key, label], ...]
 */
export function PriorityTabs({ tabs, value, onChange, label = 'Sections' }) {
  const wrap = useRef(null);
  const measure = useRef(null);
  const [fit, setFit] = useState(tabs.length);
  const [open, setOpen] = useState(false);
  const menu = useRef(null);
  const keys = tabs.map(([k]) => k).join('|');

  useLayoutEffect(() => {
    const calc = () => {
      const box = wrap.current;
      const row = measure.current;
      if (!box || !row) return;
      const avail = box.clientWidth - 8; // the bar's padding
      const widths = [...row.children].map((c) => c.getBoundingClientRect().width + 4);
      const more = widths.pop() ?? 90; // the measured "More" button
      const total = widths.reduce((a, w) => a + w, 0);
      if (total <= avail) return setFit(tabs.length);
      let used = more;
      let n = 0;
      while (n < widths.length && used + widths[n] <= avail) used += widths[n++];
      setFit(Math.max(1, n));
    };
    calc();
    const ro = new ResizeObserver(calc);
    if (wrap.current) ro.observe(wrap.current);
    return () => ro.disconnect();
  }, [keys]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return undefined;
    const close = (ev) => !menu.current?.contains(ev.target) && setOpen(false);
    const esc = (ev) => ev.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  // Visible: the first `fit`, with the selected one swapped in when it would be hidden.
  let visible = tabs.slice(0, fit);
  const activeIdx = tabs.findIndex(([k]) => k === value);
  if (fit < tabs.length && activeIdx >= fit) visible = [...tabs.slice(0, fit - 1), tabs[activeIdx]];
  const hidden = tabs.filter((t) => !visible.includes(t));
  const btn = (selected) => `shrink-0 cursor-pointer rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap ${selected ? 'bg-surface text-ink shadow-sm' : 'text-muted hover:text-ink'}`;

  return (
    <div ref={wrap} className="relative mb-4">
      {/* Invisible copy of every tab (and More) to measure their widths. */}
      <div ref={measure} aria-hidden="true" className="pointer-events-none invisible absolute top-0 left-0 flex gap-1 whitespace-nowrap">
        {tabs.map(([k, l]) => (
          <span key={k} className={btn(false)}>
            {l}
          </span>
        ))}
        <span className={btn(false)}>More ▾</span>
      </div>
      <div className="flex gap-1 rounded-btn bg-sunken p-1" role="tablist" aria-label={label}>
        {visible.map(([k, l]) => (
          <button key={k} type="button" role="tab" aria-selected={value === k} onClick={() => onChange(k)} className={`${btn(value === k)} ${hidden.length ? '' : 'flex-1'}`}>
            {l}
          </button>
        ))}
        {hidden.length > 0 && (
          <div className="relative ml-auto" ref={menu}>
            <button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} className={`${btn(false)} inline-flex items-center gap-1`}>
              More
              <span className="rounded-full bg-line px-1.5 text-[11px] font-bold text-muted tabular-nums">{hidden.length}</span>
              <Icon d="M6 9l6 6 6-6" className="size-4" />
            </button>
            {open && (
              <div className="absolute right-0 z-30 mt-1.5 min-w-48 rounded-xl border border-line bg-surface p-1.5 shadow-lg" role="menu">
                {hidden.map(([k, l]) => (
                  <button
                    key={k}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      onChange(k);
                      setOpen(false);
                    }}
                    className="flex w-full cursor-pointer rounded-lg px-3 py-2 text-left text-sm font-medium text-ink hover:bg-sunken"
                  >
                    {l}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
