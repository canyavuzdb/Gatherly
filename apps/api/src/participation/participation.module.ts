import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AuthNestModule } from '../auth/auth.module';
import { AttendanceRecord, EventRecord } from '../events/events.persistence';
import { ParticipationHttpController } from './participation.http';
import { ParticipationImplementation } from './participation.implementation';
import { CheckInRecord, ParticipationOutcomeRecord } from './participation.persistence';
import { ParticipationFinalizationScheduler } from './participation.scheduler';
import { MessagingNestModule } from '../messaging/messaging.module';
import { MessagingImplementation } from '../messaging/messaging.implementation';

@Module({
  imports: [AuthNestModule, MessagingNestModule, TypeOrmModule.forFeature([EventRecord, AttendanceRecord, CheckInRecord, ParticipationOutcomeRecord])],
  controllers: [ParticipationHttpController],
  providers: [
    { provide: ParticipationImplementation, inject: [DataSource, MessagingImplementation], useFactory: (dataSource: DataSource, messaging: MessagingImplementation) => new ParticipationImplementation(dataSource, undefined, messaging) },
    { provide: ParticipationFinalizationScheduler, inject: [ParticipationImplementation], useFactory: (participation: ParticipationImplementation) => new ParticipationFinalizationScheduler(participation) },
  ],
})
export class ParticipationNestModule {}
