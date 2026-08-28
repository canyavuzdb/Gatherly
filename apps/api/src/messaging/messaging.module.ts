import { Module } from '@nestjs/common'; import { NotificationsNestModule } from '../notifications/notifications.module'; import { MessagingImplementation } from './messaging.implementation';
@Module({ imports: [NotificationsNestModule], providers: [MessagingImplementation], exports: [MessagingImplementation] }) export class MessagingNestModule {}
