import { useEffect, useState } from 'react';
import { InstallApp } from './components/InstallApp.jsx';
import { authHttp, useConfigQuery, useMeQuery, useSetActiveBusinessMutation } from './api.js';
import { bookingsBase, go, PRODUCT, signInUrl, surface, welcomeUrl } from './lib/surface.js';
import { usePathname } from '../lib/router.js';
import { Button, Icon, ICONS, Loading, NavLink } from './ui.jsx';
import { useChatLive, useChatUnread } from './lib/chatLive.js';

// Signed-in pages: makes sure there is a session and a business, sends packaged clients to the
// portal, then renders the shell (standalone Bookings or the client portal) around the page.
// The API checks everything again; this only picks the right screen.
export function AppGate({ shell, app, page, bare = false }) {
  const { data: cfg } = useConfigQuery();
  const me = useMeQuery();
  const status = me.error?.status;
  const business = me.data?.business;

  useEffect(() => {
    if (!cfg) return;
    if (status === 401) go(signInUrl(cfg));
    else if (me.data && !business) go(welcomeUrl(cfg));
    // Packaged clients use Bookings inside the portal.
    else if (business && shell === 'bookings' && business.landing === 'portal') go(`${cfg.portalUrl}/bookings${window.location.pathname.slice(bookingsBase.length)}${window.location.search}`);
  }, [cfg, status, me.data, business, shell]);

  if (me.isLoading || !cfg || status === 401 || (me.data && !business)) return <Loading screen />;
  if (me.error) return <Centered title="Something went wrong">{me.error.message}</Centered>;
  if (business.status !== 'active') {
    return <Centered title="This account is unavailable">Please contact Byte Bun support for help.</Centered>;
  }
  if (app && !business.apps.some((a) => a.key === app && a.enabled)) {
    return <Centered title="Not in your plan">Your plan does not include this app. Contact Byte Bun to add it.</Centered>;
  }
  // A full-screen page (the check-in scanner): no header or menu.
  if (bare) return page;
  return (
    <Shell shell={shell} me={me.data} cfg={cfg}>
      {page}
    </Shell>
  );
}

export function Centered({ title, children, action }) {
  return (
    <main className="grid min-h-screen place-items-center px-4">
      <div className="w-full max-w-md rounded-card border border-line bg-surface p-8 text-center">
        <h1 className="text-xl font-semibold">{title}</h1>
        <div className="mt-2 text-sm text-muted">{children}</div>
        {action && <div className="mt-5">{action}</div>}
      </div>
    </main>
  );
}

async function signOut() {
  try {
    await authHttp.post('/sign-out', {});
  } finally {
    window.location.assign('/sign-in');
  }
}

// `need`: the permission the page needs (the API checks again); none = everyone.
const BOOKINGS_NAV = [
  { href: '/dashboard', label: 'Dashboard', icon: ICONS.grid, need: 'bookings.view' },
  { href: '', label: 'Bookings', icon: ICONS.calendar, need: 'bookings.view' },
  { href: '/events', label: 'Events', icon: ICONS.star, need: 'events.view' },
  { href: '/chat', label: 'Team chat', icon: ICONS.chat, chat: true },
  { href: '/services', label: 'Services', icon: ICONS.tag, need: 'bookings.view' },
  { href: '/schedule', label: 'Schedule', icon: ICONS.clock, need: 'bookings.view' },
  { href: '/page', label: 'Booking page', icon: ICONS.palette, need: 'bookings.view' },
  { href: '/team', label: 'Team', icon: ICONS.users, need: 'team.view' },
  { href: '/plan', label: 'Plan', icon: ICONS.star },
  { href: '/account', label: 'Account', icon: ICONS.user },
];

function Mark() {
  return <img src={surface === 'portal' ? '/client/portal-icon.svg' : '/client/bookings-icon.svg'} alt="" className="size-8 rounded-lg" />;
}

