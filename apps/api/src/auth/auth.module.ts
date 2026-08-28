import { forwardRef, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { MediaNestModule } from '../media/media.module';
import { MediaImplementation } from '../media/media.implementation';
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
    forwardRef(() => MediaNestModule),
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
      useFactory: (dataSource: DataSource, config: ConfigService, media: MediaImplementation) =>
        new AuthImplementation(dataSource, {
          jwtSecret: config.getOrThrow<string>('JWT_SECRET'),
          sendVerificationEmail: async () => undefined,
          sendPasswordResetEmail: async () => undefined,
          retireOwnedMedia: media.retireOwnedAssetsInTransaction.bind(media),
          removeRetiredMediaFiles: media.removeRetiredFiles.bind(media),
        }),
      inject: [DataSource, ConfigService, MediaImplementation],
    },
  ],
  exports: [AuthImplementation],
})
export class AuthNestModule {}
