import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { NotificationsNestModule } from '../notifications/notifications.module';
import { NotificationsImplementation } from '../notifications/notifications.implementation';
import { MessagingImplementation } from './messaging.implementation';

@Module({
  imports: [NotificationsNestModule],
  providers: [{
    provide: MessagingImplementation,
    inject: [NotificationsImplementation, ConfigService, DataSource],
    useFactory: (notifications: NotificationsImplementation, config: ConfigService, dataSource: DataSource) =>
      new MessagingImplementation(notifications, config.get<string>('RABBITMQ_URL'), dataSource),
  }],
  exports: [MessagingImplementation],
})
export class MessagingNestModule {}
