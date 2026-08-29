import {
  BadRequestException,
  Controller,
  Get,
  Headers,
  NotFoundException,
  Param,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { AuthBusinessError } from '../auth/auth.errors';
import { AuthImplementation } from '../auth/auth.implementation';
import { EventDiscoveryBusinessError } from './event-discovery.errors';
import { EventDiscoveryImplementation } from './event-discovery.implementation';

class DiscoveryQuery {
  @IsString()
  city!: string;

  @IsOptional()
  @IsString()
  district?: string;

  @IsOptional()
  @IsString()
  scope?: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  startsAtFrom?: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  startsAtBefore?: Date;

  @IsOptional()
  @IsString()
  after?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;
}

@ApiTags('Event discovery')
@Controller('events')
export class EventDiscoveryHttpController {
  constructor(
    private readonly auth: AuthImplementation,
    private readonly discovery: EventDiscoveryImplementation,
  ) {}

  @Get()
  async discover(
    @Headers('authorization') authorization: string | undefined,
    @Query() query: DiscoveryQuery,
  ) {
    const viewer = await this.optionalViewer(authorization);
    try {
      return await this.discovery.discover({ viewer, ...query, scope: query.scope === undefined || query.scope === 'UPCOMING' || query.scope === 'PAST' ? query.scope : (() => { throw new EventDiscoveryBusinessError('INVALID_DISCOVERY_FILTER'); })() });
    } catch (error) {
      if (error instanceof EventDiscoveryBusinessError) throw new BadRequestException(error.code);
      throw error;
    }
  }

  // This static path must precede :eventId so it is not consumed as an event id.
  @Get('calendar/me')
  async calendar(
    @Headers('authorization') authorization: string | undefined,
    @Query('after') after?: string,
    @Query('limit') limit?: string,
    @Query('scope') scope?: string,
  ) {
    const accessToken = readBearerToken(authorization);
    if (!accessToken) throw new UnauthorizedException('ACCESS_TOKEN_INVALID');
    try {
      return await this.discovery.personalCalendar({
        actor: await this.auth.authenticate(accessToken),
        scope: scope === undefined || scope === 'UPCOMING' || scope === 'PAST' ? scope : (() => { throw new EventDiscoveryBusinessError('INVALID_DISCOVERY_FILTER'); })(),
        after,
        limit: limit === undefined ? undefined : Number(limit),
      });
    } catch (error) {
      if (error instanceof AuthBusinessError) throw new UnauthorizedException(error.code);
      if (error instanceof EventDiscoveryBusinessError) throw new BadRequestException(error.code);
      throw error;
    }
  }

  @Get(':eventId')
  async open(
    @Headers('authorization') authorization: string | undefined,
    @Param('eventId') eventId: string,
    @Query('shareToken') shareToken?: string,
  ) {
    const viewer = await this.optionalViewer(authorization);
    try {
      return await this.discovery.open({ viewer, eventId, shareToken });
    } catch (error) {
      if (error instanceof EventDiscoveryBusinessError) {
        if (error.code === 'EVENT_NOT_FOUND_OR_NOT_VIEWABLE') throw new NotFoundException(error.code);
        throw new BadRequestException(error.code);
      }
      throw error;
    }
  }

  private async optionalViewer(authorization: string | undefined) {
    const accessToken = readBearerToken(authorization);
    if (!accessToken) return null;
    try {
      return await this.auth.authenticate(accessToken);
    } catch (error) {
      if (error instanceof AuthBusinessError) throw new UnauthorizedException(error.code);
      throw error;
    }
  }
}

function readBearerToken(authorization: string | undefined) {
  return /^Bearer (.+)$/.exec(authorization ?? '')?.[1];
}
