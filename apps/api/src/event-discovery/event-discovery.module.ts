import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AuthNestModule } from '../auth/auth.module';
import { EventRoutingNestModule } from '../event-routing/event-routing.module';
import { OpenRouteServiceEventRoutingImplementation } from '../event-routing/event-routing.implementation';
import { AttendanceRecord, CategoryRecord, EventLocationRecord, EventOrganizerTransferRecord, EventRecord } from '../events/events.persistence';
import { EventDiscoveryHttpController } from './event-discovery.http';
import { EventDiscoveryImplementation } from './event-discovery.implementation';
@Module({
  imports: [AuthNestModule, EventRoutingNestModule, TypeOrmModule.forFeature([EventRecord, EventLocationRecord, CategoryRecord, AttendanceRecord, EventOrganizerTransferRecord])],
  controllers: [EventDiscoveryHttpController],
  providers: [{
    provide: EventDiscoveryImplementation,
    inject: [DataSource, OpenRouteServiceEventRoutingImplementation],
    useFactory: (dataSource: DataSource, routing: OpenRouteServiceEventRoutingImplementation) => new EventDiscoveryImplementation(dataSource, undefined, routing),
  }],
})
export class EventDiscoveryNestModule {}
