import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AuthNestModule } from '../auth/auth.module';
import { UserRecord } from '../auth/auth.persistence';
import { EventRecord, InvitationRecord } from '../events/events.persistence';
import { InvitationsHttpController } from './invitations.http';
import { InvitationsImplementation } from './invitations.implementation';
import { MessagingNestModule } from '../messaging/messaging.module';
import { MessagingImplementation } from '../messaging/messaging.implementation';
import { RealtimeImplementation } from '../realtime/realtime.implementation';
import { RealtimeNestModule } from '../realtime/realtime.module';
@Module({
  imports: [AuthNestModule, MessagingNestModule, RealtimeNestModule, TypeOrmModule.forFeature([UserRecord, EventRecord, InvitationRecord])],
  controllers: [InvitationsHttpController],
  providers: [{
    provide: InvitationsImplementation,
    inject: [DataSource, MessagingImplementation, RealtimeImplementation],
    useFactory: (dataSource: DataSource, messaging: MessagingImplementation, realtime: RealtimeImplementation) => new InvitationsImplementation(dataSource, messaging, undefined, realtime),
  }],
  exports: [InvitationsImplementation],
})
export class InvitationsNestModule {}
