import { createAsyncThunk, createSlice } from '@reduxjs/toolkit';
import { sendChat } from '../api/chat.js';
import { createLead } from '../api/leads.js';
import { site } from '../content/site.js';
import { getAttribution } from '../lib/attribution.js';
import { detectTimeZone, formatWhen } from '../lib/calendar.js';

// The website chatbot (components/ChatWidget.jsx). The conversation lives here only (the server
// stores nothing) and is sent with every message. Open call times come from the leadForm slice
// (fetchSlots), so the chat calendar and the lead page always agree on what is taken.
//
// Message: { id, role: 'user' | 'assistant', text, booking?, offline?, local? }
//  - booking: prefill from the server; the message then shows the booking calendar
//  - local:   shown, but never sent to the model (the greeting and error notes)
let nextId = 1;
const message = (role, text, extra = {}) => ({ id: nextId++, role, text, ...extra });

const initialState = {
  open: false,
  openedAt: 0, // when the chat was first opened (ms), sent as the lead's fillMs
  messages: [message('assistant', site.chat.greeting, { local: true })],
  status: 'idle', // idle | sending | error
  lastText: '', // the message that failed, for "Try again"
  // The booking made from this chat, once there is one: { firstName, meetingAt, timeZone }.
  booked: null,
  booking: { status: 'idle', error: '', fields: {} }, // status: idle | sending | error
};

export const sendMessage = createAsyncThunk(
  'chat/send',
  async (text, { getState, rejectWithValue, signal }) => {
    const history = getState()
      .chat.messages.filter((m) => !m.local)
      .map(({ role, text: t }) => ({ role, text: t }));
    try {
      return await sendChat(history, detectTimeZone(), { signal });
    } catch (err) {
      return rejectWithValue({ message: err.message || site.chat.error, text });
    }
  },
  { condition: (text, { getState }) => !!text.trim() && getState().chat.status !== 'sending' },
);

// Books the call: the prefill from the chat, plus the time and contact details from the card.
export const bookFromChat = createAsyncThunk(
  'chat/book',
  async ({ prefill, values }, { getState, rejectWithValue, signal }) => {
    try {
      await createLead(
        { ...prefill, ...values, source: 'chatbot', attribution: getAttribution(), fillMs: Math.max(0, Date.now() - getState().chat.openedAt) },
        { signal },
      );
      return { firstName: values.firstName.trim(), meetingAt: values.meetingAt, timeZone: values.timeZone };
    } catch (err) {
      return rejectWithValue({ message: err.message, status: err.status, fields: err.fields ?? {} });
    }
  },
  { condition: (_, { getState }) => getState().chat.booking.status !== 'sending' },
);

const chatSlice = createSlice({
  name: 'chat',
  initialState,
  reducers: {
    opened(state) {
      state.open = true;
      state.openedAt ||= Date.now();
    },
    closed(state) {
      state.open = false;
    },
    bookingErrorCleared(state) {
      state.booking = { status: 'idle', error: '', fields: {} };
    },
  },
  extraReducers: (builder) => {
    builder
      .addCase(sendMessage.pending, (state, action) => {
        state.status = 'sending';
        state.messages = state.messages.filter((m) => !m.failed);
        state.messages.push(message('user', action.meta.arg.trim()));
      })
      .addCase(sendMessage.fulfilled, (state, action) => {
        const { reply, booking, offline } = action.payload;
        state.status = 'idle';
        state.messages.push(message('assistant', reply, { ...(booking && { booking }), ...(offline && { offline: true, local: true }) }));
      })
      .addCase(sendMessage.rejected, (state, action) => {
        state.status = 'error';
        state.lastText = action.payload?.text ?? action.meta.arg;
        // Take the unanswered message back out, so "Try again" doesn't send it twice.
        const i = state.messages.findLastIndex((m) => m.role === 'user');
        if (i >= 0) state.messages.splice(i, 1);
        state.messages.push(message('assistant', action.payload?.message || site.chat.error, { local: true, failed: true }));
      })
      .addCase(bookFromChat.pending, (state) => {
        state.booking = { status: 'sending', error: '', fields: {} };
      })
      .addCase(bookFromChat.fulfilled, (state, action) => {
        state.booking = { status: 'idle', error: '', fields: {} };
        state.booked = action.payload;
        const { firstName, meetingAt, timeZone } = action.payload;
        // Sent to the model with later messages too, so it knows the call is booked.
        const text = site.chat.booking.success.replace('{firstName}', firstName).replace('{when}', formatWhen(meetingAt, timeZone));
        state.messages.push(message('assistant', text));
      })
      .addCase(bookFromChat.rejected, (state, action) => {
        const { message: msg, status, fields = {} } = action.payload ?? {};
        const hasFields = Object.keys(fields).length > 0;
        state.booking = {
          status: 'error',
          fields,
          error: status === 409 && fields.meetingAt ? site.chat.booking.slotTaken : hasFields ? '' : msg || site.chat.error,
        };
      });
  },
});

export const { opened, closed, bookingErrorCleared } = chatSlice.actions;
export default chatSlice.reducer;
