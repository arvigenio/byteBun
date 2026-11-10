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

/** A tool the model asked for, with its raw arguments. */
export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

/** A lookup the model asked for during this reply (check_availability), and what it got back. */
export interface ToolRound {
  call: ToolCall;
  result: string;
}

export interface ModelReply {
  text: string;
  call?: ToolCall;
}

export interface ChatModel {
  /** False when no API key is configured: the chat then says it is offline. */
  readonly available: boolean;
  reply(input: {
    /** The instructions: the same on every request, so they're cached. */
    system: string;
    /** Changes per request (the visitor's date and time zone); sent after `system`, not cached. */
    context?: string;
    turns: ChatTurn[];
    /** Lookups already done for this reply, oldest first; they follow the last turn. */
    rounds?: ToolRound[];
    tools: ChatTool[];
    signal?: AbortSignal;
  }): Promise<ModelReply>;
}

export const CHAT_MODEL = Symbol('CHAT_MODEL');
