import { useEffect, useState } from 'react';
import { site } from '../content/site.js';
import { Confetti } from './Confetti.jsx';
import { Eyebrow } from './ui/Section.jsx';
import { Icon } from './ui/Icon.jsx';

const b = site.getStarted.bonus;
const delay = (ms) => ({ animationDelay: `${ms}ms` });
const prefersReducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// "brightsmile dental & spa" -> "brightsmiledentalspa" (letters and digits only, kept short).
function domainFrom(businessName, businessType) {
  const slug = (businessName ?? '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 24);
  return `www.${slug || b.fallbackNames[businessType] || b.fallbackName}.com`;
}

// The promo step between "Features" and "Name": free website, domain, and hosting.
// Confetti on arrival, a browser that types the visitor's future address, and three perks
// that get stamped FREE one after another. Without motion, everything is shown at once.
export function BonusStep({ c, title }) {
  const domain = domainFrom(c.values.businessName, c.values.businessType);
  return (
    <div data-surface="dark" className="relative isolate overflow-clip rounded-card bg-byte-purple p-7 text-lavender-mist mobile:-mx-1 mobile:p-5">
      <Confetti />
      <Sparkles />
      {/* Slow sheen across the panel */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 bg-[linear-gradient(110deg,transparent_30%,var(--color-soft-violet)_50%,transparent_70%)] bg-size-[250%_100%] opacity-40 motion-safe:animate-sheen"
      />

      <div className="flex items-center gap-2.5 motion-safe:animate-pop">
        <span className="grid size-10 place-items-center rounded-full bg-honey-gold text-midnight-plum motion-safe:animate-wiggle">
          <Icon name="gift" className="size-5" strokeWidth={2} />
        </span>
        <Eyebrow className="mb-0! text-honey-gold!">{b.eyebrow}</Eyebrow>
      </div>
      <h2 className="mt-4 text-[clamp(24px,3vw,30px)] leading-tight text-cream-dough motion-safe:animate-rise" style={delay(120)}>
        {title}
      </h2>
      <p className="mt-2 text-[15px] motion-safe:animate-rise" style={delay(220)}>
        {b.text}
      </p>

      <BrowserPreview domain={domain} />

      <ul className="mt-6 grid gap-3">
        {b.perks.map((perk, i) => (
          <Perk key={perk.title} perk={perk} index={i} />
        ))}
      </ul>

      <p className="mt-5 text-xs text-lavender-mist/80 motion-safe:animate-rise mobile:text-[13px]" style={delay(1500)}>
        {b.finePrint}
      </p>
    </div>
  );
}

// A small browser window: the address types itself out, then a sample page fades in.
function BrowserPreview({ domain }) {
  const [typed, setTyped] = useState(() => (prefersReducedMotion() ? domain.length : 0));
  useEffect(() => {
    if (prefersReducedMotion()) {
      setTyped(domain.length);
      return undefined;
    }
    setTyped(0);
    let n = 0;
    const timer = setInterval(() => {
      n += 1;
      setTyped(n);
      if (n >= domain.length) clearInterval(timer);
    }, 55);
    return () => clearInterval(timer);
  }, [domain]);
  const done = typed >= domain.length;

  return (
    <figure className="mt-6 motion-safe:animate-rise" style={delay(320)}>
      <figcaption className="mb-2 text-[13px] font-semibold text-cream-dough">{b.previewLabel}</figcaption>
      <div className="overflow-hidden rounded-xl bg-cream-dough text-midnight-plum shadow-[0_18px_40px_-18px] shadow-midnight-plum">
        <div className="flex items-center gap-2 border-b border-line bg-lavender-mist px-3 py-2">
          <span aria-hidden="true" className="flex gap-1.5">
            <span className="size-2.5 rounded-full bg-bun-orange" />
            <span className="size-2.5 rounded-full bg-honey-gold" />
            <span className="size-2.5 rounded-full bg-circuit-teal" />
          </span>
          <div className="flex min-w-0 flex-1 items-center gap-1.5 rounded-full bg-cream-dough px-3 py-1 text-[13px] font-semibold">
            <Icon name="lock" className="size-3.5 flex-none text-circuit-teal" strokeWidth={2.4} />
            <span className="truncate">
              <span className="sr-only">{domain}</span>
              <span aria-hidden="true">{domain.slice(0, typed)}</span>
            </span>
            <span aria-hidden="true" className={`h-4 w-px flex-none bg-byte-purple ${done ? 'motion-safe:animate-blink' : ''}`} />
          </div>
        </div>
        {/* Sample page: skeleton blocks that "load" once the address is typed */}
        <div aria-hidden="true" className={`grid gap-2 p-4 transition-opacity duration-500 ${done ? 'opacity-100' : 'opacity-0'}`}>
          <div className="flex items-center justify-between">
            <span className="h-2.5 w-20 rounded-full bg-byte-purple" />
            <span className="h-5 w-16 rounded-full bg-bun-orange" />
          </div>
          <span className="mt-1 h-3.5 w-3/4 rounded-full bg-byte-purple/80" />
          <span className="h-2.5 w-1/2 rounded-full bg-line" />
          <div className="mt-1 grid grid-cols-3 gap-2">
            <span className="h-10 rounded-lg bg-lavender-mist" />
            <span className="h-10 rounded-lg bg-lavender-mist" />
            <span className="h-10 rounded-lg bg-lavender-mist" />
          </div>
        </div>
      </div>
      <p className="mt-1.5 text-xs text-lavender-mist/70 mobile:text-[13px]">{b.previewNote}</p>
    </figure>
  );
}

// One perk: slides in, "Separate bill" gets struck through, then a FREE stamp lands.
function Perk({ perk, index }) {
  const start = 700 + index * 260;
  return (
    <li
      className="flex items-center gap-3.5 rounded-xl bg-cream-dough/8 p-3.5 ring-1 ring-cream-dough/12 motion-safe:animate-step-next"
      style={delay(start)}
    >
      <span className="grid size-11 flex-none place-items-center rounded-xl bg-circuit-teal/15 text-circuit-teal">
        <Icon name={perk.icon} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="leading-snug font-bold text-cream-dough">{perk.title}</p>
        <p className="mt-0.5 text-[13px] leading-snug mobile:text-sm">
          {perk.caption}
          <span className="sr-only">. {b.free}.</span>
        </p>
      </div>
      <div aria-hidden="true" className="flex flex-none flex-col items-end gap-1">
        <span className="relative text-xs text-lavender-mist/70">
          {b.was}
          {/* the strike line draws across */}
          <span className="absolute inset-x-0 top-1/2 h-px origin-left bg-bun-orange motion-safe:animate-strike" style={delay(start + 250)} />
        </span>
        <span
          className="rounded-md border-2 border-honey-gold px-2 py-0.5 text-sm font-black tracking-[0.12em] text-honey-gold uppercase -rotate-6 motion-safe:animate-stamp"
          style={delay(start + 450)}
        >
          {b.free}
        </span>
      </div>
    </li>
  );
}

// A few twinkling sparkles in the corners. Decorative.
function Sparkles() {
  const spots = [
    { className: 'top-5 right-6 size-5', delay: 0 },
    { className: 'top-16 right-20 size-3', delay: 600 },
    { className: 'top-1/3 right-4 size-4', delay: 1200 },
    { className: 'bottom-24 left-3 size-3', delay: 300 },
  ];
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10">
      {spots.map((s) => (
        <span key={s.className} className={`absolute text-honey-gold motion-safe:animate-twinkle ${s.className}`} style={delay(s.delay)}>
          <Icon name="sparkle" className="size-full" strokeWidth={1.6} />
        </span>
      ))}
    </div>
  );
}
