// The language model behind the website chatbot (Claude: anthropic-chat-model.ts), behind a small
// interface so tests can stand in for it without touching ChatService.

/** A tool the model may call, with its parameters as JSON Schema. */
export interface ChatTool {
  name: string;
  description: string;
  parametersJsonSchema: Record<string, unknown>;
}

export interface ChatTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface ModelReply {
  text: string;
  /** A tool the model asked for (only open_booking_calendar today), with its raw arguments. */
  call?: { name: string; args: Record<string, unknown> };
}

export interface ChatModel {
  /** False when no API key is configured: the chat then says it is offline. */
  readonly available: boolean;
  reply(input: { system: string; turns: ChatTurn[]; tools: ChatTool[]; signal?: AbortSignal }): Promise<ModelReply>;
}

export const CHAT_MODEL = Symbol('CHAT_MODEL');
