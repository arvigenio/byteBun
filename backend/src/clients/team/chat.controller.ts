// Team chat routes (chat.service.ts). Every member of the business may chat; event rooms follow the
// event assignments (owners and admins: every event).
//
//   GET    /api/client/chat/rooms                     the team, my events, people; unread counts
//   GET    /api/client/chat/unread                    { total } for the menu badge
//   GET    /api/client/chat/rooms/:key/messages?before=   latest 50, oldest first
//   POST   /api/client/chat/rooms/:key/messages       multipart: body, file?
//   DELETE /api/client/chat/rooms/:key/messages/:id   my own message
//   POST   /api/client/chat/rooms/:key/read           { lastId }
//   GET    /api/client/chat/files/:id                 an attachment (members of its room only)
//   SSE    /api/client/chat/stream                    new messages, deletions, room changes, reads
import { Body, Controller, Delete, Get, Header, HttpCode, type MessageEvent, Param, ParseIntPipe, Post, Query, Req, Res, Sse, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { filter, finalize, interval, map, merge, type Observable } from 'rxjs';
import * as yup from 'yup';
import { YupValidationPipe } from '../../common/yup-validation.pipe';
import { UPLOAD_OPTIONS, type UploadedFileLike } from '../booking/payment-files';
import { ClientRoute, type ClientContext } from '../client-context';
import { ChatService, MESSAGE_MAX } from './chat.service';

const ctx = (req: Request) => req.client as ClientContext;
const MEMBER = {} as const;
const sendSchema = yup.object({ body: yup.string().max(MESSAGE_MAX, `At most ${MESSAGE_MAX} characters.`).default('') });
const readSchema = yup.object({ lastId: yup.number().integer().min(0).required() });

@Controller('client/chat')
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Get('rooms')
  @ClientRoute(MEMBER)
  rooms(@Req() req: Request) {
    return this.chat.rooms(ctx(req));
  }

  @Get('unread')
  @ClientRoute(MEMBER)
  async unread(@Req() req: Request) {
    return { total: await this.chat.unreadTotal(ctx(req)) };
  }

  @Get('rooms/:key/messages')
  @ClientRoute(MEMBER)
  messages(@Req() req: Request, @Param('key') key: string, @Query('before') before?: string) {
    return this.chat.messages(ctx(req), key, Number(before) || undefined);
  }

  @Post('rooms/:key/messages')
  @ClientRoute(MEMBER)
  @UseInterceptors(FileInterceptor('file', UPLOAD_OPTIONS))
  send(@Req() req: Request, @Param('key') key: string, @Body(new YupValidationPipe(sendSchema)) body: yup.InferType<typeof sendSchema>, @UploadedFile() file?: UploadedFileLike) {
    return this.chat.send(ctx(req), key, body.body ?? '', file);
  }

  @Delete('rooms/:key/messages/:id')
  @ClientRoute(MEMBER)
  remove(@Req() req: Request, @Param('key') key: string, @Param('id', ParseIntPipe) id: number) {
    return this.chat.remove(ctx(req), key, id);
  }

  @Post('rooms/:key/read')
  @HttpCode(200)
  @ClientRoute(MEMBER)
  read(@Req() req: Request, @Param('key') key: string, @Body(new YupValidationPipe(readSchema)) body: yup.InferType<typeof readSchema>) {
    return this.chat.read(ctx(req), key, body.lastId);
  }

  @Get('files/:id')
  @ClientRoute(MEMBER)
  async file(@Req() req: Request, @Param('id', ParseIntPipe) id: number, @Res() res: Response) {
    const f = await this.chat.file(ctx(req), id);
    res
      .status(200)
      .set({ 'Content-Type': f.type, 'Content-Disposition': `inline; filename="${f.name.replace(/"/g, '')}"`, 'Cache-Control': 'private, max-age=3600', 'X-Content-Type-Options': 'nosniff' })
      .send(f.body);
  }

  /** One stream per open app: this member's messages, read marks and room changes (plus a ping). */
  @Sse('stream')
  @Header('X-Accel-Buffering', 'no')
  @Header('Cache-Control', 'no-cache')
  @ClientRoute(MEMBER)
  stream(@Req() req: Request): Observable<MessageEvent> {
    const c = ctx(req);
    this.chat.connected(c.user.id, 1);
    return merge(
      this.chat.live.pipe(
        filter((m) => m.orgId === c.org.id && m.to.includes(c.user.id)),
        map((m) => ({ type: m.type, data: { room: m.room ?? null, data: m.data ?? null } }) as MessageEvent),
      ),
      interval(25_000).pipe(map(() => ({ type: 'ping', data: '' }) as MessageEvent)),
    ).pipe(finalize(() => this.chat.connected(c.user.id, -1)));
  }
}
