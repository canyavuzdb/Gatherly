import { BadRequestException, Controller, Get, Headers, Param, Query, UnauthorizedException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import { AuthBusinessError } from '../auth/auth.errors';
import { AuthImplementation } from '../auth/auth.implementation';
import { EventDiscoveryBusinessError } from './event-discovery.errors';
import { EventDiscoveryImplementation } from './event-discovery.implementation';
class DiscoveryQuery { @IsString() city!: string; @IsOptional() @IsString() district?: string; @IsOptional() @IsUUID() categoryId?: string; @IsOptional() @Type(() => Date) @IsDate() startsAtFrom?: Date; @IsOptional() @Type(() => Date) @IsDate() startsAtBefore?: Date; @IsOptional() @IsString() after?: string; @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit?: number; }
@ApiTags('Event discovery')
@Controller('events')
export class EventDiscoveryHttpController {
  constructor(private readonly auth: AuthImplementation, private readonly discovery: EventDiscoveryImplementation) {}
  @Get()
  async discover(@Headers('authorization') authorization: string | undefined, @Query() query: DiscoveryQuery) {
    const token = /^Bearer (.+)$/.exec(authorization ?? '')?.[1];
    let viewer = null;
    if (token) { try { viewer = await this.auth.authenticate(token); } catch (error) { if (error instanceof AuthBusinessError) throw new UnauthorizedException(error.code); throw error; } }
    try { return await this.discovery.discover({ viewer, ...query }); }
    catch (error) { if (error instanceof EventDiscoveryBusinessError) throw new BadRequestException(error.code); throw error; }
  }
  @Get(':eventId')
  async open(@Headers('authorization') authorization: string | undefined, @Param('eventId') eventId: string, @Query('shareToken') shareToken?: string) {
    const token = /^Bearer (.+)$/.exec(authorization ?? '')?.[1]; let viewer = null;
    if (token) { try { viewer = await this.auth.authenticate(token); } catch (error) { if (error instanceof AuthBusinessError) throw new UnauthorizedException(error.code); throw error; } }
    try { return await this.discovery.open({ viewer, eventId, shareToken }); } catch (error) { if (error instanceof EventDiscoveryBusinessError) throw new BadRequestException(error.code); throw error; }
  }
  @Get('/calendar/me')
  async calendar(@Headers('authorization') authorization: string | undefined, @Query('after') after?: string, @Query('limit') limit?: string) {
    const token = /^Bearer (.+)$/.exec(authorization ?? '')?.[1]; if (!token) throw new UnauthorizedException('ACCESS_TOKEN_INVALID');
    try { return await this.discovery.personalCalendar({ actor: await this.auth.authenticate(token), after, limit: limit === undefined ? undefined : Number(limit) }); }
    catch (error) { if (error instanceof AuthBusinessError) throw new UnauthorizedException(error.code); if (error instanceof EventDiscoveryBusinessError) throw new BadRequestException(error.code); throw error; }
  }
}
