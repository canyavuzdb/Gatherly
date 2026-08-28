import { forwardRef, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AuthNestModule } from '../auth/auth.module';
import { UserRecord } from '../auth/auth.persistence';
import { MediaImplementation } from './media.implementation';
import { MediaHttpController } from './media.http';
import { MediaAssetRecord, EventMediaRecord } from './media.persistence';
import { LocalMediaStorage } from './media.storage';

@Module({
  imports: [forwardRef(() => AuthNestModule), TypeOrmModule.forFeature([UserRecord, MediaAssetRecord, EventMediaRecord])],
  providers: [{
    provide: MediaImplementation,
    inject: [DataSource],
    useFactory: (dataSource: DataSource) => new MediaImplementation(dataSource, new LocalMediaStorage(process.env.MEDIA_STORAGE_PATH ?? 'var/media')),
  }],
  controllers: [MediaHttpController],
  exports: [MediaImplementation],
})
export class MediaNestModule {}
