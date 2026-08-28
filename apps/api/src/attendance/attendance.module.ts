import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthNestModule } from '../auth/auth.module';
import { UserRecord } from '../auth/auth.persistence';
import { AttendanceRecord, EventRecord, InvitationRecord } from '../events/events.persistence';
import { MessagingNestModule } from '../messaging/messaging.module';
import { MessagingImplementation } from '../messaging/messaging.implementation';
import { DataSource } from 'typeorm';
import { AttendanceHttpController } from './attendance.http';
import { AttendanceImplementation } from './attendance.implementation';

@Module({
  imports: [AuthNestModule, MessagingNestModule, TypeOrmModule.forFeature([UserRecord, EventRecord, AttendanceRecord, InvitationRecord])],
  controllers: [AttendanceHttpController],
  providers: [{ provide: AttendanceImplementation, inject: [DataSource, MessagingImplementation], useFactory: (dataSource: DataSource, messaging: MessagingImplementation) => new AttendanceImplementation(dataSource, undefined, messaging) }],
})
export class AttendanceNestModule {}
