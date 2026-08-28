import { BadRequestException, Controller, Get, Headers, HttpCode, HttpStatus, NotFoundException, Param, Post, Query, UnauthorizedException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AuthBusinessError } from '../auth/auth.errors';
import { AuthImplementation } from '../auth/auth.implementation';
import { NotificationsBusinessError } from './notifications.errors';
import { NotificationsImplementation } from './notifications.implementation';

@ApiTags('Notifications')
@Controller('notifications')
export class NotificationsHttpController {
  constructor(private readonly auth: AuthImplementation, private readonly notifications: NotificationsImplementation) {}
  @Get() async list(@Headers('authorization') authorization: string | undefined, @Query('before') before?: string, @Query('limit') limit?: string) { return this.withActor(authorization, (actor) => this.notifications.list({ actor, before, limit: limit === undefined ? undefined : Number(limit) })); }
  @Post(':notificationId/read') @HttpCode(HttpStatus.OK) async markRead(@Headers('authorization') authorization: string | undefined, @Param('notificationId') notificationId: string) { return this.withActor(authorization, (actor) => this.notifications.decide({ kind: 'MARK_NOTIFICATION_READ', actor, notificationId })); }
  @Post('read-all') @HttpCode(HttpStatus.OK) async markAllRead(@Headers('authorization') authorization: string | undefined) { return this.withActor(authorization, (actor) => this.notifications.decide({ kind: 'MARK_ALL_NOTIFICATIONS_READ', actor })); }
  private async withActor<T>(authorization: string | undefined, operation: (actor: { userId: string; verification: 'UNVERIFIED' | 'VERIFIED' }) => Promise<T>) { const token = /^Bearer (.+)$/.exec(authorization ?? '')?.[1]; if (!token) throw new UnauthorizedException('ACCESS_TOKEN_INVALID'); try { return await operation(await this.auth.authenticate(token)); } catch (error) { if (error instanceof AuthBusinessError) throw new UnauthorizedException(error.code); if (error instanceof NotificationsBusinessError) { if (error.code === 'NOTIFICATION_NOT_FOUND_OR_NOT_OWNED') throw new NotFoundException(error.code); throw new BadRequestException(error.code); } throw error; } }
}
