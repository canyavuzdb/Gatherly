import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AuthNestModule } from '../auth/auth.module';
import { ProfileRecord, UserRecord } from '../auth/auth.persistence';
import { UsersHttpController } from './users.http';
import { UsersImplementation } from './users.implementation';

@Module({
  imports: [AuthNestModule, TypeOrmModule.forFeature([UserRecord, ProfileRecord])],
  controllers: [UsersHttpController],
  providers: [{
    provide: UsersImplementation,
    inject: [DataSource],
    useFactory: (dataSource: DataSource) => new UsersImplementation(dataSource),
  }],
  exports: [UsersImplementation],
})
export class UsersNestModule {}
