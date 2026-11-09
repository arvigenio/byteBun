import { Inject, Injectable } from '@nestjs/common';
import { logger } from '../logging/logger';
import { FEATURE_KEYS, GOAL_KEYS, OTHER_GOAL } from '../leads/lead-options';
import { CHAT_MODEL, type ChatModel, type ChatTurn } from './chat-model';
import { type ChatInput, MAX_TURNS } from './chat.schema';
import { BOOKING_TOOL, BUSINESS_TYPES, systemPrompt } from './knowledge';

/** What the booking card in the chat is prefilled with. Valid input for POST /api/leads. */
export interface BookingPrefill {
  businessType: string;
  businessTypeOther: string | null;
  businessName: string | null;
  goals: string[];
  goalsOther: string | null;
  features: string[];
  /** Saved as the lead's message, so the team knows what was said in the chat. */
  message: string;
}

export interface ChatReply {
  reply: string;
  /** Show the booking calendar in the chat, prefilled with this. */
  booking?: BookingPrefill;
  /** The assistant can't answer right now (no API key, or the model failed): offer the lead page. */
  offline?: true;
}

const OFFLINE_REPLY =
  "Sorry, I can't chat right now. You can still book your free 30-minute consultation on our booking page, and we'll answer every question on the call.";
const CALENDAR_REPLY = 'Here are the open times for your free 30-minute call. Pick one that suits you.';
const MODEL_TIMEOUT_MS = 25_000;

const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const keys = (v: unknown, allowed: string[]) => [
  ...new Set(Array.isArray(v) ? v.filter((k): k is string => typeof k === 'string' && allowed.includes(k)) : []),
];

/** The model's tool arguments, cleaned so the booking card never sends something the lead API rejects. */
export function toPrefill(args: Record<string, unknown>): BookingPrefill {
  const businessType = (BUSINESS_TYPES as readonly string[]).includes(args.businessType as string) ? (args.businessType as string) : 'Other';
  const businessTypeOther = businessType === 'Other' ? (str(args.businessTypeOther, 70) ?? 'Local business') : null;

  let goals = keys(args.goals, GOAL_KEYS);
  if (!goals.length) goals = [OTHER_GOAL];
  const goalsOther = goals.includes(OTHER_GOAL) ? (str(args.goalsOther, 200) ?? 'Discuss on the call') : null;

  const summary = str(args.summary, 1800);
  return {
    businessType,
    businessTypeOther,
    businessName: str(args.businessName, 160),
    goals,
    goalsOther,
    features: keys(args.features, FEATURE_KEYS),
    message: `Booked from the website chat.${summary ? ` Chat summary: ${summary}` : ''}`,
  };
}

@Injectable()
export class ChatService {
  constructor(@Inject(CHAT_MODEL) private readonly model: ChatModel) {}

  async reply(input: ChatInput, { ip }: { ip?: string } = {}): Promise<ChatReply> {
    if (!this.model.available) return { reply: OFFLINE_REPLY, offline: true };

    // The latest turns only, starting with a visitor message (the model expects that).
    let turns: ChatTurn[] = input.messages.slice(-MAX_TURNS).map((m) => ({ role: m.role, text: m.text }));
    while (turns.length && turns[0].role !== 'user') turns = turns.slice(1);

    try {
      const out = await this.model.reply({
        system: systemPrompt(),
        turns,
        tools: [BOOKING_TOOL],
        signal: AbortSignal.timeout(MODEL_TIMEOUT_MS),
      });
      if (out.call?.name === BOOKING_TOOL.name) {
        return { reply: out.text || CALENDAR_REPLY, booking: toPrefill(out.call.args) };
      }
      if (!out.text) throw new Error('Empty reply from the model');
      return { reply: out.text };
    } catch (err) {
      logger.error({ err, ip }, 'Chat reply failed');
      return { reply: OFFLINE_REPLY, offline: true };
    }
  }
}
