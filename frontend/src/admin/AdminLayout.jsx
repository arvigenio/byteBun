import { Toaster } from 'sonner';
import { signOut } from '../api/adminAuth.js';
import { Logo } from '../components/Logo.jsx';
import { useAdminRealtime } from '../hooks/admin/useAdminRealtime.js';
import { useAdminShell } from '../hooks/admin/useAdminShell.js';
import { onRouteLinkClick } from '../lib/router.js';
import { LeadDrawer } from './LeadDrawer.jsx';
import { AdminButton } from './ui.jsx';

const NAV = [
  { href: '/admin/leads', label: 'Leads', hint: 'Everyone who filled in the form', icon: 'M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z' },
  { href: '/admin/bookings', label: 'Bookings', hint: 'Calendar of booked calls', icon: 'M8 7V3m8 4V3M4 11h16M5 5h14a1 1 0 011 1v13a1 1 0 01-1 1H5a1 1 0 01-1-1V6a1 1 0 011-1z' },
  { href: '/admin/prospects', label: 'Prospecting', hint: 'Find businesses to pitch', icon: 'M12 21s-7-6.1-7-11.5A7 7 0 0119 9.5C19 14.9 12 21 12 21zM12 12a2.5 2.5 0 100-5 2.5 2.5 0 000 5z' },
  { href: '/admin/security', label: 'Security', hint: 'Sessions and backup codes', icon: 'M12 3l7 3v6c0 4.5-3 7.7-7 9-4-1.3-7-4.5-7-9V6l7-3z' },
];

export async function signOutHere() {
  try {
    await signOut();
  } finally {
    window.location.replace('/');
  }
}

function NavIcon({ d }) {
  return (
    <svg viewBox="0 0 24 24" className="size-5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

// The admin shell: a navigation drawer (always open on desktop, slides in on phones), the
// page, and the lead drawer (one for the whole app).
export function AdminLayout({ pathname, children }) {
  const { me, navOpen, openNav, closeNav } = useAdminShell(pathname);
  const live = useAdminRealtime(me);
  const liveLabel = { live: 'Live updates on', connecting: 'Connecting…', offline: 'Offline, reconnecting…' }[live];

  const nav = (
    <nav className="flex h-full flex-col bg-byte-purple text-cream-dough" aria-label="Admin">
      <div className="flex items-center justify-between gap-3 px-5 py-5">
        <div className="flex items-center gap-2 rounded-btn bg-cream-dough px-3 py-2">
          <Logo className="h-5 w-auto" />
        </div>
        <button type="button" onClick={closeNav} className="cursor-pointer rounded-md p-2 text-lavender-mist desktop:hidden" aria-label="Close menu">
          <NavIcon d="M6 6l12 12M18 6L6 18" />
        </button>
      </div>
      <p className="px-6 pb-2 text-[11px] font-bold tracking-[0.16em] text-lavender-mist/70 uppercase">Admin</p>
      <ul className="flex-1 space-y-1 px-3">
        {NAV.map((n) => {
          const active = pathname.startsWith(n.href);
          return (
            <li key={n.href}>
              <a
                href={n.href}
                onClick={onRouteLinkClick}
                aria-current={active ? 'page' : undefined}
                className={`group flex items-center gap-3 rounded-btn px-3 py-2.5 transition-colors ${active ? 'bg-cream-dough text-byte-purple' : 'text-lavender-mist hover:bg-byte-purple-hover hover:text-cream-dough'}`}
              >
                <NavIcon d={n.icon} />
                <span>
                  <span className="block text-[15px] font-semibold">{n.label}</span>
                  <span className={`block text-xs ${active ? 'text-muted' : 'text-lavender-mist/70'}`}>{n.hint}</span>
                </span>
              </a>
            </li>
          );
        })}
      </ul>
      <div className="border-t border-byte-purple-hover px-5 py-4">
        <div className="mb-3 flex items-center gap-2 text-xs text-lavender-mist/80" role="status" title="New leads and booking changes appear here instantly">
          <span className={`size-2 rounded-full ${live === 'live' ? 'bg-circuit-teal' : 'bg-honey-gold motion-safe:animate-pulse'}`} aria-hidden="true" />
          {liveLabel}
        </div>
        {me && (
          <div className="mb-3 text-sm">
            <div className="font-semibold text-cream-dough">{me.name}</div>
            <div className="truncate text-xs text-lavender-mist/80">{me.email}</div>
          </div>
        )}
        <AdminButton variant="accent" className="min-h-9 w-full py-1.5 text-sm" onClick={signOutHere}>
          Sign out
        </AdminButton>
      </div>
    </nav>
  );

  return (
    <div className="min-h-dvh bg-lavender-mist/40 desktop:pl-64">
      {/* Desktop: fixed sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 w-64 mobile:hidden">{nav}</aside>

      {/* Phone: top bar + slide-in drawer */}
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-cream-dough px-4 py-3 desktop:hidden">
        <button type="button" onClick={openNav} className="cursor-pointer rounded-md p-2 text-byte-purple" aria-label="Open menu" aria-expanded={navOpen}>
          <NavIcon d="M4 7h16M4 12h16M4 17h16" />
        </button>
        <Logo className="h-5 w-auto" />
      </header>
      <div className={`fixed inset-0 z-40 desktop:hidden ${navOpen ? '' : 'pointer-events-none'}`} aria-hidden={!navOpen}>
        <div className={`absolute inset-0 bg-midnight-plum/40 transition-opacity ${navOpen ? 'opacity-100' : 'opacity-0'}`} onClick={closeNav} />
        <div className={`absolute inset-y-0 left-0 w-72 max-w-[85vw] shadow-2xl transition-transform duration-200 ${navOpen ? 'translate-x-0' : '-translate-x-full'}`}>{nav}</div>
      </div>

      <main className="mx-auto max-w-[1180px] px-6 py-8 mobile:px-4 mobile:py-5">{children}</main>
      <LeadDrawer />
      {/* Closable notifications: new leads and booking changes (live), and confirmations. */}
      <Toaster position="top-right" closeButton richColors expand={false} visibleToasts={5} toastOptions={{ duration: 8000 }} />
    </div>
  );
}

export function PageTitle({ title, children, actions }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-[26px] font-bold text-midnight-plum">{title}</h1>
        {children && <p className="mt-1 text-[15px] text-muted">{children}</p>}
      </div>
      {actions}
    </div>
  );
}
