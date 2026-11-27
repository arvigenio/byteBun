// The team chat: one room for the whole team, one per event (its assigned members, owners and
// admins), and direct conversations between two members.
//
// Rooms are addressed by a key the app uses: "team", "event-12", "dm-<userId>" (the other person);
// stored as team:{org} / event:{id} / dm:{org}:{a}:{b}. Rooms are created on first use.
// Messages: text (up to 4000 characters) and/or one image or PDF (UPLOADS_DIR/chat-files/,
// private; images become WebP). Authors can delete their own messages.
// Live: one SSE stream per signed-in member (ChatController 'stream'); unread counts from
// chat_reads.last_read_id. Offline: ChatDigestJob emails a summary of unread messages to members
// who weren't connected, once per message (chat_reads.notified_id).
import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { Subject } from 'rxjs';
import { MAILER } from '../../auth/auth.module';
import type { Mailer } from '../../auth/mailer';
import { ApiError } from '../../common/api-error';
import { APP_CONFIG, type AppConfig } from '../../config/config';
import { logger } from '../../logging/logger';
import { PaymentFiles, type UploadedFileLike } from '../booking/payment-files';
import { chatDigestMail } from '../client-emails';
import { ClientsDb } from '../clients-db';
import type { ClientContext } from '../client-context';
import { isRole, seesAllEvents } from '../roles';

export const MESSAGE_MAX = 4000;
const PAGE = 50;
/** Unread messages older than this, to people not connected, are emailed. */
const DIGEST_AFTER_MS = 10 * 60_000;
const DIGEST_WINDOW_MS = 24 * 3_600_000;

export interface ChatLiveMessage {
  orgId: string;
  /** Who receives it (user ids). */
  to: string[];
  type: 'message' | 'deleted' | 'rooms' | 'read';
  room?: string;
  data?: unknown;
}

type Who = Pick<ClientContext, 'org' | 'user' | 'role' | 'allEvents'>;
type Room = { id: number; kind: string; eventId: number | null; userA: string | null; userB: string | null; organizationId: string };

@Injectable()
export class ChatService {
  readonly live = new Subject<ChatLiveMessage>();
  /** Open streams per user (this process): connected = not emailed. */
  private readonly online = new Map<string, number>();

  constructor(
    private readonly db: ClientsDb,
    private readonly files: PaymentFiles,
  ) {}

  connected(userId: string, delta: 1 | -1) {
    const n = (this.online.get(userId) ?? 0) + delta;
    if (n > 0) this.online.set(userId, n);
    else this.online.delete(userId);
  }

  isOnline(userId: string) {
    return (this.online.get(userId) ?? 0) > 0;
  }

  /** Tell these people to reload their room list (e.g. assigned to / removed from an event). */
  notifyRooms(orgId: string, to: string[]) {
    this.live.next({ orgId, to, type: 'rooms' });
  }

  // ---- Rooms and who may use them ----

  private async members(orgId: string) {
    return this.db.member.findMany({ where: { organizationId: orgId }, include: { user: { select: { id: true, name: true, email: true } } }, orderBy: { createdAt: 'asc' } });
  }

  /** Who is in a room (user ids). */
  async audience(room: Room) {
    if (room.kind === 'direct') return [room.userA!, room.userB!];
    const members = await this.members(room.organizationId);
    if (room.kind === 'team') return members.map((m) => m.userId);
    const assigned = new Set((await this.db.eventMember.findMany({ where: { eventId: room.eventId! }, select: { userId: true } })).map((x) => x.userId));
    return members.filter((m) => seesAllEvents(isRole(m.role) ? m.role : 'staff') || assigned.has(m.userId)).map((m) => m.userId);
  }

  /** The room behind an app key, checked and created if needed. */
  async room(c: Who, key: string): Promise<Room & { key: string }> {
    const orgId = c.org.id;
    const denied = () => new ApiError(404, { error: 'not_found', message: 'That conversation does not exist.' });
    let dbKey: string;
    let data: { kind: string; eventId?: number; userA?: string; userB?: string };
    if (key === 'team') {
      dbKey = `team:${orgId}`;
      data = { kind: 'team' };
    } else if (/^event-\d+$/.test(key)) {
      const eventId = Number(key.slice(6));
      const e = await this.db.event.findFirst({ where: { id: eventId, organizationId: orgId }, select: { id: true } });
      if (!e) throw denied();
      if (!c.allEvents && !(await this.db.eventMember.findUnique({ where: { eventId_userId: { eventId, userId: c.user.id } } }))) throw denied();
      dbKey = `event:${eventId}`;
      data = { kind: 'event', eventId };
    } else if (/^dm-.{1,100}$/.test(key)) {
      const other = key.slice(3);
      if (other === c.user.id || !(await this.db.member.findFirst({ where: { organizationId: orgId, userId: other } }))) throw denied();
      const [a, b] = [c.user.id, other].sort();
      dbKey = `dm:${orgId}:${a}:${b}`;
      data = { kind: 'direct', userA: a, userB: b };
    } else throw denied();
    const r = await this.db.chatRoom.upsert({ where: { key: dbKey }, create: { organizationId: orgId, key: dbKey, ...data }, update: {} });
    return { ...r, key };
  }

