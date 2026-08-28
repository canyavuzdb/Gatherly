import { ServiceUnavailableException } from '@nestjs/common';
import { AppController } from './app.controller';
import { MessagingImplementation } from './messaging/messaging.implementation';

describe('System health endpoints', () => {
  it('keeps liveness independent from remote dependencies', () => {
    const controller = new AppController({ query: jest.fn() } as never, { isConnected: jest.fn() } as never);
    expect(controller.health()).toEqual({ status: 'ok' });
  });

  it('reports ready only when PostgreSQL and RabbitMQ are available', async () => {
    const database = { query: jest.fn().mockResolvedValue([{ '?column?': 1 }]) };
    const messaging = { isConnected: jest.fn().mockReturnValue(true) } as unknown as MessagingImplementation;
    const controller = new AppController(database as never, messaging);

    await expect(controller.ready()).resolves.toEqual({ status: 'ready', databaseReady: true, rabbitMqReady: true });
  });

  it('reports not-ready when either required dependency is unavailable', async () => {
    const database = { query: jest.fn().mockRejectedValue(new Error('database unavailable')) };
    const messaging = { isConnected: jest.fn().mockReturnValue(false) } as unknown as MessagingImplementation;
    const controller = new AppController(database as never, messaging);

    await expect(controller.ready()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
