import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthNestModule } from '../auth/auth.module';
import { AttendanceRecord, CategoryRecord, EventLocationRecord, EventRecord } from '../events/events.persistence';
import { EventDiscoveryHttpController } from './event-discovery.http';
import { EventDiscoveryImplementation } from './event-discovery.implementation';
@Module({ imports: [AuthNestModule, TypeOrmModule.forFeature([EventRecord, EventLocationRecord, CategoryRecord, AttendanceRecord])], controllers: [EventDiscoveryHttpController], providers: [EventDiscoveryImplementation] })
export class EventDiscoveryNestModule {}
