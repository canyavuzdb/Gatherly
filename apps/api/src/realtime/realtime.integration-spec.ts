import { RealtimeImplementation } from './realtime.implementation';
import { SocketIoAdapter } from './socketio.adapter';

describe('RealtimeImplementation', () => {
  it('keeps room selection and payload minimization inside the realtime module', async () => {
    const socket = {
      emitUser: jest.fn(),
      emitPublicEvent: jest.fn(),
    } as unknown as SocketIoAdapter;
    const realtime = new RealtimeImplementation(socket);

    await realtime.emit({ kind: 'NOTIFICATIONS_CHANGED', recipientUserId: 'user-1' });
    await realtime.emit({ kind: 'USER_EVENT_CHANGED', recipientUserId: 'user-1', eventId: 'event-1', change: 'ATTENDANCE' });
    await realtime.emit({ kind: 'PUBLIC_EVENT_CHANGED', eventId: 'event-1', change: 'CAPACITY' });

    expect(socket.emitUser).toHaveBeenNthCalledWith(1, 'user-1', { kind: 'NOTIFICATIONS_CHANGED' });
    expect(socket.emitUser).toHaveBeenNthCalledWith(2, 'user-1', {
      kind: 'USER_EVENT_CHANGED', eventId: 'event-1', change: 'ATTENDANCE',
    });
    expect(socket.emitPublicEvent).toHaveBeenCalledWith('event-1', {
      kind: 'PUBLIC_EVENT_CHANGED', eventId: 'event-1', change: 'CAPACITY',
    });
  });

  it('admits only authenticated sockets to their own user room', async () => {
    const auth = {
      authenticate: jest.fn().mockResolvedValue({ userId: 'user-1', verification: 'VERIFIED' }),
    };
    const adapter = new SocketIoAdapter(auth as never);
    const socket = {
      handshake: { auth: { token: 'access-token' } },
      join: jest.fn(),
      disconnect: jest.fn(),
    };

    await adapter.handleConnection(socket as never);

    expect(auth.authenticate).toHaveBeenCalledWith('access-token');
    expect(socket.join).toHaveBeenCalledWith('user:user-1');
    expect(socket.disconnect).not.toHaveBeenCalled();
  });

  it('disconnects sockets without a valid access token', async () => {
    const auth = { authenticate: jest.fn().mockRejectedValue(new Error('invalid')) };
    const adapter = new SocketIoAdapter(auth as never);
    const missingToken = { handshake: { auth: {} }, disconnect: jest.fn() };
    const invalidToken = { handshake: { auth: { token: 'invalid' } }, disconnect: jest.fn() };

    await adapter.handleConnection(missingToken as never);
    await adapter.handleConnection(invalidToken as never);

    expect(missingToken.disconnect).toHaveBeenCalledWith(true);
    expect(invalidToken.disconnect).toHaveBeenCalledWith(true);
  });
});