  /** The app's key for a room, as seen by `me`. */
  appKey(room: Room, me: string) {
    if (room.kind === 'team') return 'team';
    if (room.kind === 'event') return `event-${room.eventId}`;
    return `dm-${room.userA === me ? room.userB : room.userA}`;
  }

  /** The room list: the team, my events, everyone I can message; unread counts and last messages. */
  async rooms(c: Who) {
    const orgId = c.org.id;
    const [members, events] = await Promise.all([
      this.members(orgId),
      this.db.event.findMany({
        where: { organizationId: orgId, endsAt: { gt: new Date(Date.now() - 30 * 86_400_000) }, ...(c.allEvents ? {} : { team: { some: { userId: c.user.id } } }) },
        orderBy: { startsAt: 'asc' },
        take: 100,
        select: { id: true, title: true, startsAt: true },
      }),
    ]);
    const keys = [`team:${orgId}`, ...events.map((e) => `event:${e.id}`), ...members.filter((m) => m.userId !== c.user.id).map((m) => `dm:${orgId}:${[c.user.id, m.userId].sort().join(':')}`)];
    const rooms = await this.db.chatRoom.findMany({ where: { key: { in: keys } } });
    const reads = await this.db.chatRead.findMany({ where: { userId: c.user.id, roomId: { in: rooms.map((r) => r.id) } } });
    const unread = rooms.length
      ? await Promise.all(
          rooms.map(async (r) => {
            const after = reads.find((x) => x.roomId === r.id)?.lastReadId ?? 0;
            const [count, last] = await Promise.all([
              this.db.chatMessage.count({ where: { roomId: r.id, id: { gt: after }, userId: { not: c.user.id }, deletedAt: null } }),
              this.db.chatMessage.findFirst({ where: { roomId: r.id }, orderBy: { id: 'desc' } }),
            ]);
            return { roomId: r.id, count, last };
          }),
        )
      : [];
    const names = new Map(members.map((m) => [m.userId, m.user.name || m.user.email]));
    const info = (dbKey: string) => {
      const r = rooms.find((x) => x.key === dbKey);
      const u = r ? unread.find((x) => x.roomId === r.id) : undefined;
      const last = u?.last;
      return {
        unread: u?.count ?? 0,
        lastMessageAt: r?.lastMessageAt ?? null,
        last: last ? { by: names.get(last.userId) ?? 'Former member', text: last.deletedAt ? 'Message deleted' : last.body || (last.fileName ? `📎 ${last.fileName}` : ''), mine: last.userId === c.user.id } : null,
      };
    };
    return {
      team: { key: 'team', name: 'Whole team', ...info(`team:${orgId}`) },
      events: events.map((e) => ({ key: `event-${e.id}`, eventId: e.id, name: e.title, startsAt: e.startsAt, ...info(`event:${e.id}`) })),
      people: members
        .filter((m) => m.userId !== c.user.id)
        .map((m) => ({ key: `dm-${m.userId}`, userId: m.userId, name: m.user.name || m.user.email, email: m.user.email, role: m.role, online: this.isOnline(m.userId), ...info(`dm:${orgId}:${[c.user.id, m.userId].sort().join(':')}`) })),
    };
  }

  // ---- Messages ----

  private async names(orgId: string) {
    return new Map((await this.members(orgId)).map((m) => [m.userId, m.user.name || m.user.email]));
  }

  private row(m: { id: number; userId: string; body: string; file: string | null; fileType: string | null; fileName: string | null; fileSize: number | null; createdAt: Date; deletedAt: Date | null }, names: Map<string, string>, me: string) {
    return {
      id: m.id,
      userId: m.userId,
      by: names.get(m.userId) ?? 'Former member',
      mine: m.userId === me,
      body: m.deletedAt ? '' : m.body,
      deleted: !!m.deletedAt,
      file: !m.deletedAt && m.file ? { url: `/api/client/chat/files/${m.id}`, type: m.fileType, name: m.fileName, size: m.fileSize } : null,
      createdAt: m.createdAt,
    };
  }

