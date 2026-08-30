import { BadRequestException, Controller, Get, Headers, Query, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { AuthBusinessError } from '../auth/auth.errors';
import { AuthImplementation } from '../auth/auth.implementation';
import { LocationSearchBusinessError, MapTilerLocationSearchImplementation } from './location-search.implementation';

class LocationSearchQuery {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  q!: string;

  @IsString()
  @MaxLength(80)
  city!: string;
}

@ApiTags('Location search')
@Controller('locations')
export class LocationSearchHttpController {
  constructor(
    private readonly auth: AuthImplementation,
    private readonly locations: MapTilerLocationSearchImplementation,
  ) {}

  @Get('search')
  async search(@Headers('authorization') authorization: string | undefined, @Query() query: LocationSearchQuery) {
    const accessToken = /^Bearer (.+)$/.exec(authorization ?? '')?.[1];
    if (!accessToken) throw new UnauthorizedException('ACCESS_TOKEN_INVALID');
    try {
      return await this.locations.search({ actor: await this.auth.authenticate(accessToken), query: query.q.trim(), city: query.city.trim() });
    } catch (error) {
      if (error instanceof AuthBusinessError) throw new UnauthorizedException(error.code);
      if (error instanceof LocationSearchBusinessError) throw new ServiceUnavailableException(error.code);
      if (error instanceof Error && error.message === 'INVALID_QUERY') throw new BadRequestException(error.message);
      throw error;
    }
  }
}
