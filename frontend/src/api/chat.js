import { http } from './client.js';

// POST /api/chat { messages: [{ role, text }] } -> { reply, booking?, offline? }.
// See backend/src/chat/chat.controller.ts. The model can take a while, hence the longer timeout.
export const sendChat = (messages, config) => http.post('/chat', { messages }, { timeout: 35_000, ...config });
