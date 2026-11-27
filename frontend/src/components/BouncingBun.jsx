import { useEffect, useId, useState } from 'react';

// The loading indicator everywhere a page waits: a happy little bun bouncing (squash and stretch),
// blinking, its shadow breathing with each hop, crumbs popping when it lands, and a rotating
// baker's message. With "reduce motion" it just sits there smiling.

const MESSAGES = ['Proofing the dough…', 'Warming up the oven…', 'Kneading the bits…', 'Adding sesame seeds…', 'Almost out of the oven…', 'Fluffing it up…'];

const STYLE = `
@keyframes bb-hop { 0%,100% { transform: translateY(0) scale(1.12,.86); } 18% { transform: translateY(-6px) scale(.94,1.08); } 50% { transform: translateY(-34px) scale(1,1) rotate(-6deg); } 70% { transform: translateY(-14px) scale(.98,1.03) rotate(4deg); } 88% { transform: translateY(0) scale(1.08,.9); } }
@keyframes bb-shadow { 0%,100% { transform: scaleX(1); opacity: .35; } 50% { transform: scaleX(.55); opacity: .15; } }
@keyframes bb-blink { 0%,44%,48%,100% { transform: scaleY(1); } 46% { transform: scaleY(.1); } }
@keyframes bb-crumb-l { 0%,80% { opacity: 0; transform: translate(0,0); } 88% { opacity: 1; } 100% { opacity: 0; transform: translate(-14px,-10px); } }
@keyframes bb-crumb-r { 0%,80% { opacity: 0; transform: translate(0,0); } 88% { opacity: 1; } 100% { opacity: 0; transform: translate(14px,-12px); } }
@keyframes bb-fade { 0% { opacity: 0; transform: translateY(4px); } 15%,85% { opacity: 1; transform: none; } 100% { opacity: 0; } }
.bb-bun { transform-origin: 50% 100%; animation: bb-hop 1.1s cubic-bezier(.45,0,.55,1) infinite; }
.bb-shadow { transform-origin: 50% 50%; animation: bb-shadow 1.1s cubic-bezier(.45,0,.55,1) infinite; }
.bb-eyes { transform-origin: 50% 54%; transform-box: fill-box; animation: bb-blink 3.3s infinite; }
.bb-crumb-l { animation: bb-crumb-l 1.1s infinite; }
.bb-crumb-r { animation: bb-crumb-r 1.1s infinite; }
.bb-msg { animation: bb-fade 2.4s ease-in-out infinite; }
@keyframes bb-mini-hop { 0%,100% { transform: translateY(0) scale(1.06,.94); } 45% { transform: translateY(-12%) scale(.97,1.04) rotate(-5deg); } 75% { transform: translateY(0) scale(1.04,.96); } }
@keyframes bb-wiggle { 0%,100% { transform: rotate(0); } 25% { transform: rotate(-8deg); } 75% { transform: rotate(8deg); } }
.bb-mini-hop { transform-origin: 50% 100%; animation: bb-mini-hop .9s ease-in-out infinite; }
.bb-wiggle:hover { animation: bb-wiggle .5s ease-in-out; }
@media (prefers-reduced-motion: reduce) { .bb-bun, .bb-shadow, .bb-eyes, .bb-crumb-l, .bb-crumb-r, .bb-msg, .bb-mini-hop, .bb-wiggle:hover { animation: none; } }
`;

