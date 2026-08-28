import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Headers,
  Get,
  NotFoundException,
  Param,
  HttpCode,
  HttpStatus,
  Patch,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { AuthBusinessError } from '../auth/auth.errors';
import { AuthImplementation } from '../auth/auth.implementation';
import { UsersBusinessError } from './users.errors';
import { UsersImplementation } from './users.implementation';
import type { ProfileVisibility } from './users.interface';

class ReviseMyProfileRequest {
  @IsInt()
  @Min(1)
  expectedVersion!: number;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  lastName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  bio!: string | null;

  @IsIn(['PUBLIC', 'EVENT_ATTENDEES', 'PRIVATE'])
  visibility!: ProfileVisibility;
}

@ApiTags('Users')
@Controller('users')
export class UsersHttpController {
  constructor(
    private readonly auth: AuthImplementation,
    private readonly users: UsersImplementation,
  ) {}

  @Get('me/profile')
  async openMyProfile(@Headers('authorization') authorization: string | undefined) {
    const accessToken = readBearerToken(authorization);
    if (!accessToken) throw new UnauthorizedException('ACCESS_TOKEN_INVALID');
    try {
      return await this.users.openMyProfile(await this.auth.authenticate(accessToken));
    } catch (error) {
      if (error instanceof AuthBusinessError) throw new UnauthorizedException(error.code);
      if (error instanceof UsersBusinessError) throw new NotFoundException(error.code);
      throw error;
    }
  }

  @Get(':userId/profile')
  async openProfile(@Headers('authorization') authorization: string | undefined, @Param('userId') userId: string) {
    const accessToken = readBearerToken(authorization);
    try {
      const viewer = accessToken ? await this.auth.authenticate(accessToken) : null;
      return await this.users.openProfile({ viewer, subjectUserId: userId });
    } catch (error) {
      if (error instanceof AuthBusinessError) throw new UnauthorizedException(error.code);
      if (error instanceof UsersBusinessError && error.code === 'PROFILE_NOT_FOUND_OR_NOT_VIEWABLE') throw new NotFoundException(error.code);
      throw error;
    }
  }

  @Get('me/event-creation-quota')
  async currentQuota(@Headers('authorization') authorization: string | undefined) {
    const accessToken = readBearerToken(authorization);
    if (!accessToken) throw new UnauthorizedException('ACCESS_TOKEN_INVALID');
    try { return await this.users.currentEventCreationQuota({ actor: await this.auth.authenticate(accessToken) }); }
    catch (error) { if (error instanceof AuthBusinessError) throw new UnauthorizedException(error.code); throw error; }
  }

  @Patch('me/profile')
  @HttpCode(HttpStatus.OK)
  async reviseMyProfile(
    @Headers('authorization') authorization: string | undefined,
    @Body() request: ReviseMyProfileRequest,
  ) {
    const accessToken = readBearerToken(authorization);
    if (!accessToken) {
      throw new UnauthorizedException('ACCESS_TOKEN_INVALID');
    }

    try {
      const actor = await this.auth.authenticate(accessToken);
      return await this.users.reviseMyProfile({ actor, ...request });
    } catch (error) {
      if (error instanceof AuthBusinessError) {
        throw new UnauthorizedException(error.code);
      }
      if (error instanceof UsersBusinessError) {
        if (error.code === 'PROFILE_VERSION_CONFLICT') {
          throw new ConflictException(error.code);
        }
        throw new BadRequestException(error.code);
      }
      throw error;
    }
  }
}

function readBearerToken(authorization: string | undefined) {
  return /^Bearer (.+)$/.exec(authorization ?? '')?.[1];
}
