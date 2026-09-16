import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthNestModule } from '../auth/auth.module';
import { EventRoutingHttpController } from './event-routing.http';
import { OpenRouteServiceEventRoutingImplementation } from './event-routing.implementation';

@Module({
  imports: [AuthNestModule],
  controllers: [EventRoutingHttpController],
  providers: [{
    provide: OpenRouteServiceEventRoutingImplementation,
    inject: [ConfigService],
    useFactory: (config: ConfigService) => new OpenRouteServiceEventRoutingImplementation(config.get<string>('OPENROUTESERVICE_API_KEY')),
  }],
  exports: [OpenRouteServiceEventRoutingImplementation],
})
export class EventRoutingNestModule {}
