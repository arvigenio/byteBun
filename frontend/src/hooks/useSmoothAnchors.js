import { useEffect } from 'react';
import { useLenis } from 'lenis/react';

// Same-page links (#services, #faq, ...) scroll with Lenis instead of jumping.
// Lenis's own `anchors` option doesn't cancel the browser's jump, so the two would fight;
// this handles the click fully:
//  - scrolls with Lenis (it honors each target's scroll-margin-top, so the sticky header
//    doesn't cover headings; it's instant when the user prefers reduced motion)
//  - updates the URL hash so the link can be shared and Back works
//  - moves keyboard focus to the target, like a native anchor jump does
// Modified clicks (new tab, etc.) and links to other pages are left to the browser.
export function useSmoothAnchors() {
  const lenis = useLenis();

  useEffect(() => {
    if (!lenis) return;

    const onClick = (e) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const link = e.target.closest?.('a[href^="#"]');
      if (!link || link.target === '_blank') return;
      const hash = link.getAttribute('href');
      const target = hash.length > 1 && document.getElementById(decodeURIComponent(hash.slice(1)));
      if (!target) return;

      e.preventDefault();
      if (location.hash !== hash) history.pushState(null, '', hash);
      lenis.scrollTo(target, { onComplete: () => focusWithoutScroll(target) });
    };

    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, [lenis]);
}

function focusWithoutScroll(el) {
  if (!el.hasAttribute('tabindex')) {
    el.setAttribute('tabindex', '-1');
    el.addEventListener('blur', () => el.removeAttribute('tabindex'), { once: true });
  }
  el.focus({ preventScroll: true });
}
