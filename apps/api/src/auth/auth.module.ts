import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AuthHttpController } from './auth.http';
import { AuthImplementation } from './auth.implementation';
import {
  EmailVerificationTokenRecord,
  PasswordResetTokenRecord,
  ProfileRecord,
  RefreshSessionRecord,
  UserRecord,
} from './auth.persistence';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      UserRecord,
      ProfileRecord,
      EmailVerificationTokenRecord,
      PasswordResetTokenRecord,
      RefreshSessionRecord,
    ]),
  ],
  controllers: [AuthHttpController],
  providers: [
    {
      provide: AuthImplementation,
      useFactory: (dataSource: DataSource, config: ConfigService) =>
        new AuthImplementation(dataSource, {
          jwtSecret: config.getOrThrow<string>('JWT_SECRET'),
          sendVerificationEmail: async () => undefined,
          sendPasswordResetEmail: async () => undefined,
        }),
      inject: [DataSource, ConfigService],
    },
  ],
  exports: [AuthImplementation],
})
export class AuthNestModule {}
