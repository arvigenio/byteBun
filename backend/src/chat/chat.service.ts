import { Inject, Injectable } from '@nestjs/common';
import { availability } from '../booking/availability';
import { describeAvailability, describeNow, findOpenSlot, isTimeZone } from '../booking/availability-check';
import { BookingService } from '../booking/booking.service';
import { logger } from '../logging/logger';
import { FEATURE_KEYS, GOAL_KEYS, OTHER_GOAL } from '../leads/lead-options';
import { CHAT_MODEL, type ChatModel, type ChatTurn, type ToolRound } from './chat-model';
import { type ChatInput, MAX_TURNS } from './chat.schema';
import { AVAILABILITY_TOOL, BOOKING_TOOL, BUSINESS_TYPES, systemPrompt, visitorContext } from './knowledge';

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
  /** An open call time the visitor chose in the chat (ISO, UTC): the calendar starts with it picked. */
  meetingAt?: string;
}

export interface ChatReply {
  reply: string;
  /** Show the booking calendar in the chat, prefilled with this. */
  booking?: BookingPrefill;
  /** The assistant can't answer right now (no API key, or the model failed): offer the lead page. */
  offline?: true;
}

/** Where the chat reads open call times (BookingService; tests pass a stand-in). */
export type SlotSource = Pick<BookingService, 'openSlots'>;

const OFFLINE_REPLY =
  "Sorry, I can't chat right now. You can still book your free 30-minute consultation on our booking page, and we'll answer every question on the call.";
const CALENDAR_REPLY = 'Here are the open times for your free 30-minute call. Pick one that suits you.';
const MODEL_TIMEOUT_MS = 25_000;
/** Availability lookups per reply (e.g. "Tuesday?" then "the week after?"); then it must answer. */
const MAX_LOOKUPS = 3;
const PREFERRED_TIME_RE = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})$/;

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
  constructor(
    @Inject(CHAT_MODEL) private readonly model: ChatModel,
    @Inject(BookingService) private readonly slots: SlotSource,
  ) {}

  async reply(input: ChatInput, { ip, now = new Date() }: { ip?: string; now?: Date } = {}): Promise<ChatReply> {
    if (!this.model.available) return { reply: OFFLINE_REPLY, offline: true };

    // The latest turns only, starting with a visitor message (the model expects that).
    let turns: ChatTurn[] = input.messages.slice(-MAX_TURNS).map((m) => ({ role: m.role, text: m.text }));
    while (turns.length && turns[0].role !== 'user') turns = turns.slice(1);
    const timeZone = isTimeZone(input.timeZone) ? input.timeZone : availability.timeZone;

    try {
      const signal = AbortSignal.timeout(MODEL_TIMEOUT_MS); // for the whole reply, lookups included
      const system = systemPrompt();
      const context = visitorContext(describeNow(now, timeZone), timeZone);
      const rounds: ToolRound[] = [];
      for (;;) {
        const out = await this.model.reply({ system, context, turns, rounds, tools: [AVAILABILITY_TOOL, BOOKING_TOOL], signal });

        if (out.call?.name === AVAILABILITY_TOOL.name) {
          if (rounds.length >= MAX_LOOKUPS) {
            if (out.text) return { reply: out.text };
            throw new Error('Too many availability lookups');
          }
          rounds.push({ call: out.call, result: await this.checkAvailability(out.call.args, timeZone) });
          continue;
        }
        if (out.call?.name === BOOKING_TOOL.name) {
          const booking = toPrefill(out.call.args);
          const meetingAt = await this.preferredSlot(out.call.args, timeZone);
          return { reply: out.text || CALENDAR_REPLY, booking: meetingAt ? { ...booking, meetingAt } : booking };
        }
        if (!out.text) throw new Error('Empty reply from the model');
        return { reply: out.text };
      }
    } catch (err) {
      logger.error({ err, ip }, 'Chat reply failed');
      return { reply: OFFLINE_REPLY, offline: true };
    }
  }

  private async checkAvailability(args: Record<string, unknown>, visitorZone: string): Promise<string> {
    const timeZone = isTimeZone(args.timeZone) ? args.timeZone : visitorZone;
    const { all, open } = await this.slots.openSlots();
    return describeAvailability({ from: args.from, to: args.to, time: args.time, timeZone }, all, open);
  }

  /** The open call matching the model's preferredTime, as ISO; nothing if it isn't open (any more). */
  private async preferredSlot(args: Record<string, unknown>, visitorZone: string): Promise<string | undefined> {
    const m = typeof args.preferredTime === 'string' ? PREFERRED_TIME_RE.exec(args.preferredTime.trim()) : null;
    if (!m) return undefined;
    const timeZone = isTimeZone(args.preferredTimeZone) ? args.preferredTimeZone : visitorZone;
    const { open } = await this.slots.openSlots();
    return findOpenSlot(open, m[1], m[2], timeZone)?.toISOString();
  }
}
