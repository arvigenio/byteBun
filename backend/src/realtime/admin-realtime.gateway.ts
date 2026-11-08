// Live updates for the admin site (Socket.IO; the Node.js counterpart of SignalR).
//
//   path: /api/realtime   (under /api, so the dev proxy and the reverse proxy already route it)
//   events sent to admins: "lead.created", "lead.updated", "booking.changed"
//
// Only fully signed-in admins can connect: the handshake carries the browser's session cookie
// and is checked exactly like an /api/admin request (role admin, authenticator, second factor,
// not banned). Connections are re-checked every few minutes, so a session that expires or is
// signed out from the Security page also loses its live connection.
// Events carry only what the admin list needs to show a toast; the page then reloads the data
// through the normal (guarded) API.
import { Inject, OnModuleDestroy } from '@nestjs/common';
import { type OnGatewayConnection, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { getAdminSession } from '../auth/admin-session';
import type { Auth } from '../auth/auth';
import { AUTH } from '../auth/auth.module';
import { config } from '../config/config';
import { logger } from '../logging/logger';

const ADMINS_ROOM = 'admins';
const RECHECK_MS = 5 * 60_000;

@WebSocketGateway({
  path: '/api/realtime',
  serveClient: false,
  cors: { origin: [config.auth.url], credentials: true },
  transports: ['websocket', 'polling'],
})
export class AdminRealtimeGateway implements OnGatewayConnection, OnModuleDestroy {
  @WebSocketServer() server!: Server;
  private recheck: NodeJS.Timeout | null = null;

  constructor(@Inject(AUTH) private readonly auth: Auth) {}

  async handleConnection(client: Socket) {
    try {
      const origin = client.handshake.headers.origin;
      if (origin && origin !== config.auth.url) throw new Error('origin not allowed');
      const admin = await getAdminSession(this.auth, client.handshake.headers);
      if (!admin) throw new Error('not signed in');
      client.data.sessionToken = admin.session.token;
      client.data.userId = admin.user.id;
      await client.join(ADMINS_ROOM);
      this.startRecheck();
    } catch {
      client.emit('unauthorized');
      client.disconnect(true);
    }
  }

  /** Drops connections whose session is no longer valid. */
  private startRecheck() {
    if (this.recheck) return;
    this.recheck = setInterval(async () => {
      const sockets = await this.server.in(ADMINS_ROOM).fetchSockets();
      for (const s of sockets) {
        const admin = await getAdminSession(this.auth, s.handshake.headers).catch(() => null);
        if (!admin || admin.session.token !== s.data.sessionToken) {
          s.emit('unauthorized');
          s.disconnect(true);
        }
      }
    }, RECHECK_MS);
    this.recheck.unref();
  }

  onModuleDestroy() {
    if (this.recheck) clearInterval(this.recheck);
  }

  emit(event: string, payload: unknown) {
    if (!this.server) return;
    this.server.to(ADMINS_ROOM).emit(event, payload);
    logger.debug({ event }, 'Realtime event sent');
  }
}
