import { forwardRef, useEffect, useId, useRef } from 'react';
import { onRouteLinkClick } from '../lib/router.js';

// The client apps' UI kit. Tokens only (client.css); the brand color follows the host / business.
const cx = (...c) => c.filter(Boolean).join(' ');

const BTN = {
  primary: 'bg-brand text-brand-ink border-brand hover:brightness-110',
  secondary: 'bg-surface text-ink border-line-strong hover:bg-sunken',
  ghost: 'bg-transparent text-muted border-transparent hover:bg-sunken hover:text-ink',
  danger: 'bg-danger text-white border-danger hover:brightness-110',
};
const SIZE = { md: 'min-h-10 px-4 text-sm', sm: 'min-h-8 px-3 text-[13px]', lg: 'min-h-12 px-5 text-base' };

export function Button({ variant = 'primary', size = 'md', loading = false, className, children, disabled, type = 'button', ...rest }) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className={cx(
        'inline-flex cursor-pointer items-center justify-center gap-2 rounded-btn border font-semibold transition disabled:cursor-not-allowed disabled:opacity-55',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
        BTN[variant],
        SIZE[size],
        className,
      )}
      {...rest}
    >
      {loading && <Spinner className="size-4" />}
      {children}
    </button>
  );
}

/** A link styled as a button. Internal paths use client-side navigation. */
export function LinkButton({ href, variant = 'secondary', size = 'md', className, children, ...rest }) {
  const internal = href?.startsWith('/') && !href.startsWith('//');
  return (
    <a
      href={href}
      onClick={internal ? onRouteLinkClick : undefined}
      className={cx('inline-flex items-center justify-center gap-2 rounded-btn border font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand', BTN[variant], SIZE[size], className)}
      {...rest}
    >
      {children}
    </a>
  );
}

export function NavLink({ href, active, children, className }) {
  return (
    <a
      href={href}
      onClick={onRouteLinkClick}
      aria-current={active ? 'page' : undefined}
      className={cx('rounded-lg px-3 py-2 text-sm font-medium transition', active ? 'bg-brand-soft text-brand' : 'text-muted hover:bg-sunken hover:text-ink', className)}
    >
      {children}
    </a>
  );
}

export function Spinner({ className = 'size-5' }) {
  return <span className={cx('inline-block animate-spin rounded-full border-2 border-current border-r-transparent', className)} aria-hidden="true" />;
}

export function Loading({ label = 'Loading…' }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-muted" role="status">
      <Spinner /> {label}
    </div>
  );
}

