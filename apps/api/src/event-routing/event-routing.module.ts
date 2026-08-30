import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OpenRouteServiceEventRoutingImplementation } from './event-routing.implementation';

@Module({
  providers: [{
    provide: OpenRouteServiceEventRoutingImplementation,
    inject: [ConfigService],
    useFactory: (config: ConfigService) => new OpenRouteServiceEventRoutingImplementation(config.get<string>('OPENROUTESERVICE_API_KEY')),
  }],
  exports: [OpenRouteServiceEventRoutingImplementation],
})
export class EventRoutingNestModule {}
