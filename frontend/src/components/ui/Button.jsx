import { useLeadForm } from '../../hooks/useLeadForm.js';

const BASE =
  'inline-flex min-h-11 cursor-pointer items-center justify-center rounded-btn border-2 text-center font-semibold transition-[background-color,transform] duration-150 motion-safe:hover:-translate-y-px';

const SIZES = {
  md: 'px-6 py-3 text-[15px]',
  sm: 'px-2.5 py-[11px] text-sm',
};

const VARIANTS = {
  primary: 'border-transparent bg-bun-orange text-midnight-plum hover:bg-bun-orange-hover',
  secondary: 'border-transparent bg-byte-purple text-cream-dough hover:bg-byte-purple-hover',
  outline: 'border-byte-purple bg-transparent text-byte-purple hover:bg-lavender-mist',
  light: 'border-cream-dough bg-transparent text-cream-dough hover:bg-cream-dough/12',
};

// One button for the whole site.
//  - `lead="source"` renders a <button> that opens the lead form (source is saved with the lead).
//  - `href` renders a link (in-page anchor, mailto:, or external URL).
export function Button({ variant = 'primary', size = 'md', lead, href, className = '', children, ...rest }) {
  const { open } = useLeadForm();
  const classes = `${BASE} ${SIZES[size]} ${VARIANTS[variant]} ${className}`;

  if (lead) {
    return (
      <button type="button" className={classes} onClick={() => open(lead)} {...rest}>
        {children}
      </button>
    );
  }
  const external = /^https?:\/\//.test(href);
  return (
    <a href={href} className={classes} {...(external && { target: '_blank', rel: 'noopener noreferrer' })} {...rest}>
      {children}
    </a>
  );
}

// Renders a content object from site.js ({ label, lead } or { label, href }).
export function CtaButton({ cta, variant, size, className }) {
  return (
    <Button variant={variant} size={size} lead={cta.lead} href={cta.href} className={className}>
      {cta.label}
    </Button>
  );
}

// Centered row under a section: optional text plus button(s).
export function CtaStrip({ text, children }) {
  return (
    <div className="mt-11 flex flex-wrap items-center justify-center gap-3.5 text-center font-semibold mobile:mt-8 mobile:flex-col mobile:gap-3 mobile:*:w-full">
      {text && <span>{text}</span>}
      {children}
    </div>
  );
}
