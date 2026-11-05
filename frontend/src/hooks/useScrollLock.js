import { useEffect } from 'react';
import { useLenis } from 'lenis/react';

// Freezes page scrolling while `locked` is true (e.g. behind a modal).
// With Lenis running, lenis.stop() also stops wheel/touch handling and adds `overflow: clip`
// to <html>. Without it (e.g. before Lenis has started), fall back to plain overflow hidden.
export function useScrollLock(locked) {
  const lenis = useLenis();

  useEffect(() => {
    if (!locked) return;
    if (lenis) {
      lenis.stop();
      return () => lenis.start();
    }
    const html = document.documentElement;
    const previous = html.style.overflow;
    html.style.overflow = 'hidden';
    return () => {
      html.style.overflow = previous;
    };
  }, [locked, lenis]);
}
