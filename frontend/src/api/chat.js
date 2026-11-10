import { http } from './client.js';

// POST /api/chat { messages: [{ role, text }], timeZone } -> { reply, booking?, offline? }.
// timeZone (the visitor's IANA zone) is what availability answers are given in.
// See backend/src/chat/chat.controller.ts. The model can take a while, hence the longer timeout.
export const sendChat = (messages, timeZone, config) => http.post('/chat', { messages, timeZone }, { timeout: 35_000, ...config });
