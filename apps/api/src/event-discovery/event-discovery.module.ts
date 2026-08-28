import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AuthNestModule } from '../auth/auth.module';
import { AttendanceRecord, CategoryRecord, EventLocationRecord, EventRecord } from '../events/events.persistence';
import { EventDiscoveryHttpController } from './event-discovery.http';
import { EventDiscoveryImplementation } from './event-discovery.implementation';
@Module({
  imports: [AuthNestModule, TypeOrmModule.forFeature([EventRecord, EventLocationRecord, CategoryRecord, AttendanceRecord])],
  controllers: [EventDiscoveryHttpController],
  providers: [{
    provide: EventDiscoveryImplementation,
    inject: [DataSource],
    useFactory: (dataSource: DataSource) => new EventDiscoveryImplementation(dataSource),
  }],
})
export class EventDiscoveryNestModule {}
