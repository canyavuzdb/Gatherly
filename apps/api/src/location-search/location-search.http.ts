import { BadRequestException, Controller, Get, Headers, Query, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsLatitude, IsLongitude, IsString, MaxLength, MinLength } from 'class-validator';
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

class ReverseLocationQuery {
  @Type(() => Number)
  @IsLatitude()
  latitude!: number;

  @Type(() => Number)
  @IsLongitude()
  longitude!: number;
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

  @Get('reverse')
  async reverse(@Headers('authorization') authorization: string | undefined, @Query() query: ReverseLocationQuery) {
    const accessToken = /^Bearer (.+)$/.exec(authorization ?? '')?.[1];
    if (!accessToken) throw new UnauthorizedException('ACCESS_TOKEN_INVALID');
    try {
      return await this.locations.reverse({ actor: await this.auth.authenticate(accessToken), latitude: query.latitude, longitude: query.longitude });
    } catch (error) {
      if (error instanceof AuthBusinessError) throw new UnauthorizedException(error.code);
      if (error instanceof LocationSearchBusinessError) throw new ServiceUnavailableException(error.code);
      throw error;
    }
  }
}
