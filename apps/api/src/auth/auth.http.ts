import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  InternalServerErrorException,
  Post,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import type { Response } from 'express';
import { AuthBusinessError } from './auth.errors';
import { AuthImplementation } from './auth.implementation';
import type { AuthOutcome, SessionGrant } from './auth.interface';

class RegisterRequest {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(12)
  password!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  lastName!: string;
}

class SignInRequest {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(12)
  password!: string;
}

class VerifyEmailRequest {
  @IsString()
  @MinLength(1)
  verificationSecret!: string;
}

class RequestPasswordResetRequest {
  @IsEmail()
  email!: string;
}

class ResetPasswordRequest {
  @IsString()
  @MinLength(1)
  resetSecret!: string;

  @IsString()
  @MinLength(12)
  newPassword!: string;
}

class ChangePasswordRequest {
  @IsString()
  @MinLength(12)
  currentPassword!: string;

  @IsString()
  @MinLength(12)
  newPassword!: string;
}

@ApiTags('Auth')
@Controller('auth')
export class AuthHttpController {
  constructor(private readonly auth: AuthImplementation) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(
    @Body() request: RegisterRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    try {
      const outcome = asSessionGrant(
        await this.auth.decide({ kind: 'REGISTER', ...request }),
      );
      response.cookie('refresh_secret', outcome.refreshSecret, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV !== 'development',
        expires: outcome.refreshExpiresAt,
      });
      return {
        accessToken: outcome.accessToken,
        identity: outcome.identity,
      };
    } catch (error) {
      if (error instanceof AuthBusinessError) {
        if (error.code === 'EMAIL_ALREADY_REGISTERED') {
          throw new ConflictException(error.code);
        }
        throw new InternalServerErrorException(error.code);
      }
      throw error;
    }
  }

  @Post('sign-in')
  @HttpCode(HttpStatus.OK)
  async signIn(
    @Body() request: SignInRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    try {
      const outcome = asSessionGrant(
        await this.auth.decide({ kind: 'SIGN_IN', ...request }),
      );
      response.cookie('refresh_secret', outcome.refreshSecret, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV !== 'development',
        expires: outcome.refreshExpiresAt,
      });
      return {
        accessToken: outcome.accessToken,
        identity: outcome.identity,
      };
    } catch (error) {
      if (error instanceof AuthBusinessError) {
        if (error.code === 'INVALID_CREDENTIALS') {
          throw new UnauthorizedException(error.code);
        }
        throw new InternalServerErrorException(error.code);
      }
      throw error;
    }
  }

  @Post('sign-out')
  @HttpCode(HttpStatus.OK)
  async signOut(
    @Headers('cookie') cookieHeader: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    await this.auth.decide({
      kind: 'SIGN_OUT',
      refreshSecret: readCookie(cookieHeader, 'refresh_secret') ?? '',
    });
    response.clearCookie('refresh_secret', {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV !== 'development',
    });
    return { kind: 'SIGNED_OUT' };
  }

  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  async verifyEmail(@Body() request: VerifyEmailRequest) {
    try {
      const outcome = await this.auth.decide({
        kind: 'VERIFY_EMAIL',
        verificationSecret: request.verificationSecret,
      });
      if (outcome.kind !== 'EMAIL_VERIFIED') {
        throw new InternalServerErrorException('Expected email verification.');
      }
      return outcome;
    } catch (error) {
      if (
        error instanceof AuthBusinessError &&
        error.code === 'VERIFICATION_TOKEN_INVALID_OR_EXPIRED'
      ) {
        throw new BadRequestException(error.code);
      }
      throw error;
    }
  }

  @Post('resend-verification')
  @HttpCode(HttpStatus.ACCEPTED)
  async resendVerification(
    @Headers('authorization') authorization: string | undefined,
  ) {
    const accessToken = readBearerToken(authorization);
    if (!accessToken) {
      throw new UnauthorizedException('ACCESS_TOKEN_INVALID');
    }

    try {
      const actor = await this.auth.authenticate(accessToken);
      const outcome = await this.auth.decide({
        kind: 'RESEND_VERIFICATION',
        actorUserId: actor.userId,
      });
      if (outcome.kind !== 'REQUEST_ACCEPTED') {
        throw new InternalServerErrorException('Expected request acceptance.');
      }
      return outcome;
    } catch (error) {
      if (error instanceof AuthBusinessError) {
        if (error.code === 'ACCESS_TOKEN_INVALID') {
          throw new UnauthorizedException(error.code);
        }
        if (error.code === 'VERIFICATION_RESEND_TOO_SOON') {
          throw new HttpException(error.code, HttpStatus.TOO_MANY_REQUESTS);
        }
      }
      throw error;
    }
  }

  @Post('request-password-reset')
  @HttpCode(HttpStatus.ACCEPTED)
  async requestPasswordReset(@Body() request: RequestPasswordResetRequest) {
    const outcome = await this.auth.decide({
      kind: 'REQUEST_PASSWORD_RESET',
      email: request.email,
    });
    if (outcome.kind !== 'REQUEST_ACCEPTED') {
      throw new InternalServerErrorException('Expected request acceptance.');
    }
    return outcome;
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(
    @Body() request: ResetPasswordRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    try {
      const outcome = asSessionGrant(
        await this.auth.decide({
          kind: 'RESET_PASSWORD',
          resetSecret: request.resetSecret,
          newPassword: request.newPassword,
        }),
      );
      response.cookie('refresh_secret', outcome.refreshSecret, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV !== 'development',
        expires: outcome.refreshExpiresAt,
      });
      return { accessToken: outcome.accessToken, identity: outcome.identity };
    } catch (error) {
      if (
        error instanceof AuthBusinessError &&
        (error.code === 'PASSWORD_RESET_TOKEN_INVALID_OR_EXPIRED' ||
          error.code === 'PASSWORD_POLICY_VIOLATION')
      ) {
        throw new BadRequestException(error.code);
      }
      throw error;
    }
  }

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @Headers('authorization') authorization: string | undefined,
    @Body() request: ChangePasswordRequest,
  ) {
    const accessToken = readBearerToken(authorization);
    if (!accessToken) {
      throw new UnauthorizedException('ACCESS_TOKEN_INVALID');
    }

    try {
      const actor = await this.auth.authenticate(accessToken);
      const outcome = await this.auth.decide({
        kind: 'CHANGE_PASSWORD',
        actorUserId: actor.userId,
        ...request,
      });
      if (outcome.kind !== 'PASSWORD_CHANGED') {
        throw new InternalServerErrorException('Expected password change.');
      }
      return outcome;
    } catch (error) {
      if (error instanceof AuthBusinessError) {
        if (error.code === 'ACCESS_TOKEN_INVALID') {
          throw new UnauthorizedException(error.code);
        }
        if (
          error.code === 'CURRENT_PASSWORD_INCORRECT' ||
          error.code === 'PASSWORD_POLICY_VIOLATION'
        ) {
          throw new BadRequestException(error.code);
        }
      }
      throw error;
    }
  }
}

function asSessionGrant(outcome: AuthOutcome): SessionGrant {
  if (outcome.kind !== 'SESSION_GRANTED') {
    throw new InternalServerErrorException('Expected a session grant.');
  }
  return outcome;
}

function readCookie(header: string | undefined, name: string) {
  return header
    ?.split(';')
    .map((part) => part.trim().split('='))
    .find(([key]) => key === name)?.[1];
}

function readBearerToken(authorization: string | undefined) {
  const match = /^Bearer (.+)$/.exec(authorization ?? '');
  return match?.[1];
}
