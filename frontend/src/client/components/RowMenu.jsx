import { useEffect, useRef, useState } from 'react';
import { Icon } from '../ui.jsx';

/**
 * A row's actions in a pop-over: a "⋯" button opening a menu of items
 * { label, hint?, icon?, tone?: 'danger' | 'primary', onClick } (null items and section breaks
 * '—' are allowed). Placed against the window so a list that clips its overflow doesn't cut it
 * off; near the bottom of the screen it opens upward. Closes on a pick, Escape, scroll or a click outside.
 */
export function RowMenu({ items, label = 'Actions' }) {
  const [pos, setPos] = useState(null);
  const btn = useRef(null);
  const menu = useRef(null);
  const list = items.filter(Boolean);
  useEffect(() => {
    if (!pos) return undefined;
    const close = () => setPos(null);
    const outside = (ev) => !menu.current?.contains(ev.target) && !btn.current?.contains(ev.target) && close();
    const esc = (ev) => ev.key === 'Escape' && close();
    document.addEventListener('mousedown', outside);
    document.addEventListener('keydown', esc);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('mousedown', outside);
      document.removeEventListener('keydown', esc);
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [pos]);
  if (!list.some((x) => x !== '—')) return null;
  const toggle = () => {
    if (pos) return setPos(null);
    const r = btn.current.getBoundingClientRect();
    const right = Math.max(8, window.innerWidth - r.right);
    const rows = list.length;
    setPos(window.innerHeight - r.bottom < Math.min(420, rows * 44 + 24) ? { bottom: window.innerHeight - r.top + 6, right } : { top: r.bottom + 6, right });
  };
  return (
    <>
      <button
        ref={btn}
        type="button"
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={!!pos}
        aria-label={label}
        title={label}
        className={`inline-flex size-9 cursor-pointer items-center justify-center rounded-btn text-muted hover:bg-sunken hover:text-ink ${pos ? 'bg-sunken text-ink' : ''}`}
      >
        <Icon d="M5 12h.01M12 12h.01M19 12h.01" className="size-5 [stroke-width:3]" />
      </button>
      {pos && (
        <div ref={menu} role="menu" className="fixed z-50 max-h-[70vh] w-64 overflow-y-auto rounded-xl border border-line bg-surface p-1.5 shadow-lg" style={pos}>
          {list.map((it, i) =>
            it === '—' ? (
              <div key={`s${i}`} className="my-1 h-px bg-line" role="separator" />
            ) : (
              <button
                key={it.label}
                type="button"
                role="menuitem"
                onClick={() => {
                  setPos(null);
                  it.onClick();
                }}
                className={`flex w-full cursor-pointer items-start gap-2.5 rounded-lg px-3 py-2 text-left hover:bg-sunken ${it.tone === 'danger' ? 'text-danger' : it.tone === 'primary' ? 'text-brand' : 'text-ink'}`}
              >
                {it.icon && <Icon d={it.icon} className="mt-0.5 size-4 shrink-0" />}
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">{it.label}</span>
                  {it.hint && <span className="block text-xs font-normal text-muted">{it.hint}</span>}
                </span>
              </button>
            ),
          )}
        </div>
      )}
    </>
  );
}
