import { useEffect, useRef, useState } from 'react';
import { BunFace } from '../../components/BouncingBun.jsx';
import { Icon, ICONS } from '../ui.jsx';

// The chatbot on the Bookings & Events landing page: answers questions about the app.
// POST /api/chat with product "bookings" (backend/src/chat/chat.service.ts, bookingsPrompt in
// knowledge.ts): no consultation calendar, nothing stored; the conversation lives in this component.
const MAX_CHARS = 1000; // MAX_USER_CHARS in backend/src/chat/chat.schema.ts
const GREETING = "Hi! I'm Bunno. Ask me anything about Byte Bun Bookings & Events: booking pages, reminders, events, QR check-in or plans.";
const STARTERS = ['Is it really free?', 'How do events work?', 'How do QR check-ins work?', 'What does Bookings Pro add?'];
const FAILED = 'Sorry, something went wrong. Please try again.';
const BUSY = 'You’re sending messages quickly. Please wait a moment and try again.';

let nextId = 1;
const msg = (role, text, extra) => ({ id: nextId++, role, text, ...extra });

export function BookingsChat({ start }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState(() => [msg('assistant', GREETING, { greeting: true })]);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const hasUserMessage = messages.some((m) => m.role === 'user');

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages, sending, open]);

  useEffect(() => {
    if (!open) return undefined;
    inputRef.current?.focus({ preventScroll: true });
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const send = async (value) => {
    const message = value.trim();
    if (!message || sending) return;
    // The greeting and failed replies aren't part of the conversation the model sees.
    const history = [...messages.filter((m) => !m.greeting && !m.failed), msg('user', message)];
    setMessages((list) => [...list.filter((m) => !m.failed), history[history.length - 1]]);
    setText('');
    setSending(true);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ product: 'bookings', messages: history.map((m) => ({ role: m.role, text: m.text })) }),
        signal: AbortSignal.timeout(35_000),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(res.status === 429 ? BUSY : data.message || FAILED);
      setMessages((list) => [...list, msg('assistant', data.reply, { offline: data.offline })]);
    } catch (err) {
      setMessages((list) => [...list, msg('assistant', err.message === BUSY ? BUSY : FAILED, { failed: true, retry: message })]);
    } finally {
      setSending(false);
    }
  };

  return (
    <>
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Ask about Bookings & Events"
          className="fixed right-5 bottom-5 z-40 flex cursor-pointer items-center gap-2 rounded-full bg-brand py-3 pr-5 pl-3.5 font-semibold text-brand-ink shadow-xl shadow-brand/30 transition hover:-translate-y-0.5 hover:brightness-110 mobile:right-4 mobile:bottom-4"
        >
          <span className="grid size-8 place-items-center rounded-full bg-white/90">
            <BunFace size={26} hop />
          </span>
          Questions?
        </button>
      )}

      {open && (
        <section
          role="dialog"
          aria-label="Bunno, Bookings & Events assistant"
          className="fixed right-5 bottom-5 z-50 flex h-[min(620px,calc(100dvh-40px))] w-[380px] flex-col overflow-hidden rounded-[20px] border border-line bg-surface text-ink shadow-2xl mobile:inset-0 mobile:h-dvh mobile:w-full mobile:rounded-none mobile:border-0"
        >
          <header className="flex flex-none items-center gap-3 bg-brand px-4 py-3 text-brand-ink">
            <span className="bb-wiggle grid size-10 flex-none place-items-center rounded-full bg-white">
              <BunFace size={30} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate leading-tight font-bold">Bunno</p>
              <p className="truncate text-xs opacity-85">Bookings & Events assistant</p>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close chat" className="grid size-9 cursor-pointer place-items-center rounded-full transition hover:bg-white/15">
              <Icon d="M6 6l12 12M18 6L6 18" />
            </button>
          </header>

          <div ref={listRef} data-lenis-prevent aria-live="polite" className="flex-1 overflow-y-auto overscroll-contain bg-canvas px-4 py-4">
            <ul className="grid gap-3">
              {messages.map((m) =>
                m.role === 'user' ? (
                  <li key={m.id} className="flex justify-end">
                    <p className="max-w-[82%] rounded-2xl rounded-br-md bg-brand px-3.5 py-2.5 text-[15px] leading-snug whitespace-pre-line text-brand-ink">{m.text}</p>
                  </li>
                ) : (
                  <li key={m.id} className="flex flex-col items-start">
                    <p className={`max-w-[88%] rounded-2xl rounded-bl-md border bg-surface px-3.5 py-2.5 text-[15px] leading-snug whitespace-pre-line ${m.failed ? 'border-danger/40 text-danger' : 'border-line'}`}>
                      {m.text}
                    </p>
                    {m.failed && (
                      <button type="button" onClick={() => send(m.retry)} className="mt-1 cursor-pointer text-xs font-semibold text-brand underline">
                        Try again
                      </button>
                    )}
                    {m.offline && (
                      <a href={start} className="mt-2 inline-flex min-h-10 items-center rounded-btn bg-brand px-4 text-sm font-semibold text-brand-ink transition hover:brightness-110">
                        Start free
                      </a>
                    )}
                  </li>
                ),
              )}
              {sending && (
                <li aria-label="Bunno is typing" className="flex items-end gap-2">
                  <span className="grid size-7 flex-none place-items-center rounded-full bg-white shadow-sm ring-1 ring-line" aria-hidden="true">
                    <BunFace size={22} hop />
                  </span>
                  <span className="flex gap-1.5 rounded-2xl rounded-bl-md border border-line bg-surface px-4 py-3.5">
                    {[0, 1, 2].map((i) => (
                      <span key={i} className="size-2 rounded-full bg-brand motion-safe:animate-bounce" style={{ animationDelay: `${i * 150}ms` }} />
                    ))}
                  </span>
                </li>
              )}
            </ul>

            {!hasUserMessage && (
              <div className="mt-4 flex flex-wrap gap-2">
                {STARTERS.map((s) => (
                  <button key={s} type="button" onClick={() => send(s)} className="cursor-pointer rounded-full border border-brand/30 bg-brand-soft px-3 py-1.5 text-sm font-semibold text-brand transition hover:border-brand">
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>

          <form
            className="flex flex-none items-end gap-2 border-t border-line bg-surface px-3 pt-3 pb-[calc(8px+env(safe-area-inset-bottom))]"
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
                placeholder="Ask about bookings or events"
                aria-label="Your question"
                className="max-h-32 min-h-11 w-full resize-none rounded-xl border border-line bg-canvas px-3.5 py-2.5 text-[15px] outline-none [field-sizing:content] focus:border-brand"
              />
              <p className="px-1 pb-1 text-[10px] text-faint">AI assistant: answers can be wrong. Don’t share private details.</p>
            </div>
            <button
              type="submit"
              disabled={sending || !text.trim()}
              aria-label="Send"
              className="mb-5 grid size-11 flex-none cursor-pointer place-items-center rounded-full bg-brand text-brand-ink transition hover:brightness-110 disabled:cursor-default disabled:opacity-40"
            >
              <Icon d="M5 12h14M13 6l6 6-6 6" />
            </button>
          </form>
        </section>
      )}
    </>
  );
}
