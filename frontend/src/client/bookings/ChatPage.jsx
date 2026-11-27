import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useChatMessagesQuery, useChatRoomsQuery, useDeleteChatMutation, useMeQuery, useOlderChatMessagesMutation, useReadChatMutation, useSendChatMutation } from '../api.js';
import { compressImage, fileProblem, fmtBytes, PROOF_ACCEPT } from '../lib/upload.js';
import { Badge, Button, Empty, Icon, ICONS, Loading, PageHeader, Textarea, useConfirm } from '../ui.jsx';

// The team chat (backend team/chat.service.ts): the whole team, each of my events (owners and
// admins: every event), and direct messages. Text plus one image or PDF per message. Live updates
// and unread counts come from lib/chatLive.js; the room is in the URL hash (#team, #event-12,
// #dm-<userId>) so links can open one.

const fmtTime = (iso) => {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return new Intl.DateTimeFormat(undefined, today ? { timeStyle: 'short' } : { dateStyle: 'medium', timeStyle: 'short' }).format(d);
};
const keyFromHash = () => decodeURIComponent(window.location.hash.slice(1)) || null;

export function ChatPage() {
  const rooms = useChatRoomsQuery();
  const [key, setKey] = useState(keyFromHash);
  useEffect(() => {
    const on = () => setKey(keyFromHash());
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const open = (k) => {
    window.history.replaceState(null, '', `#${encodeURIComponent(k)}`);
    setKey(k);
  };
  if (rooms.isLoading) return <Loading />;
  if (rooms.error) return <Empty title="The chat isn’t available">{rooms.error.message}</Empty>;
  const r = rooms.data;
  const all = [r.team, ...r.events, ...r.people];
  const current = all.find((x) => x.key === key) ?? null;
  return (
    <>
      <PageHeader title="Team chat" description="Talk with your whole team, an event’s team, or one person." />
      <div className="grid min-h-[60vh] overflow-hidden rounded-card border border-line bg-surface desktop:grid-cols-[260px_1fr]">
        <aside className={`border-line desktop:border-r ${current ? 'mobile:hidden' : ''}`} aria-label="Conversations">
          <RoomList r={r} current={key} onOpen={open} />
        </aside>
        <section className={`flex min-h-[60vh] min-w-0 flex-col ${current ? '' : 'mobile:hidden'}`}>
          {current ? <Room key={current.key} room={current} onBack={() => (window.history.replaceState(null, '', window.location.pathname), setKey(null))} /> : <p className="m-auto p-8 text-center text-sm text-muted">Choose a conversation.</p>}
        </section>
      </div>
    </>
  );
}

function RoomList({ r, current, onOpen }) {
  const Item = ({ room, title, sub, dot }) => (
    <li>
      <button type="button" onClick={() => onOpen(room.key)} aria-current={current === room.key ? 'true' : undefined} className={`flex w-full cursor-pointer items-center gap-2 px-4 py-2.5 text-left hover:bg-sunken ${current === room.key ? 'bg-brand-soft' : ''}`}>
        {dot !== undefined && <span className={`size-2 shrink-0 rounded-full ${dot ? 'bg-ok' : 'bg-line-strong'}`} title={dot ? 'In the app now' : 'Away'} />}
        <span className="min-w-0 flex-1">
          <span className={`block truncate text-sm ${room.unread ? 'font-semibold' : 'font-medium'}`}>{title}</span>
          {sub && <span className="block truncate text-xs text-faint">{sub}</span>}
        </span>
        {room.unread > 0 && <span className="rounded-full bg-brand px-2 py-0.5 text-xs font-bold text-brand-ink">{room.unread}</span>}
      </button>
    </li>
  );
  const last = (room) => (room.last ? `${room.last.mine ? 'You' : room.last.by}: ${room.last.text}` : null);
  return (
    <nav className="flex flex-col gap-3 py-3">
      <ul>
        <Item room={r.team} title="# Whole team" sub={last(r.team)} />
      </ul>
      <div>
        <p className="px-4 pb-1 text-xs font-semibold tracking-wide text-faint uppercase">Events</p>
        {r.events.length ? (
          <ul>
            {r.events.map((e) => (
              <Item key={e.key} room={e} title={`# ${e.name}`} sub={last(e)} />
            ))}
          </ul>
        ) : (
          <p className="px-4 text-xs text-muted">No events you’re assigned to.</p>
        )}
      </div>
      <div>
        <p className="px-4 pb-1 text-xs font-semibold tracking-wide text-faint uppercase">Direct messages</p>
        {r.people.length ? (
          <ul>
            {r.people.map((p) => (
              <Item key={p.key} room={p} title={p.name} sub={last(p)} dot={p.online} />
            ))}
          </ul>
        ) : (
          <p className="px-4 text-xs text-muted">Invite people on the Team page.</p>
        )}
      </div>
    </nav>
  );
}

function Room({ room, onBack }) {
  const { data: me } = useMeQuery();
  const q = useChatMessagesQuery(room.key);
  const [older, olderState] = useOlderChatMessagesMutation();
  const [earlier, setEarlier] = useState([]); // pages loaded with "Show earlier"
  const [more, setMore] = useState(null);
  const [read] = useReadChatMutation();
  const bottom = useRef(null);
  const messages = useMemo(() => {
    const seen = new Set();
    return [...earlier, ...(q.data?.messages ?? [])].filter((m) => (seen.has(m.id) ? false : seen.add(m.id)));
  }, [earlier, q.data]);
  const lastId = messages.length ? messages[messages.length - 1].id : 0;

  // Newest at the bottom; mark read as they come in.
  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
    if (lastId && document.visibilityState === 'visible') read({ key: room.key, lastId });
  }, [lastId, room.key, read]);

  const loadEarlier = async () => {
    const r = await older({ key: room.key, before: messages[0]?.id });
    if (r.error) return toast.error(r.error.message);
    setEarlier((x) => [...r.data.messages, ...x]);
    setMore(r.data.more);
  };
  const hasMore = more ?? q.data?.more;
  const title = room.key === 'team' ? 'Whole team' : room.name;

  return (
    <>
      <header className="flex items-center gap-2 border-b border-line px-4 py-3">
        <button type="button" className="cursor-pointer rounded-md p-1 desktop:hidden" onClick={onBack} aria-label="Back to conversations">
          <Icon d="M15 18l-6-6 6-6" />
        </button>
        <h2 className="min-w-0 flex-1 truncate font-semibold">{room.key.startsWith('dm-') ? title : `# ${title}`}</h2>
        {room.online !== undefined && <Badge tone={room.online ? 'ok' : 'neutral'}>{room.online ? 'In the app' : 'Away: gets an email'}</Badge>}
      </header>
      <div className="flex-1 overflow-y-auto px-4 py-3" style={{ maxHeight: '60vh' }}>
        {q.isLoading ? (
          <Loading />
        ) : (
          <>
            {hasMore && (
              <div className="mb-3 text-center">
                <Button size="sm" variant="ghost" loading={olderState.isLoading} onClick={loadEarlier}>
                  Show earlier messages
                </Button>
              </div>
            )}
            {!messages.length && <p className="py-10 text-center text-sm text-muted">No messages yet. Say hello!</p>}
            <ul className="flex flex-col gap-2">
              {messages.map((m, i) => (
                <Message key={m.id} m={m} roomKey={room.key} showName={!m.mine && messages[i - 1]?.userId !== m.userId} />
              ))}
            </ul>
            <div ref={bottom} />
          </>
        )}
      </div>
      <Composer roomKey={room.key} me={me} />
    </>
  );
}

