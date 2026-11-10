import { Module } from '@nestjs/common';
import { BookingModule } from '../booking/booking.module';
import { APP_CONFIG, type AppConfig } from '../config/config';
import { AnthropicChatModel } from './anthropic-chat-model';
import { CHAT_MODEL } from './chat-model';
import { ChatController } from './chat.controller';
import { ChatService } from './chat.service';

// The website chatbot (Claude). It answers from knowledge.ts, looks up open call times
// (BookingService) and, when the visitor is ready, shows the booking calendar in the chat; the
// booking itself goes through POST /api/leads like the lead page.
@Module({
  imports: [BookingModule],
  controllers: [ChatController],
  providers: [ChatService, { provide: CHAT_MODEL, inject: [APP_CONFIG], useFactory: ({ chat }: AppConfig) => new AnthropicChatModel(chat) }],
})
export class ChatModule {}
