// Inline stroke icons (24x24). Decorative by default (aria-hidden).
const PATHS = {
  web: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 9h18M7 6.5h.01M10 6.5h.01" />
    </>
  ),
  bolt: <path d="M13 2 4 14h7l-1 8 9-12h-7z" />,
  chat: <path d="M21 12a8 8 0 0 1-11.5 7.2L4 20l1-4.5A8 8 0 1 1 21 12z" />,
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4M9 16l2 2 4-4" />
    </>
  ),
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 7 9 6 9-6" />
    </>
  ),
  database: (
    <>
      <ellipse cx="12" cy="6" rx="8" ry="3" />
      <path d="M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />
    </>
  ),
  code: <path d="m8 8-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14" />,
  workflow: (
    <>
      <rect x="3" y="3" width="7" height="6" rx="1.5" />
      <rect x="14" y="15" width="7" height="6" rx="1.5" />
      <path d="M6.5 9v3.5a2 2 0 0 0 2 2h7a2 2 0 0 1 2 2V15M17.5 3v6M14.5 6l3 3 3-3" />
    </>
  ),
  tooth: (
    <path d="M7 3C4.8 3 3 4.8 3 7.2c0 2 .8 3.3 1.5 4.8.7 1.6.9 3.5 1.3 5.5.3 1.6.8 3.5 2 3.5s1.5-1.7 1.8-3.3c.3-1.5.9-2.7 2.4-2.7s2.1 1.2 2.4 2.7c.3 1.6.6 3.3 1.8 3.3s1.7-1.9 2-3.5c.4-2 .6-3.9 1.3-5.5.7-1.5 1.5-2.8 1.5-4.8C21 4.8 19.2 3 17 3c-2 0-3 1-5 1S9 3 7 3z" />
  ),
  paw: (
    <>
      <circle cx="5.5" cy="10.5" r="2" />
      <circle cx="9" cy="5.5" r="2" />
      <circle cx="15" cy="5.5" r="2" />
      <circle cx="18.5" cy="10.5" r="2" />
      <path d="M12 12c-2.5 0-5 3.5-5 6 0 1.7 1.3 2.5 2.7 2.2 1-.2 1.5-.7 2.3-.7s1.3.5 2.3.7c1.4.3 2.7-.5 2.7-2.2 0-2.5-2.5-6-5-6z" />
    </>
  ),
  mirror: (
    <>
      <circle cx="12" cy="9" r="6" />
      <path d="M12 15v6M9 21h6M9.5 6.5a3.5 3.5 0 0 1 3-1.5" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.7 3.8 5.7 3.8 9s-1.3 6.3-3.8 9c-2.5-2.7-3.8-5.7-3.8-9S9.5 5.7 12 3z" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  gift: (
    <>
      <rect x="3" y="8" width="18" height="4" rx="1" />
      <path d="M5 12v8h14v-8M12 8v12M12 8S10.5 3.5 8 4.2C6 4.8 6.6 8 9 8M12 8s1.5-4.5 4-3.8c2 .6 1.4 3.8-1 3.8" />
    </>
  ),
  shield: <path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6zM9 12l2 2 4-4" />,
  lock: (
    <>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
  chevronLeft: <path d="m15 6-6 6 6 6" />,
  chevronRight: <path d="m9 6 6 6-6 6" />,
  store: <path d="M4 10v10h16V10M3 5l1.5-2h15L21 5v2a3 3 0 0 1-6 0 3 3 0 0 1-6 0 3 3 0 0 1-6 0zM10 20v-5h4v5" />,
  sparkle: <path d="m12 3 1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.7 1.8 1.8.7-1.8.7L19 21l-.7-1.8-1.8-.7 1.8-.7z" />,
  arrowRight: <path d="M5 12h14M13 6l6 6-6 6" />,
  arrowLeft: <path d="M19 12H5M11 6l-6 6 6 6" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
};

export function Icon({ name, className = 'size-6', strokeWidth = 1.8 }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {PATHS[name]}
    </svg>
  );
}

// Filled teal circle with a dark tick, used instead of bullets.
export function CheckDot({ className = '' }) {
  return (
    <span aria-hidden="true" className={`inline-grid size-[18px] flex-none place-items-center rounded-full bg-circuit-teal text-midnight-plum ${className}`}>
      <Icon name="check" className="size-3" strokeWidth={3} />
    </span>
  );
}