function Message({ m, roomKey, showName }) {
  const [del] = useDeleteChatMutation();
  const confirm = useConfirm();
  const image = m.file?.type?.startsWith('image/');
  return (
    <li className={`group flex flex-col ${m.mine ? 'items-end' : 'items-start'}`}>
      {showName && <span className="mb-0.5 px-1 text-xs font-medium text-muted">{m.by}</span>}
      <div className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-[15px] ${m.mine ? 'bg-brand text-brand-ink' : 'bg-sunken text-ink'} ${m.deleted ? 'italic opacity-60' : ''}`}>
        {m.deleted ? (
          'Message deleted'
        ) : (
          <>
            {m.body && <p className="break-words whitespace-pre-wrap">{m.body}</p>}
            {m.file &&
              (image ? (
                <a href={m.file.url} target="_blank" rel="noreferrer" className="mt-1 block">
                  <img src={m.file.url} alt={m.file.name} className="max-h-64 rounded-lg" loading="lazy" />
                </a>
              ) : (
                <a href={m.file.url} target="_blank" rel="noreferrer" className={`mt-1 flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm underline ${m.mine ? 'bg-white/15' : 'bg-surface'}`}>
                  <Icon d={ICONS.file ?? 'M14 3H6a1 1 0 00-1 1v16a1 1 0 001 1h12a1 1 0 001-1V8z M14 3v5h5'} className="size-4" />
                  {m.file.name} {m.file.size ? `· ${fmtBytes(m.file.size)}` : ''}
                </a>
              ))}
          </>
        )}
      </div>
      <span className="mt-0.5 flex items-center gap-2 px-1 text-[11px] text-faint">
        {fmtTime(m.createdAt)}
        {m.mine && !m.deleted && (
          <button
            type="button"
            className="cursor-pointer opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-danger"
            onClick={async () => {
              if (!(await confirm({ title: 'Delete this message?', body: 'It’s removed for everyone, with its attachment.', action: 'Delete' }))) return;
              const r = await del({ key: roomKey, id: m.id });
              if (r.error) toast.error(r.error.message);
            }}
          >
            Delete
          </button>
        )}
      </span>
    </li>
  );
}

function Composer({ roomKey }) {
  const [send, state] = useSendChatMutation();
  const [text, setText] = useState('');
  const [file, setFile] = useState(null);
  const input = useRef(null);
  const submit = async (e) => {
    e?.preventDefault();
    if (!text.trim() && !file) return;
    if (file) {
      const problem = fileProblem(file);
      if (problem) return toast.error(problem);
    }
    const form = new FormData();
    form.append('body', text);
    if (file) form.append('file', await compressImage(file));
    const r = await send({ key: roomKey, form });
    if (r.error) return toast.error(r.error.message);
    setText('');
    setFile(null);
  };
  return (
    <form onSubmit={submit} className="border-t border-line p-3">
      {file && (
        <div className="mb-2 flex items-center gap-2 rounded-btn bg-sunken px-3 py-1.5 text-sm">
          <span className="min-w-0 flex-1 truncate">📎 {file.name}</span>
          <button type="button" className="cursor-pointer text-muted hover:text-danger" onClick={() => setFile(null)} aria-label="Remove the attachment">
            ✕
          </button>
        </div>
      )}
      <div className="flex items-end gap-2">
        <input ref={input} type="file" accept={PROOF_ACCEPT} className="sr-only" onChange={(e) => (setFile(e.target.files?.[0] ?? null), (e.target.value = ''))} />
        <Button variant="ghost" onClick={() => input.current?.click()} aria-label="Attach an image or PDF" title="Attach an image or PDF">
          📎
        </Button>
        <Textarea
          rows={1}
          value={text}
          maxLength={4000}
          placeholder="Write a message…"
          aria-label="Message"
          className="max-h-40 min-h-10 flex-1 resize-y"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <Button type="submit" loading={state.isLoading} disabled={!text.trim() && !file}>
          Send
        </Button>
      </div>
    </form>
  );
}
