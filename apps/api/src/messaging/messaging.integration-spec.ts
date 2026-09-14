import { MessagingImplementation } from './messaging.implementation';
import type { NotificationsImplementation } from '../notifications/notifications.implementation';
import { Logger } from '@nestjs/common';

describe('MessagingModule', () => {
  it('writes a committed fact to the outbox through the caller transaction manager', async () => {
    const messaging = new MessagingImplementation({ consume: jest.fn() } as unknown as NotificationsImplementation);
    const manager = { query: jest.fn().mockResolvedValue(undefined) };
    const fact = {
      messageId: 'message-1', eventName: 'invitation.received.v1' as const, eventVersion: 1 as const,
      occurredAt: new Date('2026-08-28T12:00:00.000Z'), correlationId: 'message-1',
      payload: { recipientUserId: 'user-1', eventId: 'event-1', title: 'Invitation', body: 'You are invited.' },
    };

    await messaging.enqueue(manager as never, [fact]);

    expect(manager.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO message_outbox'),
      [fact.messageId, fact.eventName, fact.eventVersion, fact.occurredAt, fact.correlationId, JSON.stringify(fact.payload)],
    );
  });

  it('contains downstream delivery failures after a source transaction has committed', async () => {
    const logError = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const notifications = {
      consume: jest.fn().mockRejectedValue(new Error('consumer unavailable')),
    } as unknown as NotificationsImplementation;
    const messaging = new MessagingImplementation(notifications);

    await expect(messaging.publish([{
      messageId: 'message-1', eventName: 'invitation.received.v1', eventVersion: 1,
      occurredAt: new Date('2026-08-28T12:00:00.000Z'), correlationId: 'message-1',
      payload: { recipientUserId: 'user-1', eventId: 'event-1', title: 'Invitation', body: 'You are invited.' },
    }])).resolves.toBeUndefined();
    expect(notifications.consume).toHaveBeenCalledTimes(1);
    expect(logError).toHaveBeenCalledTimes(1);
    logError.mockRestore();
  });

  const rabbitUrl = process.env.RABBITMQ_URL;
  (rabbitUrl ? it : it.skip)('publishes and consumes a fact through RabbitMQ', async () => {
    const notifications = { consume: jest.fn().mockResolvedValue({ created: true }) } as unknown as NotificationsImplementation;
    const messaging = new MessagingImplementation(notifications, rabbitUrl);
    await messaging.onModuleInit();
    await messaging.publish([{
      messageId: `rabbit-${Date.now()}`, eventName: 'invitation.received.v1', eventVersion: 1,
      occurredAt: new Date(), correlationId: 'rabbit-test',
      payload: { recipientUserId: 'user-1', eventId: 'event-1', title: 'Invitation', body: 'You are invited.' },
    }]);
    await waitFor(() => expect(notifications.consume).toHaveBeenCalledTimes(1));
    await messaging.onModuleDestroy();
  });
});

async function waitFor(assertion: () => void): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    try { assertion(); return; } catch { await new Promise((resolve) => setTimeout(resolve, 25)); }
  }
  assertion();
}
