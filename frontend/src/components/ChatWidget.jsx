import { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { site } from '../content/site.js';
import { trackEvent } from '../lib/gtm.js';
import { leadHref, onRouteLinkClick } from '../lib/router.js';
import { closed, opened, sendMessage } from '../store/chatSlice.js';
import { ChatBooking } from './ChatBooking.jsx';
import { Icon } from './ui/Icon.jsx';

const c = site.chat;
const MAX_CHARS = 1000; // MAX_USER_CHARS in backend/src/chat/chat.schema.ts

// The website chatbot: a launcher button and a chat panel. The assistant answers questions and,
// when the visitor is ready, shows the booking calendar right in the chat (ChatBooking).
// On mobile the launcher sits above the sticky bar and the panel fills the screen.
export function ChatWidget() {
  const dispatch = useDispatch();
  const { open, messages, status, lastText, booked } = useSelector((s) => s.chat);
  const [text, setText] = useState('');
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const sending = status === 'sending';
  const lastBookingId = messages.findLast((m) => m.booking)?.id;
  const hasUserMessage = messages.some((m) => m.role === 'user');

  // Keep the newest message in view.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, sending, open]);

  useEffect(() => {
    if (!open) return undefined;
    inputRef.current?.focus({ preventScroll: true });
    const onKey = (e) => e.key === 'Escape' && dispatch(closed());
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, dispatch]);

  useEffect(() => {
    if (lastBookingId) trackEvent('chat_calendar_shown');
  }, [lastBookingId]);
  useEffect(() => {
    if (booked) trackEvent('chat_booked');
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
          className="group fixed right-5 bottom-5 z-30 flex cursor-pointer items-center gap-2 mobile:right-4 mobile:bottom-[calc(76px+env(safe-area-inset-bottom))]"
        >
          <span className="rounded-full bg-midnight-plum px-3.5 py-2 text-sm font-semibold text-cream-dough shadow-lg mobile:hidden">{c.launcherHint}</span>
          <span className="grid size-14 place-items-center rounded-full bg-bun-orange text-midnight-plum shadow-lg transition-transform group-hover:bg-bun-orange-hover motion-safe:group-hover:-translate-y-0.5">
            <Icon name="chat" className="size-7" strokeWidth={2} />
          </span>
        </button>
      )}

      {open && (
        <section
          role="dialog"
          aria-label={c.title}
          className="fixed right-5 bottom-5 z-50 flex h-[min(640px,calc(100dvh-40px))] w-[390px] flex-col overflow-hidden rounded-card border border-line bg-cream-dough shadow-2xl motion-safe:animate-rise mobile:inset-0 mobile:h-dvh mobile:w-full mobile:rounded-none mobile:border-0"
        >
          <header data-surface="dark" className="flex flex-none items-center gap-3 bg-midnight-plum px-4 py-3 text-cream-dough">
            <span className="grid size-9 flex-none place-items-center rounded-full bg-bun-orange text-midnight-plum">
              <Icon name="sparkle" className="size-5" strokeWidth={2} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold">{c.title}</p>
              <p className="flex items-center gap-1.5 text-xs opacity-80">
                <span className="size-2 rounded-full bg-circuit-teal" aria-hidden="true" />
                {c.status}
              </p>
            </div>
            <button type="button" onClick={() => dispatch(closed())} aria-label={c.closeLabel} className="grid size-9 cursor-pointer place-items-center rounded-full hover:bg-cream-dough/12">
              <Icon name="close" className="size-5" strokeWidth={2} />
            </button>
          </header>

          <div ref={listRef} data-lenis-prevent aria-live="polite" className="flex-1 overflow-y-auto overscroll-contain px-4 py-4">
            <ul className="grid gap-3">
              {messages.map((m) => (
                <li key={m.id} className={m.role === 'user' ? 'flex justify-end' : 'flex flex-col items-start'}>
                  <p
                    className={`max-w-[85%] rounded-chat px-3.5 py-2.5 text-[15px] leading-snug whitespace-pre-line ${
                      m.role === 'user' ? 'rounded-br-md bg-byte-purple text-cream-dough' : 'rounded-bl-md bg-lavender-mist text-midnight-plum'
                    } ${m.failed ? 'text-danger' : ''}`}
                  >
                    {m.text}
                  </p>
                  {m.failed && lastText && (
                    <button type="button" onClick={() => send(lastText)} className="mt-1 cursor-pointer text-xs font-semibold text-byte-purple underline">
                      {c.retry}
                    </button>
                  )}
                  {m.offline && (
                    <a href={leadHref('chatbot')} onClick={onRouteLinkClick} className="mt-2 inline-flex min-h-10 items-center gap-1.5 rounded-btn bg-bun-orange px-4 text-sm font-semibold text-midnight-plum hover:bg-bun-orange-hover">
                      {c.offlineCta}
                      <Icon name="arrowRight" className="size-4" strokeWidth={2} />
                    </a>
                  )}
                  {m.id === lastBookingId && <ChatBooking prefill={m.booking} />}
                </li>
              ))}
              {sending && (
                <li className="flex" aria-label={c.typing}>
                  <span className="flex gap-1 rounded-chat rounded-bl-md bg-lavender-mist px-4 py-3.5">
                    {[0, 150, 300].map((delay) => (
                      <span key={delay} className="size-2 rounded-full bg-soft-violet motion-safe:animate-bounce" style={{ animationDelay: `${delay}ms` }} />
                    ))}
                  </span>
                </li>
              )}
            </ul>

            {!hasUserMessage && (
              <div className="mt-4 flex flex-wrap gap-2">
                {c.starters.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => send(s)}
                    className="cursor-pointer rounded-full border border-byte-purple px-3 py-1.5 text-sm font-semibold text-byte-purple transition-colors hover:bg-lavender-mist"
                  >
                    {s}
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
                className="max-h-32 min-h-11 w-full resize-none rounded-btn border border-line bg-cream-dough px-3 py-2.5 text-[15px] text-midnight-plum outline-none [field-sizing:content] focus:border-byte-purple"
              />
              <p className="px-1 pb-1 text-[10px] text-muted">{c.disclaimer}</p>
            </div>
            <button
              type="submit"
              disabled={sending || !text.trim()}
              aria-label={c.sendLabel}
              className="mb-5 grid size-11 flex-none cursor-pointer place-items-center rounded-btn bg-byte-purple text-cream-dough transition-colors hover:bg-byte-purple-hover disabled:cursor-default disabled:opacity-50"
            >
              <Icon name="arrowRight" className="size-5" strokeWidth={2.2} />
            </button>
          </form>
        </section>
      )}
    </>
  );
}
