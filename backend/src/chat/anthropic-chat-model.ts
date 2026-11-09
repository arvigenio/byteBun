import Anthropic from '@anthropic-ai/sdk';
import type { ChatConfig } from '../config/config';
import type { ChatModel, ModelReply } from './chat-model';

// Claude (Anthropic API) behind the chatbot's ChatModel interface.
export class AnthropicChatModel implements ChatModel {
  private readonly client?: Anthropic;

  constructor(private readonly cfg: Pick<ChatConfig, 'apiKey' | 'model'>) {
    // One retry: a visitor is waiting, and ChatService answers "offline" if this fails.
    if (cfg.apiKey) this.client = new Anthropic({ apiKey: cfg.apiKey, maxRetries: 1 });
  }

  get available() {
    return !!this.client;
  }

  async reply({ system, turns, tools, signal }: Parameters<ChatModel['reply']>[0]): Promise<ModelReply> {
    if (!this.client) throw new Error('Anthropic is not configured');
    const res = await this.client.messages.create(
      {
        model: this.cfg.model,
        max_tokens: 4000,
        // The instructions and tools are the same on every request: cache them.
        system: [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }],
        tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parametersJsonSchema as Anthropic.Tool.InputSchema })),
        messages: turns.map((t): Anthropic.MessageParam => ({ role: t.role, content: t.text })),
        // Short chat replies: low effort keeps them fast and cheap.
        output_config: { effort: 'low' },
      },
      { signal },
    );
    if (res.stop_reason === 'refusal') throw new Error('The model declined to answer');

    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n')
      .trim();
    const call = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
    return { text, ...(call && { call: { name: call.name, args: (call.input ?? {}) as Record<string, unknown> } }) };
  }
}
