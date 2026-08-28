import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AuthNestModule } from '../auth/auth.module';
import { RealtimeImplementation } from '../realtime/realtime.implementation';
import { RealtimeNestModule } from '../realtime/realtime.module';
import { NotificationsHttpController } from './notifications.http';
import { NotificationsImplementation } from './notifications.implementation';
import { NotificationRecord } from './notifications.persistence';

@Module({
  imports: [AuthNestModule, RealtimeNestModule, TypeOrmModule.forFeature([NotificationRecord])],
  controllers: [NotificationsHttpController],
  providers: [{
    provide: NotificationsImplementation,
    inject: [DataSource, RealtimeImplementation],
    useFactory: (dataSource: DataSource, realtime: RealtimeImplementation) => new NotificationsImplementation(dataSource, undefined, realtime),
  }],
  exports: [NotificationsImplementation],
})
export class NotificationsNestModule {}
