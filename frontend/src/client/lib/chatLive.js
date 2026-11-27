import { useEffect } from 'react';
import { useDispatch } from 'react-redux';
import { api, useChatRoomsQuery } from '../api.js';

// The team chat's live feed (backend team/chat.controller.ts 'stream'): one EventSource for the
// whole app. New messages, deletions and read marks refresh the room list (unread badges) and the
// open room. While it's connected the person isn't emailed about unread messages.
export function useChatLive(enabled) {
  const dispatch = useDispatch();
  useEffect(() => {
    if (!enabled || typeof EventSource === 'undefined') return undefined;
    const source = new EventSource('/api/client/chat/stream', { withCredentials: true });
    const refresh = (ev) => {
      let room = null;
      try {
        room = JSON.parse(ev.data)?.room ?? null;
      } catch {
        /* a ping */
      }
      dispatch(api.util.invalidateTags(['Chat', ...(room ? [{ type: 'ChatRoom', id: room }] : [])]));
      if (ev.type === 'message') window.dispatchEvent(new CustomEvent('bytebun:chat-message', { detail: { room } }));
    };
    for (const type of ['message', 'deleted', 'rooms', 'read']) source.addEventListener(type, refresh);
    return () => source.close();
  }, [enabled, dispatch]);
}

/** Unread messages across every room I'm in. */
export function useChatUnread(enabled) {
  const q = useChatRoomsQuery(undefined, { skip: !enabled });
  if (!q.data) return 0;
  return [q.data.team, ...q.data.events, ...q.data.people].reduce((n, r) => n + r.unread, 0);
}