  /** The latest messages (or the ones before `before`), oldest first. */
  async messages(c: Who, key: string, before?: number) {
    const room = await this.room(c, key);
    const rows = await this.db.chatMessage.findMany({ where: { roomId: room.id, ...(before ? { id: { lt: before } } : {}) }, orderBy: { id: 'desc' }, take: PAGE + 1 });
    const names = await this.names(c.org.id);
    const read = await this.db.chatRead.findUnique({ where: { roomId_userId: { roomId: room.id, userId: c.user.id } } });
    return { key, more: rows.length > PAGE, lastReadId: read?.lastReadId ?? 0, messages: rows.slice(0, PAGE).reverse().map((m) => this.row(m, names, c.user.id)) };
  }

  async send(c: Who, key: string, body: string, file: UploadedFileLike | undefined) {
    const text = body.trim().slice(0, MESSAGE_MAX);
    if (!text && !file) throw new ApiError(400, { error: 'validation_failed', message: 'Write a message or attach a file.', fields: { body: 'Required.' } });
    const room = await this.room(c, key);
    const stored = file ? await this.files.save('chat-files', file, { allowPdf: true, field: 'file' }) : null;
    const m = await this.db.chatMessage.create({
      data: { roomId: room.id, organizationId: c.org.id, userId: c.user.id, body: text, file: stored?.file ?? null, fileType: stored?.type ?? null, fileName: stored?.originalName ?? null, fileSize: stored?.size ?? null },
    });
    await this.db.chatRoom.update({ where: { id: room.id }, data: { lastMessageAt: m.createdAt } });
    // The author has read their own message.
    await this.markRead(c, room, m.id);
    const names = await this.names(c.org.id);
    const to = await this.audience(room);
    for (const userId of to) this.live.next({ orgId: c.org.id, to: [userId], type: 'message', room: this.appKey(room, userId), data: this.row(m, names, userId) });
    return this.row(m, names, c.user.id);
  }

  async remove(c: Who, key: string, id: number) {
    const room = await this.room(c, key);
    const m = await this.db.chatMessage.findFirst({ where: { id, roomId: room.id } });
    if (!m || m.deletedAt) throw new ApiError(404, { error: 'not_found', message: 'That message does not exist.' });
    if (m.userId !== c.user.id) throw new ApiError(403, { error: 'forbidden', message: 'You can only delete your own messages.' });
    await this.db.chatMessage.update({ where: { id }, data: { deletedAt: new Date(), body: '', file: null, fileType: null, fileName: null, fileSize: null } });
    await this.files.remove('chat-files', m.file);
    const to = await this.audience(room);
    for (const userId of to) this.live.next({ orgId: c.org.id, to: [userId], type: 'deleted', room: this.appKey(room, userId), data: { id } });
    return { ok: true };
  }

  private async markRead(c: Who, room: Room, lastId: number) {
    await this.db.chatRead.upsert({
      where: { roomId_userId: { roomId: room.id, userId: c.user.id } },
      create: { roomId: room.id, userId: c.user.id, lastReadId: lastId, notifiedId: lastId },
      update: { lastReadId: lastId, notifiedId: { set: lastId } },
    });
  }

  /** Read up to a message (never backwards): unread counts drop on the person's other devices too. */
  async read(c: Who, key: string, lastId: number) {
    const room = await this.room(c, key);
    const before = await this.db.chatRead.findUnique({ where: { roomId_userId: { roomId: room.id, userId: c.user.id } } });
    if ((before?.lastReadId ?? 0) < lastId) {
      const max = await this.db.chatMessage.findFirst({ where: { roomId: room.id }, orderBy: { id: 'desc' }, select: { id: true } });
      await this.markRead(c, room, Math.min(lastId, max?.id ?? 0));
    }
    this.live.next({ orgId: c.org.id, to: [c.user.id], type: 'read', room: key });
    return { ok: true };
  }

  async file(c: Who, id: number) {
    const m = await this.db.chatMessage.findFirst({ where: { id, organizationId: c.org.id, deletedAt: null }, include: { room: true } });
    if (!m || !m.file) throw new ApiError(404, { error: 'not_found', message: 'That file isn’t here any more.' });
    // Same checks as opening the room.
    await this.room(c, this.appKey(m.room, c.user.id));
    const body = await this.files.read('chat-files', m.file);
    if (!body) throw new ApiError(404, { error: 'not_found', message: 'That file isn’t here any more.' });
    return { body, type: m.fileType ?? 'application/octet-stream', name: m.fileName ?? 'file' };
  }

