import { forwardRef, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { MediaNestModule } from '../media/media.module';
import { MediaImplementation } from '../media/media.implementation';
import { AuthHttpController } from './auth.http';
import { AuthImplementation } from './auth.implementation';
import { SmtpAuthEmailDelivery } from './auth.smtp-email';
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
      useFactory: (dataSource: DataSource, config: ConfigService, media: MediaImplementation) => {
        const email = new SmtpAuthEmailDelivery({
          host: config.getOrThrow<string>('SMTP_HOST'),
          port: config.getOrThrow<number>('SMTP_PORT'),
          from: config.getOrThrow<string>('SMTP_FROM'),
          webOrigin: config.getOrThrow<string>('WEB_ORIGIN'),
        });
        return new AuthImplementation(dataSource, {
          jwtSecret: config.getOrThrow<string>('JWT_SECRET'),
          sendVerificationEmail: email.sendVerificationEmail.bind(email),
          sendPasswordResetEmail: email.sendPasswordResetEmail.bind(email),
          retireOwnedMedia: media.retireOwnedAssetsInTransaction.bind(media),
          removeRetiredMediaFiles: media.removeRetiredFiles.bind(media),
        });
      },
      inject: [DataSource, ConfigService, MediaImplementation],
    },
  ],
  exports: [AuthImplementation],
})
export class AuthNestModule {}
