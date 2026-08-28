import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule, type TypeOrmModuleOptions } from '@nestjs/typeorm';
import type { DataSourceOptions } from 'typeorm';
import { AppController } from './app.controller';
import { AttendanceNestModule } from './attendance/attendance.module';
import { AuthNestModule } from './auth/auth.module';
import databaseConfig from './config/database.config';
import { validateEnvironment } from './config/env.validation';
import { EventsNestModule } from './events/events.module';
import { EventDiscoveryNestModule } from './event-discovery/event-discovery.module';
import { InvitationsNestModule } from './invitations/invitations.module';
import { NotificationsNestModule } from './notifications/notifications.module';
import { MessagingNestModule } from './messaging/messaging.module';
import { MediaNestModule } from './media/media.module';
import { UsersNestModule } from './users/users.module';
import { RealtimeNestModule } from './realtime/realtime.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      expandVariables: true,
      load: [databaseConfig],
      validate: validateEnvironment,
    }),
    TypeOrmModule.forRootAsync({
      inject: [databaseConfig.KEY],
      useFactory: (databaseOptions: DataSourceOptions): TypeOrmModuleOptions => ({
        ...databaseOptions,
        autoLoadEntities: true,
        retryAttempts: 5,
        retryDelay: 3000,
      }),
    }),
    AuthNestModule,
    UsersNestModule,
    EventsNestModule,
    EventDiscoveryNestModule,
    InvitationsNestModule,
    NotificationsNestModule,
    RealtimeNestModule,
    MessagingNestModule,
    MediaNestModule,
    AttendanceNestModule,
  ],
  controllers: [AppController],
})
export class AppModule {}
