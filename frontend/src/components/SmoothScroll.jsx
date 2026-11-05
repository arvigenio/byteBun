import { ReactLenis } from 'lenis/react';
import 'lenis/dist/lenis.css';
import { useSmoothAnchors } from '../hooks/useSmoothAnchors.js';

// Lenis smooth scrolling for the whole page (root instance, scrolls <html>).
// Reduced motion is honored by Lenis itself (respectReducedMotion, on by default):
// wheel scrolling stays native and programmatic scrolls jump instantly.
const LENIS_OPTIONS = {
  autoRaf: true,
  lerp: 0.1,
  stopInertiaOnNavigate: true,
};

export function SmoothScroll({ children }) {
  return (
    <ReactLenis root options={LENIS_OPTIONS}>
      <SmoothAnchors />
      {children}
    </ReactLenis>
  );
}

// Must sit inside <ReactLenis> so useLenis() can see the instance.
function SmoothAnchors() {
  useSmoothAnchors();
  return null;
}
