import { Body, Controller, Header, HttpCode, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { clientIp } from '../common/client-ip';
import { ChatRateLimit } from '../common/rate-limit';
import { YupValidationPipe } from '../common/yup-validation.pipe';
import { type ChatInput, chatSchema } from './chat.schema';
import { ChatService } from './chat.service';

@Controller('chat')
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  // POST /api/chat { messages: [{ role: 'user' | 'assistant', text }], timeZone?: IANA name }
  //   -> 200 { reply, booking?: BookingPrefill, offline?: true }
  // 400 for an empty or oversized message, 429 when rate limited. Nothing is stored.
  @Post()
  @HttpCode(200)
  @ChatRateLimit()
  @Header('Cache-Control', 'no-store')
  reply(@Body(new YupValidationPipe(chatSchema)) body: ChatInput, @Req() req: Request) {
    return this.chat.reply(body, { ip: clientIp(req) });
  }
}
