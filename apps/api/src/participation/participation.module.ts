import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AuthNestModule } from '../auth/auth.module';
import { AttendanceRecord, EventRecord } from '../events/events.persistence';
import { ParticipationHttpController } from './participation.http';
import { ParticipationImplementation } from './participation.implementation';
import { CheckInRecord, ParticipationOutcomeRecord } from './participation.persistence';
import { ParticipationFinalizationScheduler } from './participation.scheduler';

@Module({
  imports: [AuthNestModule, TypeOrmModule.forFeature([EventRecord, AttendanceRecord, CheckInRecord, ParticipationOutcomeRecord])],
  controllers: [ParticipationHttpController],
  providers: [
    { provide: ParticipationImplementation, inject: [DataSource], useFactory: (dataSource: DataSource) => new ParticipationImplementation(dataSource) },
    { provide: ParticipationFinalizationScheduler, inject: [ParticipationImplementation], useFactory: (participation: ParticipationImplementation) => new ParticipationFinalizationScheduler(participation) },
  ],
})
export class ParticipationNestModule {}