export function BouncingBun({ label, size = 72, className = '', fun = true }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (label || !fun) return undefined;
    const t = setInterval(() => setI((x) => (x + 1) % MESSAGES.length), 2400);
    return () => clearInterval(t);
  }, [label, fun]);
  const text = label ?? (fun ? MESSAGES[i] : 'Loading…');
  return (
    <div className={`flex flex-col items-center justify-center gap-3 ${className.includes('py-') ? '' : 'py-12'} ${className}`} role="status" aria-live="polite">
      <style>{STYLE}</style>
      <svg width={size} height={size * 1.05} viewBox="0 0 100 105" aria-hidden="true" style={{ overflow: 'visible' }}>
        <defs>
          <radialGradient id="bb-crust" cx="40%" cy="30%" r="75%">
            <stop offset="0%" stopColor="#F9C77E" />
            <stop offset="55%" stopColor="#E89A45" />
            <stop offset="100%" stopColor="#C4722B" />
          </radialGradient>
        </defs>
        {/* Shadow */}
        <ellipse className="bb-shadow" cx="50" cy="98" rx="30" ry="5" fill="#000" />
        {/* Crumbs on landing */}
        <circle className="bb-crumb-l" cx="24" cy="92" r="2.4" fill="#E89A45" />
        <circle className="bb-crumb-r" cx="76" cy="92" r="2" fill="#F9C77E" />
        <g className="bb-bun">
          {/* The bun */}
          <path d="M8 74 C8 38 28 20 50 20 C72 20 92 38 92 74 C92 86 80 92 50 92 C20 92 8 86 8 74Z" fill="url(#bb-crust)" />
          {/* Its base */}
          <path d="M10 76 C14 88 30 92 50 92 C70 92 86 88 90 76 C84 82 68 85 50 85 C32 85 16 82 10 76Z" fill="#B5651F" opacity=".55" />
          {/* Shine */}
          <ellipse cx="34" cy="36" rx="12" ry="6" fill="#fff" opacity=".35" transform="rotate(-24 34 36)" />
          {/* Sesame seeds */}
          {[
            [44, 28, -20],
            [58, 30, 25],
            [70, 40, 50],
            [30, 46, -50],
            [52, 40, 5],
            [64, 52, 35],
          ].map(([x, y, r], n) => (
            <ellipse key={n} cx={x} cy={y} rx="3.2" ry="1.6" fill="#FFF6E5" transform={`rotate(${r} ${x} ${y})`} />
          ))}
          {/* Face */}
          <g className="bb-eyes">
            <ellipse cx="38" cy="62" rx="3.6" ry="4.4" fill="#3B2314" />
            <ellipse cx="62" cy="62" rx="3.6" ry="4.4" fill="#3B2314" />
            <circle cx="39.3" cy="60.4" r="1.2" fill="#fff" />
            <circle cx="63.3" cy="60.4" r="1.2" fill="#fff" />
          </g>
          <ellipse cx="29" cy="70" rx="5" ry="3" fill="#F2706B" opacity=".45" />
          <ellipse cx="71" cy="70" rx="5" ry="3" fill="#F2706B" opacity=".45" />
          <path d="M44 70 Q50 76 56 70" fill="none" stroke="#3B2314" strokeWidth="2.6" strokeLinecap="round" />
        </g>
      </svg>
      {text && (
        <p key={text} className={`text-sm font-medium opacity-70 ${label ? '' : 'bb-msg'}`}>
          {text}
        </p>
      )}
    </div>
  );
}

/**
 * The bun on its own (no shadow or crumbs), for avatars: the chatbots' launcher, header and
 * messages. hop: it bounces (e.g. while typing). blink: its eyes blink now and then.
 */
export function BunFace({ size = 32, hop = false, blink = true, className = '', title }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg width={size} height={size} viewBox="4 14 92 82" className={`${hop ? 'bb-mini-hop' : ''} ${className}`} role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true} style={{ overflow: 'visible' }}>
      <style>{STYLE}</style>
      <defs>
        <radialGradient id={`bf-${id}`} cx="40%" cy="30%" r="75%">
          <stop offset="0%" stopColor="#F9C77E" />
          <stop offset="55%" stopColor="#E89A45" />
          <stop offset="100%" stopColor="#C4722B" />
        </radialGradient>
      </defs>
      <path d="M8 74 C8 38 28 20 50 20 C72 20 92 38 92 74 C92 86 80 92 50 92 C20 92 8 86 8 74Z" fill={`url(#bf-${id})`} />
      <path d="M10 76 C14 88 30 92 50 92 C70 92 86 88 90 76 C84 82 68 85 50 85 C32 85 16 82 10 76Z" fill="#B5651F" opacity=".55" />
      <ellipse cx="34" cy="36" rx="12" ry="6" fill="#fff" opacity=".35" transform="rotate(-24 34 36)" />
      {[
        [44, 28, -20],
        [58, 30, 25],
        [70, 40, 50],
        [30, 46, -50],
        [52, 40, 5],
      ].map(([x, y, r], n) => (
        <ellipse key={n} cx={x} cy={y} rx="3.4" ry="1.7" fill="#FFF6E5" transform={`rotate(${r} ${x} ${y})`} />
      ))}
      <g className={blink ? 'bb-eyes' : undefined}>
        <ellipse cx="38" cy="62" rx="4" ry="4.8" fill="#3B2314" />
        <ellipse cx="62" cy="62" rx="4" ry="4.8" fill="#3B2314" />
        <circle cx="39.4" cy="60.3" r="1.4" fill="#fff" />
        <circle cx="63.4" cy="60.3" r="1.4" fill="#fff" />
      </g>
      <ellipse cx="28" cy="71" rx="5.5" ry="3.2" fill="#F2706B" opacity=".5" />
      <ellipse cx="72" cy="71" rx="5.5" ry="3.2" fill="#F2706B" opacity=".5" />
      <path d="M43 70 Q50 77 57 70" fill="none" stroke="#3B2314" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
