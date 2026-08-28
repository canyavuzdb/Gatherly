import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import { MessagingImplementation } from './messaging/messaging.implementation';

@ApiTags('System')
@Controller()
export class AppController {
  constructor(private readonly dataSource: DataSource, private readonly messaging: MessagingImplementation) {}

  @Get('health')
  @ApiOperation({ summary: 'Check API availability' })
  health() {
    return { status: 'ok' };
  }

  @Get('health/ready')
  @ApiOperation({ summary: 'Check PostgreSQL and RabbitMQ readiness' })
  async ready() {
    const databaseReady = await this.dataSource.query('SELECT 1').then(() => true).catch(() => false);
    const rabbitMqReady = this.messaging.isConnected();
    if (!databaseReady || !rabbitMqReady) {
      throw new ServiceUnavailableException({ status: 'not_ready', databaseReady, rabbitMqReady });
    }
    return { status: 'ready', databaseReady, rabbitMqReady };
  }
}
