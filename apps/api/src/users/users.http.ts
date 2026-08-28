import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Headers,
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
