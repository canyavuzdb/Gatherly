import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NotificationsNestModule } from '../notifications/notifications.module';
import { NotificationsImplementation } from '../notifications/notifications.implementation';
import { MessagingImplementation } from './messaging.implementation';

@Module({
  imports: [NotificationsNestModule],
  providers: [{
    provide: MessagingImplementation,
    inject: [NotificationsImplementation, ConfigService],
    useFactory: (notifications: NotificationsImplementation, config: ConfigService) =>
      new MessagingImplementation(notifications, config.get<string>('RABBITMQ_URL')),
  }],
  exports: [MessagingImplementation],
})
export class MessagingNestModule {}
