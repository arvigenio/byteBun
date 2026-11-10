// Small building blocks for the admin app, in the site's brand tokens (index.css).

const BTN = {
  primary: 'border-transparent bg-byte-purple text-cream-dough hover:bg-byte-purple-hover',
  accent: 'border-transparent bg-bun-orange text-midnight-plum hover:bg-bun-orange-hover',
  outline: 'border-line bg-cream-dough text-byte-purple hover:bg-lavender-mist',
  danger: 'border-danger bg-cream-dough text-danger hover:bg-lavender-mist',
  dangerSolid: 'border-danger bg-danger text-cream-dough hover:opacity-90', // the "yes, delete" in a confirm
  link: 'border-transparent bg-transparent px-0 text-soft-violet underline-offset-4 hover:underline min-h-0',
};

export function AdminButton({ variant = 'primary', className = '', busy = false, children, type = 'button', ...rest }) {
  return (
    <button
      type={type}
      disabled={busy || rest.disabled}
      className={`inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-btn border-2 px-5 py-2.5 text-[15px] font-semibold transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-60 ${BTN[variant]} ${className}`}
      {...rest}
    >
      {busy && <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true" />}
      {children}
    </button>
  );
}

export function Panel({ className = '', children }) {
  return <section className={`rounded-card border border-line bg-cream-dough p-6 shadow-[0_1px_2px_rgb(26_10_51/0.06)] mobile:p-5 ${className}`}>{children}</section>;
}

export function Field({ label, hint, error, id, children }) {
  return (
    <div className="mb-4">
      <label htmlFor={id} className="mb-1.5 block text-sm font-semibold text-midnight-plum">
        {label}
      </label>
      {children}
      {hint && !error && <p className="mt-1.5 text-[13px] text-muted">{hint}</p>}
      {error && (
        <p id={`${id}-error`} className="mt-1.5 text-[13px] font-medium text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

/** A group of checkboxes for one array field (react-hook-form `register`): items [{ key, label }]. */
export function Checkboxes({ label, name, items, register, error }) {
  return (
    <fieldset className="mb-4">
      <legend className="mb-2 text-sm font-semibold text-midnight-plum">{label}</legend>
      <div className="grid grid-cols-2 gap-2 mobile:grid-cols-1">
        {items.map((it) => (
          <label key={it.key} className="flex cursor-pointer items-start gap-2 rounded-btn border border-line px-3 py-2 text-sm text-midnight-plum has-checked:border-soft-violet has-checked:bg-lavender-mist">
            <input type="checkbox" value={it.key} className="mt-0.5 size-4 accent-byte-purple" {...register(name)} />
            {it.label}
          </label>
        ))}
      </div>
      {error && <p className="mt-1.5 text-[13px] font-medium text-danger">{error}</p>}
    </fieldset>
  );
}

const INPUT =
  'block w-full rounded-btn border-2 border-line bg-cream-dough px-3.5 py-2.5 text-[15px] text-midnight-plum outline-none transition-colors placeholder:text-muted/60 focus:border-soft-violet aria-[invalid=true]:border-danger';

export function TextInput({ error, className = '', ...props }) {
  return <input aria-invalid={error ? 'true' : 'false'} className={`${INPUT} ${className}`} {...props} />;
}

export function SelectInput({ className = '', children, ...props }) {
  return (
    <select className={`${INPUT} ${className}`} {...props}>
      {children}
    </select>
  );
}

/** A 6-digit one-time code box: numeric keyboard on phones, autofill from SMS/email where supported. */
export function CodeInput({ error, ...props }) {
  return (
    <input
      inputMode="numeric"
      autoComplete="one-time-code"
      maxLength={7}
      placeholder="123456"
      aria-invalid={error ? 'true' : 'false'}
      className={`${INPUT} text-center font-mono text-2xl tracking-[0.5em]`}
      {...props}
    />
  );
}

export function Notice({ tone = 'info', children }) {
  const tones = {
    info: 'border-soft-violet bg-lavender-mist text-midnight-plum',
    warning: 'border-honey-gold bg-gold-tint text-midnight-plum',
    danger: 'border-danger bg-gold-tint text-danger',
    success: 'border-circuit-teal bg-lavender-mist text-midnight-plum',
  };
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={`mb-4 rounded-btn border-l-4 px-4 py-3 text-sm ${tones[tone]}`}>
      {children}
    </div>
  );
}

export function Badge({ tone = 'neutral', children }) {
  const tones = {
    neutral: 'bg-lavender-mist text-byte-purple',
    gold: 'bg-gold-tint text-midnight-plum',
    teal: 'bg-circuit-teal/15 text-midnight-plum',
    danger: 'bg-gold-tint text-danger',
  };
  return <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-bold capitalize ${tones[tone]}`}>{children}</span>;
}

export function Spinner({ label = 'Loading…' }) {
  return (
    <div className="flex items-center gap-3 py-10 text-muted" role="status">
      <span className="size-5 animate-spin rounded-full border-2 border-soft-violet border-t-transparent" aria-hidden="true" />
      {label}
    </div>
  );
}

export const formatDateTime = (iso, tz) =>
  new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short', ...(tz && { timeZone: tz }) }).format(new Date(iso));
