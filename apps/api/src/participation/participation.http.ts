import { BadRequestException, Body, Controller, ForbiddenException, Headers, HttpCode, HttpStatus, Param, Post, UnauthorizedException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { AuthBusinessError } from '../auth/auth.errors';
import { AuthImplementation } from '../auth/auth.implementation';
import { ParticipationBusinessError } from './participation.errors';
import { ParticipationImplementation } from './participation.implementation';

class PresenceRequest { @IsIn(['PRESENT', 'ABSENT', 'UNSET']) presence!: 'PRESENT' | 'ABSENT' | 'UNSET'; }

@ApiTags('Participation')
@Controller()
export class ParticipationHttpController {
  constructor(private readonly auth: AuthImplementation, private readonly participation: ParticipationImplementation) {}
  @Post('events/:eventId/attendances/:attendanceId/check-ins')
  @HttpCode(HttpStatus.CREATED)
  async checkIn(@Headers('authorization') authorization: string | undefined, @Param('eventId') eventId: string, @Param('attendanceId') attendanceId: string) {
    const accessToken = /^Bearer (.+)$/.exec(authorization ?? '')?.[1];
    if (!accessToken) throw new UnauthorizedException('ACCESS_TOKEN_INVALID');
    try { const actor = await this.auth.authenticate(accessToken); return await this.participation.decide({ kind: 'RECORD_CHECK_IN', eventId, attendanceId, actorUserId: actor.userId }); }
    catch (error) {
      if (error instanceof AuthBusinessError) throw new UnauthorizedException(error.code);
      if (error instanceof ParticipationBusinessError) {
        if (error.code === 'FORBIDDEN') throw new ForbiddenException(error.code);
        throw new BadRequestException(error.code);
      }
      throw error;
    }
  }

  @Post('events/:eventId/attendances/:attendanceId/check-ins/revoke')
  @HttpCode(HttpStatus.OK)
  async revokeCheckIn(@Headers('authorization') authorization: string | undefined, @Param('eventId') eventId: string, @Param('attendanceId') attendanceId: string) {
    const accessToken = /^Bearer (.+)$/.exec(authorization ?? '')?.[1];
    if (!accessToken) throw new UnauthorizedException('ACCESS_TOKEN_INVALID');
    try { const actor = await this.auth.authenticate(accessToken); return await this.participation.decide({ kind: 'REVOKE_CHECK_IN', eventId, attendanceId, actorUserId: actor.userId }); }
    catch (error) {
      if (error instanceof AuthBusinessError) throw new UnauthorizedException(error.code);
      if (error instanceof ParticipationBusinessError) { if (error.code === 'FORBIDDEN') throw new ForbiddenException(error.code); throw new BadRequestException(error.code); }
      throw error;
    }
  }

  @Post('events/:eventId/attendances/:attendanceId/presence')
  @HttpCode(HttpStatus.OK)
  async setPresence(@Headers('authorization') authorization: string | undefined, @Param('eventId') eventId: string, @Param('attendanceId') attendanceId: string, @Body() request: PresenceRequest) {
    const accessToken = /^Bearer (.+)$/.exec(authorization ?? '')?.[1];
    if (!accessToken) throw new UnauthorizedException('ACCESS_TOKEN_INVALID');
    try { const actor = await this.auth.authenticate(accessToken); return await this.participation.decide({ kind: 'SET_ATTENDANCE_PRESENCE', eventId, attendanceId, actorUserId: actor.userId, presence: request.presence }); }
    catch (error) {
      if (error instanceof AuthBusinessError) throw new UnauthorizedException(error.code);
      if (error instanceof ParticipationBusinessError) { if (error.code === 'FORBIDDEN') throw new ForbiddenException(error.code); throw new BadRequestException(error.code); }
      throw error;
    }
  }
}
