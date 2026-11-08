import { useEffect, useState } from 'react';
import { getMe } from '../../api/admin.js';

/** The admin shell: who is signed in, and the phone navigation drawer (closes on navigation and Escape). */
export function useAdminShell(pathname) {
  const [me, setMe] = useState(null);
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    getMe()
      .then((d) => setMe(d.user))
      .catch((err) => err.status === 401 && window.location.replace('/'));
  }, []);

  useEffect(() => setNavOpen(false), [pathname]);

  useEffect(() => {
    if (!navOpen) return undefined;
    const onKey = (e) => e.key === 'Escape' && setNavOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navOpen]);

  return { me, navOpen, openNav: () => setNavOpen(true), closeNav: () => setNavOpen(false) };
}
