import { BadRequestException, Body, Controller, ForbiddenException, Headers, HttpCode, HttpStatus, Param, Post, UnauthorizedException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { AuthBusinessError } from '../auth/auth.errors';
import { AuthImplementation } from '../auth/auth.implementation';
import { AttendanceBusinessError } from './attendance.errors';
import { AttendanceImplementation } from './attendance.implementation';

class RequestAttendanceRequest { @IsBoolean() waitlistOptIn!: boolean; }
class DecisionRequest { @IsIn(['CONFIRM', 'REJECT']) decision!: 'CONFIRM' | 'REJECT'; @IsOptional() @IsString() @MaxLength(500) rejectionReason?: string; }
class AcceptInvitationRequest { @IsIn(['REJECT', 'JOIN_WAITLIST']) ifFull!: 'REJECT' | 'JOIN_WAITLIST'; }

@ApiTags('Attendance')
@Controller()
export class AttendanceHttpController {
  constructor(private readonly auth: AuthImplementation, private readonly attendance: AttendanceImplementation) {}

  @Post('events/:eventId/rsvp')
  async request(@Headers('authorization') authorization: string | undefined, @Param('eventId') eventId: string, @Body() request: RequestAttendanceRequest) {
    return this.withActor(authorization, (actorUserId) => this.attendance.decide({ kind: 'REQUEST_ATTENDANCE', eventId, actorUserId, waitlistOptIn: request.waitlistOptIn }));
  }

  @Post('events/:eventId/waitlist')
  async enrollWaitlist(@Headers('authorization') authorization: string | undefined, @Param('eventId') eventId: string) {
    return this.withActor(authorization, (actorUserId) => this.attendance.decide({ kind: 'ENROLL_WAITLIST', eventId, actorUserId }));
  }

  @Post('events/:eventId/attendance/cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(@Headers('authorization') authorization: string | undefined, @Param('eventId') eventId: string) {
    return this.withActor(authorization, (actorUserId) => this.attendance.decide({ kind: 'CANCEL_ATTENDANCE', eventId, actorUserId }));
  }

  @Post('events/:eventId/attendances/:attendanceId/decision')
  async decide(@Headers('authorization') authorization: string | undefined, @Param('eventId') eventId: string, @Param('attendanceId') attendanceId: string, @Body() request: DecisionRequest) {
    return this.withActor(authorization, (actorUserId) => this.attendance.decide({ kind: 'DECIDE_ATTENDANCE', eventId, attendanceId, actorUserId, decision: request.decision, rejectionReason: request.rejectionReason }));
  }

  @Post('invitations/:invitationId/accept')
  async acceptInvitation(@Headers('authorization') authorization: string | undefined, @Param('invitationId') invitationId: string, @Body() request: AcceptInvitationRequest) {
    return this.withActor(authorization, (actorUserId) => this.attendance.decide({ kind: 'ACCEPT_INVITATION', invitationId, actorUserId, ifFull: request.ifFull }));
  }

  private async withActor<T>(authorization: string | undefined, operation: (actorUserId: string) => Promise<T>): Promise<T> {
    const accessToken = /^Bearer (.+)$/.exec(authorization ?? '')?.[1];
    if (!accessToken) throw new UnauthorizedException('ACCESS_TOKEN_INVALID');
    try { return await operation((await this.auth.authenticate(accessToken)).userId); }
    catch (error) {
      if (error instanceof AuthBusinessError) throw new UnauthorizedException(error.code);
      if (error instanceof AttendanceBusinessError) {
        if (error.code === 'FORBIDDEN' || error.code === 'ACTOR_NOT_ACTIVE') throw new ForbiddenException(error.code);
        throw new BadRequestException(error.code);
      }
      throw error;
    }
  }
}
