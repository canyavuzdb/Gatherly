import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthNestModule } from '../auth/auth.module';
import { UserRecord } from '../auth/auth.persistence';
import { AttendanceRecord, EventRecord, InvitationRecord } from '../events/events.persistence';
import { MessagingNestModule } from '../messaging/messaging.module';
import { MessagingImplementation } from '../messaging/messaging.implementation';
import { RealtimeImplementation } from '../realtime/realtime.implementation';
import { RealtimeNestModule } from '../realtime/realtime.module';
import { DataSource } from 'typeorm';
import { AttendanceHttpController } from './attendance.http';
import { AttendanceImplementation } from './attendance.implementation';

@Module({
  imports: [AuthNestModule, MessagingNestModule, RealtimeNestModule, TypeOrmModule.forFeature([UserRecord, EventRecord, AttendanceRecord, InvitationRecord])],
  controllers: [AttendanceHttpController],
  providers: [{ provide: AttendanceImplementation, inject: [DataSource, MessagingImplementation, RealtimeImplementation], useFactory: (dataSource: DataSource, messaging: MessagingImplementation, realtime: RealtimeImplementation) => new AttendanceImplementation(dataSource, undefined, messaging, realtime) }],
})
export class AttendanceNestModule {}
