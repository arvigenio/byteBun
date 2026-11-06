import { useLayoutEffect } from 'react';

// Scroll reveal for the landing page. Lenis only smooths scrolling; this does the animation.
//  - `data-reveal` on an element: it fades and slides up the first time it scrolls into view.
//  - `data-reveal="stagger"`: its children do that one after another (cards in a grid).
// The CSS is in index.css. Content is only hidden once this hook has run (the `js-reveal`
// class on <html>), so nothing stays invisible if JavaScript fails, and people who prefer
// reduced motion see everything immediately.
export function useScrollReveal() {
  // Layout effect: hide not-yet-revealed elements before the first paint, so nothing flashes.
  useLayoutEffect(() => {
    if (!('IntersectionObserver' in window)) return undefined;
    const root = document.documentElement;
    root.classList.add('js-reveal');

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add('is-revealed');
          observer.unobserve(entry.target);
        }
      },
      // Trigger a little before the element's top reaches the bottom 8% of the screen.
      { rootMargin: '0px 0px -8% 0px' },
    );
    document.querySelectorAll('[data-reveal]:not(.is-revealed)').forEach((el) => observer.observe(el));

    return () => {
      observer.disconnect();
      root.classList.remove('js-reveal');
    };
  }, []);
}
