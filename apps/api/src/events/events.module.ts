import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthNestModule } from '../auth/auth.module';
import { MessagingNestModule } from '../messaging/messaging.module';
import { MessagingImplementation } from '../messaging/messaging.implementation';
import { RealtimeImplementation } from '../realtime/realtime.implementation';
import { RealtimeNestModule } from '../realtime/realtime.module';
import { DataSource } from 'typeorm';
import { EventsHttpController } from './events.http';
import { EventsImplementation } from './events.implementation';
import { EventCompletionScheduler } from './events.scheduler';
import {
  AttendanceRecord,
  CategoryRecord,
  EventCreationQuotaUsageRecord,
  EventLocationRecord,
  EventOrganizerTransferRecord,
  EventRecord,
} from './events.persistence';

@Module({
  imports: [
    AuthNestModule, MessagingNestModule, RealtimeNestModule,
    TypeOrmModule.forFeature([
      CategoryRecord,
      EventRecord,
      EventLocationRecord,
      EventCreationQuotaUsageRecord,
      AttendanceRecord,
      EventOrganizerTransferRecord,
    ]),
  ],
  controllers: [EventsHttpController],
  providers: [
    { provide: EventsImplementation, inject: [DataSource, MessagingImplementation, RealtimeImplementation], useFactory: (dataSource: DataSource, messaging: MessagingImplementation, realtime: RealtimeImplementation) => new EventsImplementation(dataSource, {}, messaging, realtime) },
    { provide: EventCompletionScheduler, inject: [EventsImplementation], useFactory: (events: EventsImplementation) => new EventCompletionScheduler(events) },
  ],
  exports: [EventsImplementation],
})
export class EventsNestModule {}
