// The Byte Bun logo: a simplified, flat version of Bunno (the happy sesame bun) and the wordmark.
// To use an image instead, pass `src` (e.g. <Logo src="/logo.svg" />). The wordmark is inside the
// SVG so it scales with the mark.

/** The mark on its own: a flat bun with three sesame seeds and a little face. */
export function LogoMark({ className = 'size-7' }) {
  return (
    <svg viewBox="0 0 32 28" className={className} role="img" aria-label="Byte Bun">
      <BunShape />
    </svg>
  );
}

function BunShape() {
  return (
    <>
      {/* The bun: a dome on a darker base */}
      <path d="M2 21C2 10.5 8.3 3 16 3s14 7.5 14 18c0 2.6-3.4 4-14 4S2 23.6 2 21Z" fill="#E89A45" />
      <path d="M2.4 22.2C3.6 24.3 7.6 25 16 25s12.4-.7 13.6-2.8c-1.9.8-5.9 1.3-13.6 1.3s-11.7-.5-13.6-1.3Z" fill="#B5651F" />
      {/* Sesame seeds */}
      <ellipse cx="12.5" cy="8" rx="1.5" ry=".8" fill="#FFF6E5" transform="rotate(-25 12.5 8)" />
      <ellipse cx="18" cy="7" rx="1.5" ry=".8" fill="#FFF6E5" transform="rotate(15 18 7)" />
      <ellipse cx="22.5" cy="10.5" rx="1.5" ry=".8" fill="#FFF6E5" transform="rotate(45 22.5 10.5)" />
      {/* Face */}
      <circle cx="12" cy="16" r="1.4" fill="#3B2314" />
      <circle cx="20" cy="16" r="1.4" fill="#3B2314" />
      <path d="M13.8 19.2q2.2 2 4.4 0" fill="none" stroke="#3B2314" strokeWidth="1.3" strokeLinecap="round" />
    </>
  );
}

export function Logo({ src, className = 'h-7 w-auto' }) {
  if (src) return <img src={src} alt="Byte Bun" className={className} />;
  return (
    <svg viewBox="0 0 132 28" className={className} role="img" aria-label="Byte Bun">
      <BunShape />
      <text x="40" y="20" fontSize="16" fontWeight="800" letterSpacing="0.6" className="fill-byte-purple">
        BYTE <tspan className="fill-gold-dark">BUN</tspan>
      </text>
    </svg>
  );
}
