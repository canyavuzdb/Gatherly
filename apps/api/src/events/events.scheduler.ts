import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { EventModule } from './events.interface';

const COMPLETION_INTERVAL_MS = 60_000;

@Injectable()
export class EventCompletionScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(EventCompletionScheduler.name);
  private timer?: NodeJS.Timeout;

  constructor(private readonly events: EventModule) {}

  onModuleInit(): void {
    void this.run();
    this.timer = setInterval(() => void this.run(), COMPLETION_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async run(): Promise<void> {
    try {
      await this.events.decide({ kind: 'COMPLETE_DUE_EVENTS' });
    } catch (error) {
      this.logger.error('Failed to complete due events.', error instanceof Error ? error.stack : undefined);
    }
  }
}
