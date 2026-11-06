import { useEffect, useRef } from 'react';

// One celebratory burst on a full-screen canvas. Decorative only: hidden from screen readers,
// ignores clicks, and does nothing when the visitor prefers reduced motion.
// Colors come from the brand tokens in index.css, so there is no hex here.
const TOKENS = ['--color-bun-orange', '--color-honey-gold', '--color-circuit-teal', '--color-soft-violet', '--color-byte-purple'];
const PIECES = 140;
const DURATION_MS = 3800;

export function Confetti() {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const styles = getComputedStyle(document.documentElement);
    const colors = TOKENS.map((t) => styles.getPropertyValue(t).trim()).filter(Boolean);

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener('resize', resize);

    // Two cannons from the lower corners, aimed up and inward.
    const w = window.innerWidth;
    const h = window.innerHeight;
    const pieces = Array.from({ length: PIECES }, (_, i) => {
      const left = i % 2 === 0;
      const angle = (left ? -60 : -120) * (Math.PI / 180) + (Math.random() - 0.5) * 0.7;
      const speed = 9 + Math.random() * 9;
      return {
        x: left ? w * 0.1 : w * 0.9,
        y: h * 0.85,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 6 + Math.random() * 7,
        rot: Math.random() * Math.PI,
        spin: (Math.random() - 0.5) * 0.3,
        color: colors[i % colors.length],
        round: Math.random() < 0.3,
      };
    });

    let frame;
    const start = performance.now();
    const tick = (now) => {
      const elapsed = now - start;
      ctx.clearRect(0, 0, w, h);
      ctx.globalAlpha = Math.max(0, 1 - Math.max(0, elapsed - DURATION_MS * 0.6) / (DURATION_MS * 0.4));
      for (const p of pieces) {
        p.vy += 0.28; // gravity
        p.vx *= 0.985; // air
        p.vy *= 0.985;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.spin;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        if (p.round) {
          ctx.beginPath();
          ctx.arc(0, 0, p.size / 2.5, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        }
        ctx.restore();
      }
      if (elapsed < DURATION_MS) frame = requestAnimationFrame(tick);
      else ctx.clearRect(0, 0, w, h);
    };
    frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return <canvas ref={canvasRef} aria-hidden="true" className="pointer-events-none fixed inset-0 z-50 size-full" />;
}
