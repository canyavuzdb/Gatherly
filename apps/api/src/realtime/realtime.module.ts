import { Module } from '@nestjs/common';
import { AuthNestModule } from '../auth/auth.module';
import { RealtimeImplementation } from './realtime.implementation';
import { SocketIoAdapter } from './socketio.adapter';

@Module({
  imports: [AuthNestModule],
  providers: [
    SocketIoAdapter,
    {
      provide: RealtimeImplementation,
      inject: [SocketIoAdapter],
      useFactory: (socket: SocketIoAdapter) => new RealtimeImplementation(socket),
    },
  ],
  exports: [RealtimeImplementation],
})
export class RealtimeNestModule {}
