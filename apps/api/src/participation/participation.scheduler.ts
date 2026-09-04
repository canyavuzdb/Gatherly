import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { ParticipationModule } from './participation.interface';

@Injectable()
export class ParticipationFinalizationScheduler implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private readonly logger = new Logger(ParticipationFinalizationScheduler.name);
  constructor(private readonly participation: ParticipationModule) {}
  onModuleInit(): void { void this.run(); this.timer = setInterval(() => void this.run(), 60_000); this.timer.unref(); }
  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); }
  private async run(): Promise<void> { try { await this.participation.decide({ kind: 'FINALIZE_DUE_PARTICIPATION' }); } catch (error) { this.logger.error('Failed to finalize participation.', error instanceof Error ? error.stack : undefined); } }
}