  /** Total unread, for the menu badge. */
  async unreadTotal(c: Who) {
    const r = await this.rooms(c);
    return [r.team, ...r.events, ...r.people].reduce((n, x) => n + x.unread, 0);
  }
}

/** Emails a summary of unread chat messages to members who weren't connected (every 5 minutes). */
@Injectable()
export class ChatDigestJob implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly db: ClientsDb,
    private readonly chat: ChatService,
    @Inject(MAILER) private readonly mailer: Mailer,
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
  ) {}

  onModuleInit() {
    if (this.cfg.nodeEnv === 'test') return;
    this.timer = setInterval(() => void this.run().catch((err: unknown) => logger.warn({ reason: err instanceof Error ? err.message : String(err) }, 'Chat digest failed')), 5 * 60_000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async run(now = new Date()) {
    const recent = await this.db.chatMessage.findMany({
      where: { deletedAt: null, createdAt: { lte: new Date(now.getTime() - DIGEST_AFTER_MS), gt: new Date(now.getTime() - DIGEST_WINDOW_MS) } },
      include: { room: { include: { event: { select: { title: true } } } } },
      orderBy: { id: 'asc' },
      take: 5000,
    });
    if (!recent.length) return 0;
    // Per person: per room, the unread messages they haven't been emailed about.
    type Pending = { orgId: string; rooms: Map<number, { room: (typeof recent)[number]['room']; count: number; maxId: number; lastText: string; lastBy: string }> };
    const pending = new Map<string, Pending>();
    const audiences = new Map<number, string[]>();
    const reads = new Map<string, { lastReadId: number; notifiedId: number }>();
    for (const r of await this.db.chatRead.findMany({ where: { roomId: { in: [...new Set(recent.map((m) => m.roomId))] } } })) reads.set(`${r.roomId}|${r.userId}`, r);
    const names = new Map<string, string>();
    for (const u of await this.db.user.findMany({ where: { id: { in: [...new Set(recent.map((m) => m.userId))] } }, select: { id: true, name: true, email: true } })) names.set(u.id, u.name || u.email);
    for (const m of recent) {
      if (!audiences.has(m.roomId)) audiences.set(m.roomId, await this.chat.audience(m.room));
      for (const userId of audiences.get(m.roomId)!) {
        if (userId === m.userId || this.chat.isOnline(userId)) continue;
        const read = reads.get(`${m.roomId}|${userId}`);
        if (m.id <= Math.max(read?.lastReadId ?? 0, read?.notifiedId ?? 0)) continue;
        const p = pending.get(`${m.organizationId}|${userId}`) ?? { orgId: m.organizationId, rooms: new Map() };
        const x = p.rooms.get(m.roomId) ?? { room: m.room, count: 0, maxId: 0, lastText: '', lastBy: '' };
        x.count++;
        x.maxId = m.id;
        x.lastText = m.body || (m.fileName ? `📎 ${m.fileName}` : '');
        x.lastBy = names.get(m.userId) ?? 'A teammate';
        p.rooms.set(m.roomId, x);
        pending.set(`${m.organizationId}|${userId}`, p);
      }
    }
    let sent = 0;
    for (const [k, p] of pending) {
      const userId = k.split('|')[1];
      const [user, org] = await Promise.all([this.db.user.findUnique({ where: { id: userId }, select: { email: true, name: true } }), this.db.organization.findUnique({ where: { id: p.orgId }, select: { name: true } })]);
      if (!user || !org) continue;
      const rooms = [...p.rooms.values()].map((x) => ({
        name: x.room.kind === 'team' ? 'Whole team' : x.room.kind === 'event' ? (x.room.event?.title ?? 'An event') : `Message from ${x.lastBy}`,
        count: x.count,
        last: `${x.lastBy}: ${x.lastText}`.slice(0, 160),
      }));
      this.mailer.sendInBackground(chatDigestMail(this.cfg, user.email, { businessName: org.name, rooms, url: `${this.cfg.clients.bookingsUrl}/app/chat` }));
      for (const [roomId, x] of p.rooms) {
        await this.db.chatRead.upsert({ where: { roomId_userId: { roomId, userId } }, create: { roomId, userId, lastReadId: 0, notifiedId: x.maxId }, update: { notifiedId: x.maxId } });
      }
      sent++;
    }
    if (sent) logger.info({ sent }, 'Chat digests emailed');
    return sent;
  }
}
