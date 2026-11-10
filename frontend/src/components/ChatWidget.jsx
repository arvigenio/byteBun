import { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { site } from '../content/site.js';
import { trackEvent } from '../lib/gtm.js';
import { leadHref, onRouteLinkClick } from '../lib/router.js';
import { closed, opened, sendMessage } from '../store/chatSlice.js';
import { ChatBooking } from './ChatBooking.jsx';
import { Confetti } from './Confetti.jsx';
import { Icon } from './ui/Icon.jsx';

const c = site.chat;
const MAX_CHARS = 1000; // MAX_USER_CHARS in backend/src/chat/chat.schema.ts
const HINT_DELAY_MS = 2500; // the launcher's "Questions?" bubble pops in after this
const CONFETTI_MS = 4000;

// Starter chips cycle through these brand tints.
const CHIP_TONES = [
  'border-soft-violet/40 bg-lavender-mist text-byte-purple hover:border-soft-violet',
  'border-bun-orange/50 bg-gold-tint text-midnight-plum hover:border-bun-orange',
  'border-circuit-teal/50 bg-circuit-teal/12 text-midnight-plum hover:border-circuit-teal',
  'border-byte-purple/30 bg-bun-orange/15 text-byte-purple hover:border-byte-purple',
];
const DOT_COLORS = ['bg-bun-orange', 'bg-circuit-teal', 'bg-soft-violet'];

// The website chatbot, Chatbunny: a launcher button and a chat panel. It answers questions and,
// when the visitor is ready, shows the booking calendar right in the chat (ChatBooking).
// On mobile the launcher sits above the sticky bar and the panel fills the screen.
// Every animation is motion-safe: visitors who prefer reduced motion get the same chat, still.
export function ChatWidget() {
  const dispatch = useDispatch();
  const { open, messages, status, lastText, booked, openedAt } = useSelector((s) => s.chat);
  const [text, setText] = useState('');
  const [showHint, setShowHint] = useState(false);
  const [celebrate, setCelebrate] = useState(false);
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const sending = status === 'sending';
  const lastBookingId = messages.findLast((m) => m.booking)?.id;
  const hasUserMessage = messages.some((m) => m.role === 'user');

  // Keep the newest message in view.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages, sending, open]);

  useEffect(() => {
    if (!open) return undefined;
    inputRef.current?.focus({ preventScroll: true });
    const onKey = (e) => e.key === 'Escape' && dispatch(closed());
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, dispatch]);

  useEffect(() => {
    const timer = setTimeout(() => setShowHint(true), HINT_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (lastBookingId) trackEvent('chat_calendar_shown');
  }, [lastBookingId]);
  useEffect(() => {
    if (!booked) return undefined;
    trackEvent('chat_booked');
    setCelebrate(true);
    const timer = setTimeout(() => setCelebrate(false), CONFETTI_MS);
    return () => clearTimeout(timer);
  }, [booked]);

  const send = (value) => {
    const message = value.trim();
    if (!message || sending) return;
    if (!hasUserMessage) trackEvent('chat_started');
    dispatch(sendMessage(message));
    setText('');
  };

  const onOpen = () => {
    dispatch(opened());
    trackEvent('chat_opened');
  };

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={onOpen}
          aria-label={c.launcherLabel}
          className="group fixed right-5 bottom-5 z-30 flex cursor-pointer items-end gap-2.5 mobile:right-4 mobile:bottom-[calc(76px+env(safe-area-inset-bottom))]"
        >
          {showHint && (
            <span className="relative mb-2 rounded-2xl rounded-br-sm bg-linear-to-r from-byte-purple to-soft-violet px-4 py-2.5 text-sm font-semibold text-cream-dough shadow-xl motion-safe:animate-pop mobile:hidden">
              {c.launcherHint}
              <span className="ml-1.5 inline-block motion-safe:animate-wiggle" aria-hidden="true">
                👋
              </span>
            </span>
          )}
          <span className="relative grid size-16 place-items-center">
            {/* Pulse ring */}
            <span className="absolute inset-0 rounded-full bg-bun-orange/50 motion-safe:animate-ping" aria-hidden="true" />
            <span className="relative grid size-16 place-items-center rounded-full bg-linear-to-br from-bun-orange via-honey-gold to-bun-orange text-midnight-plum shadow-xl ring-4 ring-cream-dough transition-transform duration-200 motion-safe:group-hover:scale-110 motion-safe:group-hover:-rotate-6">
              <span className="motion-safe:animate-hop">
                <Icon name="bunny" className="size-9" strokeWidth={1.9} />
              </span>
            </span>
            {!openedAt && (
              <span className="absolute -top-0.5 -right-0.5 grid size-5 place-items-center rounded-full bg-circuit-teal text-[11px] font-bold text-midnight-plum ring-2 ring-cream-dough motion-safe:animate-bounce" aria-hidden="true">
                1
              </span>
            )}
          </span>
        </button>
      )}

      {open && (
        <section
          role="dialog"
          aria-label={c.title}
          className="fixed right-5 bottom-5 z-50 flex h-[min(660px,calc(100dvh-40px))] w-[400px] origin-bottom-right flex-col overflow-hidden rounded-[22px] border border-line bg-cream-dough shadow-2xl motion-safe:animate-chat-open mobile:inset-0 mobile:h-dvh mobile:w-full mobile:rounded-none mobile:border-0"
        >
          <header
            data-surface="dark"
            className="relative flex flex-none items-center gap-3 overflow-hidden bg-linear-to-r from-byte-purple via-soft-violet to-byte-purple bg-size-[200%_100%] px-4 py-3.5 text-cream-dough motion-safe:animate-gradient-pan"
          >
            {/* Decorative sparkles */}
            <span className="pointer-events-none absolute top-2 right-16 text-honey-gold motion-safe:animate-twinkle" aria-hidden="true">
              <Icon name="sparkle" className="size-4" strokeWidth={2} />
            </span>
            <span className="pointer-events-none absolute right-28 bottom-1.5 text-circuit-teal motion-safe:animate-twinkle [animation-delay:1.2s]" aria-hidden="true">
              <Icon name="sparkle" className="size-3" strokeWidth={2} />
            </span>
            <span className="pointer-events-none absolute -top-10 -left-8 size-28 rounded-full bg-bun-orange/25 blur-2xl motion-safe:animate-drift" aria-hidden="true" />

            <span className="relative grid size-11 flex-none place-items-center rounded-full bg-linear-to-br from-bun-orange to-honey-gold text-midnight-plum shadow-lg ring-2 ring-cream-dough/70">
              <span className="motion-safe:animate-hop">
                <Icon name="bunny" className="size-7" strokeWidth={2} />
              </span>
            </span>
            <div className="relative min-w-0 flex-1">
              <p className="truncate text-base leading-tight font-bold">
                {c.title} <span className="text-xs font-semibold opacity-75">· {c.subtitle}</span>
              </p>
              <p className="mt-0.5 flex items-center gap-1.5 text-xs opacity-90">
                <span className="relative flex size-2" aria-hidden="true">
                  <span className="absolute inline-flex size-full rounded-full bg-circuit-teal opacity-75 motion-safe:animate-ping" />
                  <span className="relative inline-flex size-2 rounded-full bg-circuit-teal" />
                </span>
                {c.status}
              </p>
            </div>
            <button
              type="button"
              onClick={() => dispatch(closed())}
              aria-label={c.closeLabel}
              className="relative grid size-9 cursor-pointer place-items-center rounded-full transition-transform hover:bg-cream-dough/15 motion-safe:hover:rotate-90"
            >
              <Icon name="close" className="size-5" strokeWidth={2} />
            </button>
          </header>

          <div
            ref={listRef}
            data-lenis-prevent
            aria-live="polite"
            className="flex-1 overflow-y-auto overscroll-contain bg-[radial-gradient(circle_at_0%_0%,var(--color-lavender-mist),transparent_55%),radial-gradient(circle_at_100%_100%,var(--color-gold-tint),transparent_50%)] px-4 py-4"
          >
            <ul className="grid gap-3">
              {messages.map((m) =>
                m.role === 'user' ? (
                  <li key={m.id} className="flex justify-end motion-safe:animate-msg-right">
                    <p className="max-w-[82%] rounded-[18px] rounded-br-md bg-linear-to-br from-byte-purple to-soft-violet px-3.5 py-2.5 text-[15px] leading-snug whitespace-pre-line text-cream-dough shadow-md">
                      {m.text}
                    </p>
                  </li>
                ) : (
                  <li key={m.id} className="flex items-end gap-2 motion-safe:animate-msg-left">
                    <span className="grid size-7 flex-none place-items-center rounded-full bg-linear-to-br from-bun-orange to-honey-gold text-midnight-plum shadow-sm" aria-hidden="true">
                      <Icon name="bunny" className="size-4.5" strokeWidth={2.2} />
                    </span>
                    <div className="flex min-w-0 max-w-[85%] flex-col items-start">
                      <p
                        className={`rounded-[18px] rounded-bl-md border-l-4 bg-cream-dough px-3.5 py-2.5 text-[15px] leading-snug whitespace-pre-line shadow-md ring-1 ring-line/70 ${
                          m.failed ? 'border-danger text-danger' : 'border-bun-orange text-midnight-plum'
                        }`}
                      >
                        {m.text}
                      </p>
                      {m.failed && lastText && (
                        <button type="button" onClick={() => send(lastText)} className="mt-1 cursor-pointer text-xs font-semibold text-byte-purple underline">
                          {c.retry}
                        </button>
                      )}
                      {m.offline && (
                        <a
                          href={leadHref('chat-link')}
                          onClick={onRouteLinkClick}
                          className="mt-2 inline-flex min-h-10 items-center gap-1.5 rounded-btn bg-linear-to-r from-bun-orange to-honey-gold px-4 text-sm font-semibold text-midnight-plum shadow-md transition-transform motion-safe:hover:-translate-y-0.5"
                        >
                          {c.offlineCta}
                          <Icon name="arrowRight" className="size-4" strokeWidth={2} />
                        </a>
                      )}
                      {m.id === lastBookingId && <ChatBooking prefill={m.booking} />}
                    </div>
                  </li>
                ),
              )}
              {sending && (
                <li className="flex items-end gap-2 motion-safe:animate-msg-left" aria-label={c.typing}>
                  <span className="grid size-7 flex-none place-items-center rounded-full bg-linear-to-br from-bun-orange to-honey-gold text-midnight-plum shadow-sm motion-safe:animate-hop" aria-hidden="true">
                    <Icon name="bunny" className="size-4.5" strokeWidth={2.2} />
                  </span>
                  <span className="flex gap-1.5 rounded-[18px] rounded-bl-md bg-cream-dough px-4 py-3.5 shadow-md ring-1 ring-line/70">
                    {DOT_COLORS.map((color, i) => (
                      <span key={color} className={`size-2.5 rounded-full ${color} motion-safe:animate-bounce`} style={{ animationDelay: `${i * 150}ms` }} />
                    ))}
                  </span>
                </li>
              )}
            </ul>

            {!hasUserMessage && (
              <div className="mt-4 ml-9 flex flex-wrap gap-2">
                {c.starters.map((s, i) => (
                  <button
                    key={s.text}
                    type="button"
                    onClick={() => send(s.text)}
                    style={{ animationDelay: `${250 + i * 110}ms` }}
                    className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border-2 px-3 py-1.5 text-sm font-semibold shadow-sm transition-transform motion-safe:animate-pop motion-safe:hover:-translate-y-0.5 motion-safe:hover:scale-105 ${CHIP_TONES[i % CHIP_TONES.length]}`}
                  >
                    <Icon name={s.icon} className="size-4" strokeWidth={2} />
                    {s.text}
                  </button>
                ))}
              </div>
            )}
          </div>

          <form
            className="flex flex-none items-end gap-2 border-t border-line bg-cream-dough px-3 pt-3 pb-[calc(8px+env(safe-area-inset-bottom))]"
            onSubmit={(e) => {
              e.preventDefault();
              send(text);
            }}
          >
            <div className="flex-1">
              <textarea
                ref={inputRef}
                rows={1}
                value={text}
                maxLength={MAX_CHARS}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    send(text);
                  }
                }}
                placeholder={c.placeholder}
                aria-label={c.placeholder}
                className="max-h-32 min-h-11 w-full resize-none rounded-2xl border-2 border-line bg-lavender-mist/40 px-3.5 py-2.5 text-[15px] text-midnight-plum transition-colors outline-none [field-sizing:content] focus:border-soft-violet focus:bg-cream-dough"
              />
              <p className="px-1 pb-1 text-[10px] text-muted">{c.disclaimer}</p>
            </div>
            <button
              type="submit"
              disabled={sending || !text.trim()}
              aria-label={c.sendLabel}
              className="group/send mb-5 grid size-11 flex-none cursor-pointer place-items-center rounded-full bg-linear-to-br from-bun-orange to-honey-gold text-midnight-plum shadow-md transition-[transform,opacity] motion-safe:hover:scale-110 disabled:cursor-default disabled:opacity-40 disabled:hover:scale-100"
            >
              <span className="transition-transform motion-safe:group-hover/send:translate-x-0.5">
                <Icon name="arrowRight" className="size-5" strokeWidth={2.4} />
              </span>
            </button>
          </form>
        </section>
      )}

      {/* After the panel, so it bursts over the chat (which fills the screen on mobile). */}
      {celebrate && <Confetti />}
    </>
  );
}
