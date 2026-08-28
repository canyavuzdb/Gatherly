import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthNestModule } from '../auth/auth.module';
import { MessagingNestModule } from '../messaging/messaging.module';
import { MessagingImplementation } from '../messaging/messaging.implementation';
import { DataSource } from 'typeorm';
import { EventsHttpController } from './events.http';
import { EventsImplementation } from './events.implementation';
import {
  AttendanceRecord,
  CategoryRecord,
  EventCreationQuotaUsageRecord,
  EventLocationRecord,
  EventRecord,
} from './events.persistence';

@Module({
  imports: [
    AuthNestModule, MessagingNestModule,
    TypeOrmModule.forFeature([
      CategoryRecord,
      EventRecord,
      EventLocationRecord,
      EventCreationQuotaUsageRecord,
      AttendanceRecord,
    ]),
  ],
  controllers: [EventsHttpController],
  providers: [{ provide: EventsImplementation, inject: [DataSource, MessagingImplementation], useFactory: (dataSource: DataSource, messaging: MessagingImplementation) => new EventsImplementation(dataSource, {}, messaging) }],
  exports: [EventsImplementation],
})
export class EventsNestModule {}
