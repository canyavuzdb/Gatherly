import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { connect, type ChannelModel, type ConfirmChannel, type ConsumeMessage } from 'amqplib';
import { NotificationsImplementation } from '../notifications/notifications.implementation';
import type { CommittedFact, MessagingModule } from './messaging.interface';

const EXCHANGE = 'gatherly.committed-facts';
const QUEUE = 'gatherly.notifications';

@Injectable()
export class MessagingImplementation implements MessagingModule, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MessagingImplementation.name);
  private connection: ChannelModel | null = null;
  private channel: ConfirmChannel | null = null;

  constructor(
    private readonly notifications: NotificationsImplementation,
    private readonly rabbitUrl?: string,
  ) {}

  async onModuleInit(): Promise<void> {
    if (!this.rabbitUrl) return;
    try {
      this.connection = await connect(this.rabbitUrl);
      this.channel = await this.connection.createConfirmChannel();
      await this.channel.assertExchange(EXCHANGE, 'topic', { durable: true });
      await this.channel.assertQueue(QUEUE, { durable: true });
      await this.channel.bindQueue(QUEUE, EXCHANGE, '#');
      await this.channel.consume(QUEUE, (message) => this.consume(message), { noAck: false });
    } catch (error) {
      this.channel = null;
      this.connection = null;
      this.logFailure('connect to RabbitMQ', error);
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.channel?.close().catch(() => undefined);
    await this.connection?.close().catch(() => undefined);
  }

  isConnected(): boolean {
    return this.channel !== null;
  }

  async publish(facts: readonly CommittedFact[]): Promise<void> {
    for (const fact of facts) {
      try {
        if (this.channel) {
          this.channel.publish(EXCHANGE, fact.eventName, Buffer.from(JSON.stringify(fact)), {
            contentType: 'application/json', deliveryMode: 2, messageId: fact.messageId,
          });
          await this.channel.waitForConfirms();
        } else {
          // The test/local adapter keeps post-commit semantics without requiring RabbitMQ.
          await this.notifications.consume(fact);
        }
      } catch (error) {
        this.logFailure(`distribute committed fact ${fact.eventName} (${fact.messageId})`, error);
      }
    }
  }

  private async consume(message: ConsumeMessage | null): Promise<void> {
    if (!message || !this.channel) return;
    try {
      const fact = JSON.parse(message.content.toString('utf8')) as CommittedFact;
      await this.notifications.consume(fact);
      this.channel.ack(message);
    } catch (error) {
      this.logFailure('consume RabbitMQ fact', error);
      this.channel.nack(message, false, true);
    }
  }

  private logFailure(action: string, error: unknown): void {
    this.logger.error(`Failed to ${action}.`, error instanceof Error ? error.stack : undefined);
  }
}
