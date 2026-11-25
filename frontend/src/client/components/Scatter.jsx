// A page background (sign-in, booking and event pages): a few outline doodles, scattered and tilted, very
// faint in the brand color. Some drift slowly (not with reduced motion). Two sets: `bookings` (calendars,
// notes, a clock and a ticket) and `security` (keys and locks, for the accounts sign-in).
const DOODLES = {
  calendar: (
    <>
      <rect x="6" y="10" width="52" height="46" rx="7" />
      <path d="M6 24h52M20 4v12M44 4v12" />
      <path d="M17 34h6M29 34h6M41 34h6M17 44h6M29 44h6" strokeWidth="3" />
    </>
  ),
  note: (
    <>
      <path d="M10 6h34l10 10v42H10z" />
      <path d="M44 6v10h10M18 26h26M18 35h26M18 44h16" />
    </>
  ),
  check: (
    <>
      <rect x="6" y="10" width="52" height="46" rx="7" />
      <path d="M6 24h52M20 4v12M44 4v12M22 41l7 7 13-14" />
    </>
  ),
  clock: (
    <>
      <circle cx="32" cy="32" r="24" />
      <path d="M32 18v15l10 6" />
    </>
  ),
  ticket: (
    <>
      <path d="M6 18h52v9a6 6 0 000 12v9H6v-9a6 6 0 000-12z" />
      <path d="M38 18v30" strokeDasharray="3 4" />
    </>
  ),
  lock: (
    <>
      <rect x="12" y="28" width="40" height="30" rx="6" />
      <path d="M20 28v-8a12 12 0 0124 0v8" />
      <circle cx="32" cy="41" r="4" />
      <path d="M32 45v5" />
    </>
  ),
  lockOpen: (
    <>
      <rect x="12" y="28" width="40" height="30" rx="6" />
      <path d="M20 28v-8a12 12 0 0123.3-4" />
      <circle cx="32" cy="41" r="4" />
      <path d="M32 45v5" />
    </>
  ),
  key: (
    <>
      <circle cx="19" cy="32" r="11" />
      <circle cx="19" cy="32" r="4" />
      <path d="M30 32h28M48 32v9M56 32v7" />
    </>
  ),
  keyOld: (
    <>
      <circle cx="16" cy="20" r="9" />
      <path d="M23 27l29 29M44 48l5-5M50 54l5-5" />
    </>
  ),
};
// The bookings set uses these kinds; the security set swaps each one for a key or a lock.
const SECURITY = { calendar: 'lock', note: 'key', clock: 'lockOpen', ticket: 'keyOld', check: 'lock' };
// [kind, left %, top %, size px, rotate deg, drifts, hidden on phones]
const SCATTER = [
  ['calendar', 6, 10, 72, -12, true, false],
  ['note', 84, 8, 60, 10, false, false],
  ['clock', 14, 72, 54, 0, true, true],
  ['ticket', 78, 70, 70, -8, true, false],
  ['check', 90, 40, 52, 14, false, true],
  ['note', 3, 42, 50, -6, false, true],
  ['calendar', 62, 88, 48, 8, false, true],
  ['clock', 36, 5, 40, 0, true, true],
  ['ticket', 28, 90, 44, 12, false, true],
  ['check', 50, 14, 36, -10, false, true],
];

export function Scatter({ set = 'bookings' }) {
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,var(--color-brand-soft),transparent_60%)]" />
      {SCATTER.map(([kind, left, top, size, rot, drift, phoneHidden], i) => (
        <div key={i} className={`absolute ${drift ? 'float-slow' : ''} ${phoneHidden ? 'mobile:hidden' : ''}`} style={{ left: `${left}%`, top: `${top}%`, animationDelay: `${i * -1.3}s` }}>
          <svg viewBox="0 0 64 64" width={size} height={size} fill="none" stroke="var(--color-brand)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: `rotate(${rot}deg)`, opacity: 0.13 }}>
            {DOODLES[set === 'security' ? SECURITY[kind] : kind]}
          </svg>
        </div>
      ))}
    </div>
  );
}
