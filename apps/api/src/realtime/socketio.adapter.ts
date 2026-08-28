import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { OnGatewayConnection, OnGatewayInit } from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { AuthImplementation } from '../auth/auth.implementation';

@WebSocketGateway({ cors: { origin: true, credentials: true } })
export class SocketIoAdapter implements OnGatewayInit, OnGatewayConnection {
  @WebSocketServer() private server?: Server;

  constructor(private readonly auth: AuthImplementation) {}

  afterInit(server: Server) { this.server = server; }

  async handleConnection(socket: Socket) {
    const token = typeof socket.handshake.auth.token === 'string' ? socket.handshake.auth.token : undefined;
    if (!token) return socket.disconnect(true);
    try {
      const actor = await this.auth.authenticate(token);
      socket.join(`user:${actor.userId}`);
    } catch {
      socket.disconnect(true);
    }
  }

  emitUser(userId: string, signal: Record<string, unknown>) {
    this.server?.to(`user:${userId}`).emit('committed-change', signal);
  }

  emitPublicEvent(eventId: string, signal: Record<string, unknown>) {
    this.server?.to(`event:${eventId}`).emit('committed-change', signal);
  }
}
