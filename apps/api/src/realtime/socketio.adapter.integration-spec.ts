import { createServer, type Server as HttpServer } from 'node:http';
import { io as createClient, type Socket as ClientSocket } from 'socket.io-client';
import { Server } from 'socket.io';
import { SocketIoAdapter } from './socketio.adapter';

describe('SocketIoAdapter protocol', () => {
  let httpServer: HttpServer;
  let ioServer: Server;
  let adapter: SocketIoAdapter;
  let client: ClientSocket;
  let url: string;

  beforeAll(async () => {
    httpServer = createServer();
    ioServer = new Server(httpServer);
    adapter = new SocketIoAdapter({
      authenticate: jest.fn().mockImplementation(async (token: string) => {
        if (token !== 'valid-access-token') throw new Error('invalid token');
        return { userId: 'user-1', verification: 'VERIFIED' as const };
      }),
    } as never);
    adapter.afterInit(ioServer);
    ioServer.on('connection', (socket) => void adapter.handleConnection(socket));
    await new Promise<void>((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
    const address = httpServer.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP listener.');
    url = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    client?.disconnect();
    await new Promise<void>((resolve) => ioServer.close(() => resolve()));
    await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  });

  it('delivers a compact signal only to an authenticated user room', async () => {
    client = createClient(url, { auth: { token: 'valid-access-token' }, transports: ['websocket'] });
    await new Promise<void>((resolve, reject) => {
      client.once('connect', resolve);
      client.once('connect_error', reject);
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    const signal = { kind: 'USER_EVENT_CHANGED', eventId: 'event-1', change: 'ATTENDANCE' };
    const received = new Promise<unknown>((resolve) => client.once('committed-change', resolve));

    adapter.emitUser('user-1', signal);

    await expect(received).resolves.toEqual(signal);
  });
});
