import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDate,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { AuthBusinessError } from '../auth/auth.errors';
import { AuthImplementation } from '../auth/auth.implementation';
import { EventsBusinessError } from './events.errors';
import { EventsImplementation } from './events.implementation';
import type { EventLocationInput } from './events.interface';

class EventLocationRequest implements EventLocationInput {
  @IsString()
  @MaxLength(100)
  city!: string;

  @IsString()
  @MaxLength(100)
  district!: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  venueName!: string | null;

  @IsOptional()
  @IsString()
  address!: string | null;

  @IsIn(['EVENT_VIEWERS', 'CONFIRMED_ATTENDEES'])
  addressVisibility!: 'EVENT_VIEWERS' | 'CONFIRMED_ATTENDEES';
}

class CreateDraftRequest {
  @IsUUID()
  categoryId!: string;

  @IsString()
  @MaxLength(160)
  title!: string;

  @IsString()
  description!: string;

  @Type(() => Date)
  @IsDate()
  startsAt!: Date;

  @Type(() => Date)
  @IsDate()
  endsAt!: Date;

  @IsString()
  @MaxLength(64)
  timezone!: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  capacity!: number | null;

  @IsIn(['PUBLIC', 'UNLISTED', 'PRIVATE'])
  visibility!: 'PUBLIC' | 'UNLISTED' | 'PRIVATE';

  @IsIn(['OPEN', 'APPROVAL_REQUIRED', 'INVITE_ONLY'])
  joinPolicy!: 'OPEN' | 'APPROVAL_REQUIRED' | 'INVITE_ONLY';

  @ValidateNested()
  @Type(() => EventLocationRequest)
  location!: EventLocationRequest;
}

class VersionedRequest {
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

class ReviseEventRequest extends CreateDraftRequest {
  @IsInt()
  @Min(1)
  expectedVersion!: number;
}

@ApiTags('Events')
@Controller('events')
export class EventsHttpController {
  constructor(
    private readonly auth: AuthImplementation,
    private readonly events: EventsImplementation,
  ) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createDraft(
    @Headers('authorization') authorization: string | undefined,
    @Body() request: CreateDraftRequest,
  ) {
    const accessToken = readBearerToken(authorization);
    if (!accessToken) throw new UnauthorizedException('ACCESS_TOKEN_INVALID');

    try {
      const actor = await this.auth.authenticate(accessToken);
      return await this.events.decide({
        kind: 'CREATE_DRAFT',
        eventId: randomUUID(),
        actorUserId: actor.userId,
        definition: request,
      });
    } catch (error) {
      if (error instanceof AuthBusinessError) {
        throw new UnauthorizedException(error.code);
      }
      if (error instanceof EventsBusinessError) {
        if (error.code === 'ACTOR_NOT_ACTIVE' || error.code === 'ACTOR_NOT_VERIFIED') {
          throw new ForbiddenException(error.code);
        }
        throw new BadRequestException(error.code);
      }
      throw error;
    }
  }

  @Post(':eventId/revise')
  async revise(
    @Headers('authorization') authorization: string | undefined,
    @Param('eventId') eventId: string,
    @Body() request: ReviseEventRequest,
  ) {
    return this.withActor(authorization, (actorUserId) => this.events.decide({
      kind: 'REVISE_EVENT', eventId, actorUserId, expectedVersion: request.expectedVersion, definition: request,
    }));
  }

  @Post(':eventId/publish')
  @HttpCode(HttpStatus.OK)
  async publish(
    @Headers('authorization') authorization: string | undefined,
    @Param('eventId') eventId: string,
    @Body() request: VersionedRequest,
  ) {
    return this.withActor(authorization, (actorUserId) => this.events.decide({
      kind: 'PUBLISH_EVENT', eventId, actorUserId, expectedVersion: request.expectedVersion,
    }));
  }

  @Post(':eventId/cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(
    @Headers('authorization') authorization: string | undefined,
    @Param('eventId') eventId: string,
    @Body() request: VersionedRequest,
  ) {
    return this.withActor(authorization, (actorUserId) => this.events.decide({
      kind: 'CANCEL_EVENT', eventId, actorUserId, expectedVersion: request.expectedVersion,
    }));
  }

  private async withActor<T>(authorization: string | undefined, operation: (actorUserId: string) => Promise<T>): Promise<T> {
    const accessToken = readBearerToken(authorization);
    if (!accessToken) throw new UnauthorizedException('ACCESS_TOKEN_INVALID');
    try {
      return await operation((await this.auth.authenticate(accessToken)).userId);
    } catch (error) {
      if (error instanceof AuthBusinessError) throw new UnauthorizedException(error.code);
      if (error instanceof EventsBusinessError) {
        if (error.code === 'ACTOR_NOT_ACTIVE' || error.code === 'ACTOR_NOT_VERIFIED' || error.code === 'NOT_ORGANIZER') throw new ForbiddenException(error.code);
        throw new BadRequestException(error.code);
      }
      throw error;
    }
  }
}

function readBearerToken(authorization: string | undefined) {
  return /^Bearer (.+)$/.exec(authorization ?? '')?.[1];
}