export function Field({ label, hint, error, children, className }) {
  const id = useId();
  const child = typeof children === 'function' ? children({ id, 'aria-invalid': !!error || undefined, 'aria-describedby': error ? `${id}-err` : hint ? `${id}-hint` : undefined }) : children;
  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      {label && (
        <label htmlFor={id} className="text-sm font-medium text-ink">
          {label}
        </label>
      )}
      {child}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-[13px] text-faint">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-err`} className="text-[13px] font-medium text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

const INPUT = 'w-full rounded-btn border border-line-strong bg-surface px-3 py-2 text-[15px] text-ink placeholder:text-faint focus:border-brand focus:outline-2 focus:outline-brand/25 aria-[invalid=true]:border-danger disabled:bg-sunken';

export const Input = forwardRef(function Input({ className, ...rest }, ref) {
  return <input ref={ref} className={cx(INPUT, 'min-h-10', className)} {...rest} />;
});
export const Textarea = forwardRef(function Textarea({ className, rows = 3, ...rest }, ref) {
  return <textarea ref={ref} rows={rows} className={cx(INPUT, className)} {...rest} />;
});
export const Select = forwardRef(function Select({ className, children, ...rest }, ref) {
  return (
    <select ref={ref} className={cx(INPUT, 'min-h-10 cursor-pointer', className)} {...rest}>
      {children}
    </select>
  );
});

export function Checkbox({ label, hint, className, ...rest }) {
  return (
    <label className={cx('flex cursor-pointer items-start gap-3', className)}>
      <input type="checkbox" className="mt-0.5 size-4 cursor-pointer accent-[var(--color-brand)]" {...rest} />
      <span>
        <span className="text-sm font-medium text-ink">{label}</span>
        {hint && <span className="block text-[13px] text-faint">{hint}</span>}
      </span>
    </label>
  );
}

export function Card({ title, description, actions, children, className }) {
  return (
    <section className={cx('rounded-card border border-line bg-surface p-5 shadow-[0_1px_2px_rgba(16,24,40,0.04)] mobile:p-4', className)}>
      {(title || actions) && (
        <header className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            {title && <h2 className="text-base font-semibold text-ink">{title}</h2>}
            {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
          </div>
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}

export function PageHeader({ title, description, actions }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

const BADGE = { neutral: 'bg-sunken text-muted', brand: 'bg-brand-soft text-brand', ok: 'bg-ok-soft text-ok', warn: 'bg-warn-soft text-warn', danger: 'bg-danger-soft text-danger' };
export function Badge({ tone = 'neutral', children }) {
  return <span className={cx('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold', BADGE[tone])}>{children}</span>;
}

export function Notice({ tone = 'warn', title, children, className }) {
  const t = { warn: 'border-warn/30 bg-warn-soft text-warn', danger: 'border-danger/30 bg-danger-soft text-danger', ok: 'border-ok/30 bg-ok-soft text-ok', info: 'border-brand/25 bg-brand-soft text-ink' }[tone];
  return (
    <div className={cx('rounded-btn border px-4 py-3 text-sm', t, className)} role={tone === 'danger' ? 'alert' : 'status'}>
      {title && <p className="font-semibold">{title}</p>}
      <div>{children}</div>
    </div>
  );
}

export function Empty({ title, children, action }) {
  return (
    <div className="rounded-card border border-dashed border-line-strong bg-surface px-6 py-12 text-center">
      <p className="font-semibold text-ink">{title}</p>
      {children && <p className="mx-auto mt-1 max-w-md text-sm text-muted">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** A modal dialog (native <dialog>: focus trap and Escape for free). */
export function Dialog({ open, onClose, title, children, footer, wide = false }) {
  const ref = useRef(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose?.()}
      className={cx('m-auto w-[calc(100%-32px)] rounded-card border border-line bg-surface p-0 text-ink shadow-xl backdrop:bg-black/40', wide ? 'max-w-2xl' : 'max-w-md')}
    >
      {open && (
        <div className="flex max-h-[85vh] flex-col">
          <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
            <h2 className="text-base font-semibold">{title}</h2>
            <button type="button" onClick={onClose} className="cursor-pointer rounded-md p-1 text-faint hover:bg-sunken hover:text-ink" aria-label="Close">
              <Icon d="M6 6l12 12M18 6L6 18" />
            </button>
          </header>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
          {footer && <footer className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-3">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}

export function Icon({ d, className = 'size-5' }) {
  return (
    <svg viewBox="0 0 24 24" className={cx('shrink-0', className)} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

export const ICONS = {
  calendar: 'M8 7V3m8 4V3M4 11h16M5 5h14a1 1 0 011 1v13a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1z',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  clock: 'M12 7v5l3 2M21 12a9 9 0 11-18 0 9 9 0 0118 0z',
  palette: 'M12 21a9 9 0 110-18c4.97 0 9 3.6 9 8 0 2.2-1.8 4-4 4h-1.5a1.5 1.5 0 00-1 2.6A1.5 1.5 0 0112 21zM7.5 11a1 1 0 100-2 1 1 0 000 2zM11 7.5a1 1 0 100-2 1 1 0 000 2zM16 8.5a1 1 0 100-2 1 1 0 000 2z',
  user: 'M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z',
  users: 'M17 20v-2a4 4 0 00-4-4H7a4 4 0 00-4 4v2M10 10a4 4 0 100-8 4 4 0 000 8zM21 20v-2a4 4 0 00-3-3.87M16 2.13a4 4 0 010 7.75',
  tag: 'M3 12V4a1 1 0 011-1h8l9 9-9 9-9-9zM7.5 7.5h.01',
  grid: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5',
  menu: 'M4 6h16M4 12h16M4 18h16',
  check: 'M5 12l4 4 10-10',
  pin: 'M12 21s-7-6.1-7-11.5A7 7 0 0119 9.5C19 14.9 12 21 12 21zM12 12a2.5 2.5 0 100-5 2.5 2.5 0 000 5z',
  video: 'M15 10l5-3v10l-5-3M4 6h11v12H4z',
  phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 005 5L15 13l5 2v4a2 2 0 01-2 2A16 16 0 013 6a2 2 0 012-2',
  star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z',
};
