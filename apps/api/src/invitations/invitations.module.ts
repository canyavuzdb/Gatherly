import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthNestModule } from '../auth/auth.module';
import { UserRecord } from '../auth/auth.persistence';
import { EventRecord, InvitationRecord } from '../events/events.persistence';
import { InvitationsHttpController } from './invitations.http';
import { InvitationsImplementation } from './invitations.implementation';
import { MessagingNestModule } from '../messaging/messaging.module';
import { RealtimeNestModule } from '../realtime/realtime.module';
@Module({ imports: [AuthNestModule, MessagingNestModule, RealtimeNestModule, TypeOrmModule.forFeature([UserRecord, EventRecord, InvitationRecord])], controllers: [InvitationsHttpController], providers: [InvitationsImplementation], exports: [InvitationsImplementation] })
export class InvitationsNestModule {}
