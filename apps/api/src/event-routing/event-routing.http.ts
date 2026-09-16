import { BadRequestException, Body, Controller, Headers, HttpCode, Post, UnauthorizedException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsIn, IsLatitude, IsLongitude } from 'class-validator';
import { AuthBusinessError } from '../auth/auth.errors';
import { AuthImplementation } from '../auth/auth.implementation';
import { OpenRouteServiceEventRoutingImplementation } from './event-routing.implementation';

class RoutePreviewRequest {
  @IsIn(['WALKING', 'CYCLING', 'DRIVING'])
  mode!: 'WALKING' | 'CYCLING' | 'DRIVING';

  @IsLatitude()
  startLatitude!: number;

  @IsLongitude()
  startLongitude!: number;

  @IsLatitude()
  endLatitude!: number;

  @IsLongitude()
  endLongitude!: number;
}

@ApiTags('Event routing')
@Controller('event-routes')
export class EventRoutingHttpController {
  constructor(private readonly auth: AuthImplementation, private readonly routing: OpenRouteServiceEventRoutingImplementation) {}

  @Post('preview')
  @HttpCode(200)
  async preview(@Headers('authorization') authorization: string | undefined, @Body() body: RoutePreviewRequest) {
    const accessToken = /^Bearer (.+)$/.exec(authorization ?? '')?.[1];
    if (!accessToken) throw new UnauthorizedException('ACCESS_TOKEN_INVALID');
    try {
      await this.auth.authenticate(accessToken);
      const route = await this.routing.resolve({
        mode: body.mode,
        start: { latitude: body.startLatitude, longitude: body.startLongitude },
        end: { latitude: body.endLatitude, longitude: body.endLongitude },
      });
      if (!route) throw new BadRequestException('ROUTE_UNAVAILABLE');
      return route;
    } catch (error) {
      if (error instanceof AuthBusinessError) throw new UnauthorizedException(error.code);
      throw error;
    }
  }
}
