import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { connect, type ChannelModel, type ConfirmChannel, type ConsumeMessage } from 'amqplib';
import type { DataSource, EntityManager } from 'typeorm';
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
    private readonly dataSource?: DataSource,
  ) {}
  private flushTimer?: NodeJS.Timeout;
  private flushInProgress = false;

  async onModuleInit(): Promise<void> {
    await this.connect();
    if (this.dataSource) {
      this.flushTimer = setInterval(() => void this.flushOutbox(), 1_000);
      await this.flushOutbox();
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.flushTimer) clearInterval(this.flushTimer);
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

  /** Writes facts with the business change. The outbox publisher owns broker retries. */
  async enqueue(manager: EntityManager, facts: readonly CommittedFact[]): Promise<void> {
    for (const fact of facts) {
      await manager.query(
        `INSERT INTO message_outbox
          (message_id, event_name, event_version, occurred_at, correlation_id, payload)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)
         ON CONFLICT (message_id) DO NOTHING`,
        [fact.messageId, fact.eventName, fact.eventVersion, fact.occurredAt, fact.correlationId, JSON.stringify(fact.payload)],
      );
    }
  }

  private async connect(): Promise<void> {
    if (!this.rabbitUrl || this.channel) return;
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

  private async flushOutbox(): Promise<void> {
    if (!this.dataSource || this.flushInProgress) return;
    this.flushInProgress = true;
    try {
      await this.connect();
      if (!this.channel) return;
      const rows = await this.dataSource.query(`
        SELECT id, message_id AS "messageId", event_name AS "eventName",
          event_version AS "eventVersion", occurred_at AS "occurredAt",
          correlation_id AS "correlationId", payload
        FROM message_outbox
        WHERE published_at IS NULL
        ORDER BY created_at ASC, id ASC
        LIMIT 100
      `) as Array<{ id: string; messageId: string; eventName: CommittedFact['eventName']; eventVersion: 1; occurredAt: Date; correlationId: string; payload: CommittedFact['payload'] }>;
      for (const row of rows) {
        const fact: CommittedFact = { ...row, occurredAt: new Date(row.occurredAt) };
        try {
          this.channel.publish(EXCHANGE, fact.eventName, Buffer.from(JSON.stringify(fact)), {
            contentType: 'application/json', deliveryMode: 2, messageId: fact.messageId,
          });
          await this.channel.waitForConfirms();
          await this.dataSource.query('UPDATE message_outbox SET published_at = now(), last_error = NULL WHERE id = $1 AND published_at IS NULL', [row.id]);
        } catch (error) {
          await this.dataSource.query('UPDATE message_outbox SET attempt_count = attempt_count + 1, last_error = $2 WHERE id = $1', [row.id, error instanceof Error ? error.message : 'Unknown publish error']);
          this.logFailure(`publish outbox fact ${fact.eventName} (${fact.messageId})`, error);
          break;
        }
      }
    } finally {
      this.flushInProgress = false;
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
