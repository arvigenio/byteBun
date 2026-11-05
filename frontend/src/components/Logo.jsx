// PLACEHOLDER logo. To use the real logo, pass `src` (e.g. <Logo src="/logo.svg" />) or
// replace this file. The wordmark is inside the SVG so it scales with the mark.
export function Logo({ src, className = 'h-7 w-auto' }) {
  if (src) return <img src={src} alt="Byte Bun Tech" className={className} />;
  return (
    <svg viewBox="0 0 168 28" className={className} role="img" aria-label="Byte Bun Tech">
      {/* Bun outline */}
      <ellipse cx="16" cy="16" rx="13.5" ry="9.5" fill="none" strokeWidth="2.5" className="stroke-bun-orange" />
      {/* Circuit line and node */}
      <path d="M8.5 14Q16 5.5 23.5 14" fill="none" strokeWidth="2.5" strokeLinecap="round" className="stroke-byte-purple" />
      <circle cx="23.5" cy="14" r="2.5" strokeWidth="1.8" className="fill-cream-dough stroke-byte-purple" />
      <text x="40" y="19.5" fontSize="15" fontWeight="700" letterSpacing="0.75" className="fill-byte-purple">
        BYTEBUN <tspan className="fill-gold-dark">TECH</tspan>
      </text>
    </svg>
  );
}
