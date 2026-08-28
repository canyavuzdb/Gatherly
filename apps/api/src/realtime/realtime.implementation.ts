import type { CommittedRealtimeSignal, RealtimeModule } from './realtime.interface';
import { SocketIoAdapter } from './socketio.adapter';

export class RealtimeImplementation implements RealtimeModule {
  constructor(private readonly socket: SocketIoAdapter) {}

  async emit(signal: CommittedRealtimeSignal): Promise<void> {
    if (signal.kind === 'NOTIFICATIONS_CHANGED') {
      this.socket.emitUser(signal.recipientUserId, { kind: signal.kind });
      return;
    }
    if (signal.kind === 'USER_EVENT_CHANGED') {
      this.socket.emitUser(signal.recipientUserId, { kind: signal.kind, eventId: signal.eventId, change: signal.change });
      return;
    }
    this.socket.emitPublicEvent(signal.eventId, { kind: signal.kind, eventId: signal.eventId, change: signal.change });
  }
}