/** The app switcher. In the portal: every app, the ones in the plan open, and Home. In Bookings: only the apps in the plan. */
function AppSwitcher({ business, cfg }) {
  const [open, setOpen] = useState(false);
  const apps = surface === 'portal' ? business.apps : business.apps.filter((a) => a.enabled);
  // Nothing to switch to (just Bookings itself, no portal): no switcher.
  if (business.landing !== 'portal' && apps.every((a) => a.key === 'bookings')) return null;
  const appUrl = (key) => (key === 'bookings' ? (surface === 'portal' || business.landing === 'portal' ? `${cfg.portalUrl}/bookings` : `${cfg.bookingsUrl}/app`) : null);
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex cursor-pointer items-center rounded-lg p-2 text-muted hover:bg-sunken hover:text-ink" aria-expanded={open} aria-label="Switch app">
        <Icon d={ICONS.grid} />
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-72 rounded-card border border-line bg-surface p-2 shadow-lg" onMouseLeave={() => setOpen(false)}>
          {business.landing === 'portal' && (
            <a href={`${cfg.portalUrl}/`} className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium hover:bg-sunken">
              <img src="/client/portal-icon.svg" alt="" className="size-7 rounded-md" /> Client portal home
            </a>
          )}
          {apps.map((a) => {
            const href = a.enabled && a.live ? appUrl(a.key) : null;
            return href ? (
              <a key={a.key} href={href} className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-sunken">
                <span className="grid size-7 place-items-center rounded-md bg-brand-soft text-xs font-bold text-brand">{a.name[0]}</span>
                <span className="font-medium">{a.name}</span>
              </a>
            ) : (
              <div key={a.key} className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-faint">
                <span className="grid size-7 place-items-center rounded-md bg-sunken text-xs font-bold">{a.name[0]}</span>
                <span>{a.name}</span>
                <span className="ml-auto text-xs">{a.live ? 'Not in plan' : 'Coming soon'}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function BusinessSwitcher({ me }) {
  const [setActive] = useSetActiveBusinessMutation();
  if (me.businesses.length < 2) return <span className="truncate text-sm font-medium text-muted">{me.business.name}</span>;
  return (
    <select
      value={me.business.id}
      onChange={async (e) => {
        await setActive(e.target.value);
        window.location.reload();
      }}
      className="max-w-48 cursor-pointer truncate rounded-md border border-line bg-surface px-2 py-1 text-sm"
      aria-label="Business"
    >
      {me.businesses.map((b) => (
        <option key={b.id} value={b.id}>
          {b.name}
        </option>
      ))}
    </select>
  );
}

function Shell({ shell, me, cfg, children }) {
  const path = usePathname().replace(/\/+$/, '');
  const [menu, setMenu] = useState(false);
  const inBookings = path === bookingsBase || path.startsWith(`${bookingsBase}/`);
  const nav = BOOKINGS_NAV.filter((n) => !n.need || me.business.permissions.includes(n.need));
  // The team chat: live everywhere in the app, unread count in the menu.
  const chatOn = !!me.business;
  useChatLive(chatOn);
  const unread = useChatUnread(chatOn);
  const links = (
    <>
      {shell === 'portal' && (
        <NavLink href="/" active={path === ''}>
          Home
        </NavLink>
      )}
      {(shell === 'bookings' || inBookings) &&
        nav.map((n) => {
          const href = `${bookingsBase}${n.href}`;
          return (
            <NavLink key={n.href} href={href} active={n.href ? path.startsWith(href) : path === bookingsBase}>
              <span className="flex w-full items-center gap-2.5">
                <Icon d={n.icon} className="size-[18px]" />
                {shell === 'portal' ? n.label.replace(/^Bookings$/, 'All bookings') : n.label}
                {n.chat && unread > 0 && (
                  <span className="ml-auto rounded-full bg-brand px-2 py-0.5 text-xs font-bold text-brand-ink" aria-label={`${unread} unread`}>
                    {unread > 99 ? '99+' : unread}
                  </span>
                )}
              </span>
            </NavLink>
          );
        })}
      {shell === 'portal' && !inBookings && (
        <NavLink href={bookingsBase} active={false}>
          Bookings
        </NavLink>
      )}
    </>
  );

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-20 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-3 px-4">
          <button type="button" className="cursor-pointer rounded-md p-1.5 desktop:hidden" onClick={() => setMenu((m) => !m)} aria-label="Menu" aria-expanded={menu}>
            <Icon d={ICONS.menu} />
          </button>
          <a href={shell === 'portal' ? '/' : bookingsBase} className="flex items-center gap-2.5 font-semibold">
            <Mark />
            <span className="mobile:hidden">{PRODUCT.name}</span>
          </a>
          <span className="mx-1 h-5 w-px bg-line mobile:hidden" />
          <BusinessSwitcher me={me} />
          <div className="ml-auto flex items-center gap-1">
            <InstallApp />
            <AppSwitcher business={me.business} cfg={cfg} />
            <Button variant="ghost" size="sm" onClick={signOut} title={me.user.email}>
              Sign out
            </Button>
          </div>
        </div>
      </header>
      <div className="mx-auto flex max-w-6xl gap-8 px-4 py-6">
        <nav className={`w-52 shrink-0 flex-col gap-1 mobile:fixed mobile:inset-x-0 mobile:top-14 mobile:z-10 mobile:w-full mobile:border-b mobile:border-line mobile:bg-surface mobile:p-3 ${menu ? 'flex' : 'flex mobile:hidden'}`} onClick={() => setMenu(false)} aria-label="Main">
          {links}
        </nav>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}

