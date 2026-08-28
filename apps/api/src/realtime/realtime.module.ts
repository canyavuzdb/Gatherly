import { Module } from '@nestjs/common';
import { AuthNestModule } from '../auth/auth.module';
import { RealtimeImplementation } from './realtime.implementation';
import { SocketIoAdapter } from './socketio.adapter';

@Module({
  imports: [AuthNestModule],
  providers: [SocketIoAdapter, RealtimeImplementation],
  exports: [RealtimeImplementation],
})
export class RealtimeNestModule {}
