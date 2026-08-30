import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthNestModule } from '../auth/auth.module';
import { LocationSearchHttpController } from './location-search.http';
import { MapTilerLocationSearchImplementation } from './location-search.implementation';

@Module({
  imports: [AuthNestModule],
  controllers: [LocationSearchHttpController],
  providers: [{
    provide: MapTilerLocationSearchImplementation,
    inject: [ConfigService],
    useFactory: (config: ConfigService) => new MapTilerLocationSearchImplementation(config.get<string>('MAPTILER_API_KEY')),
  }],
})
export class LocationSearchNestModule {}
