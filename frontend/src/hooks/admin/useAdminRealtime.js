import { useEffect, useRef, useState } from 'react';
import { useDispatch } from 'react-redux';
import { io } from 'socket.io-client';
import { toast } from 'sonner';
import { fetchLead, refreshAfterEvent } from '../../store/adminDataSlices.js';

// Live admin updates (backend/src/realtime/admin-realtime.gateway.ts, Socket.IO at /api/realtime).
// The browser's session cookie authenticates the connection. On every event the lists, the
// calendar and the open lead reload (refreshAfterEvent), and a closable toast says what happened.
// Changes made by this admin are not toasted again (the form already confirmed them).

const when = (iso) => (iso ? new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso)) : '');
const nameOf = (lead) => `${lead.firstName} ${lead.lastName}`.trim();

function bookingToast(e, isMine, open) {
  if (isMine) return;
  const name = nameOf(e.lead);
  const who = e.by === 'admin' ? (e.actor?.name ?? 'Another admin') : name;
  const action = { label: 'Open', onClick: open };
  if (e.kind === 'cancelled') {
    toast.warning(e.by === 'admin' ? `${who} cancelled the call with ${name}` : `${name} cancelled their call`, { description: `Was ${when(e.previousStartsAt)}`, action });
  } else if (e.kind === 'rescheduled') {
    toast.info(e.by === 'admin' ? `${who} moved the call with ${name}` : `${name} moved their call`, { description: `${when(e.previousStartsAt)} → ${when(e.startsAt)}`, action });
  } else {
    toast.success(e.by === 'admin' ? `${who} booked a call for ${name}` : `${name} booked a new call`, { description: when(e.startsAt), action });
  }
}

/** Connects while the admin area is open. Returns 'connecting' | 'live' | 'offline'. */
export function useAdminRealtime(me) {
  const dispatch = useDispatch();
  const [status, setStatus] = useState('connecting');
  const meRef = useRef(me);
  meRef.current = me;

  useEffect(() => {
    const socket = io({ path: '/api/realtime', withCredentials: true, transports: ['websocket', 'polling'] });
    const open = (id) => () => dispatch(fetchLead(id));

    socket.on('connect', () => setStatus('live'));
    socket.on('disconnect', () => setStatus('offline'));
    socket.io.on('reconnect_attempt', () => setStatus('connecting'));
    // The server closes the connection when the session ends (expired, or signed out elsewhere).
    socket.on('unauthorized', () => window.location.replace('/'));

    socket.on('lead.created', (e) => {
      toast.success(`New lead: ${nameOf(e.lead)}`, {
        description: [e.lead.businessName, e.startsAt && `Call ${when(e.startsAt)}`].filter(Boolean).join(' · '),
        action: { label: 'Open', onClick: open(e.lead.id) },
        duration: 10_000,
      });
      dispatch(refreshAfterEvent(e));
    });
    socket.on('booking.changed', (e) => {
      const isMine = e.by === 'admin' && !!meRef.current && e.actor?.email === meRef.current.email;
      bookingToast(e, isMine, open(e.lead.id));
      dispatch(refreshAfterEvent(e));
    });
    socket.on('lead.updated', (e) => dispatch(refreshAfterEvent(e)));

    return () => {
      socket.removeAllListeners();
      socket.close();
    };
  }, [dispatch]);

  return status;
}
