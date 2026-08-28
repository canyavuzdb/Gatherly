import { BadRequestException, Body, Controller, ForbiddenException, Get, Headers, HttpCode, HttpStatus, Param, Post, UnauthorizedException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsUUID } from 'class-validator';
import { AuthBusinessError } from '../auth/auth.errors';
import { AuthImplementation } from '../auth/auth.implementation';
import { InvitationsBusinessError } from './invitations.errors';
import { InvitationsImplementation } from './invitations.implementation';

class CreateInvitationRequest { @IsUUID() recipientUserId!: string; @Type(() => Date) @IsDate() expiresAt!: Date; }

@ApiTags('Invitations')
@Controller()
export class InvitationsHttpController {
  constructor(private readonly auth: AuthImplementation, private readonly invitations: InvitationsImplementation) {}
  @Post('events/:eventId/invitations')
  async create(@Headers('authorization') authorization: string | undefined, @Param('eventId') eventId: string, @Body() request: CreateInvitationRequest) {
    return this.withActor(authorization, (actorUserId) => this.invitations.decide({ kind: 'CREATE_INVITATION', invitationId: crypto.randomUUID(), eventId, actorUserId, recipientUserId: request.recipientUserId, expiresAt: request.expiresAt }));
  }
  @Post('invitations/:invitationId/revoke')
  @HttpCode(HttpStatus.OK)
  async revoke(@Headers('authorization') authorization: string | undefined, @Param('invitationId') invitationId: string) {
    return this.withActor(authorization, (actorUserId) => this.invitations.decide({ kind: 'REVOKE_INVITATION', invitationId, actorUserId }));
  }
  @Get('invitations/me')
  async listMine(@Headers('authorization') authorization: string | undefined) {
    return this.withActor(authorization, (actorUserId) => this.invitations.decide({ kind: 'LIST_MY_PENDING_INVITATIONS', actorUserId }));
  }
  private async withActor<T>(authorization: string | undefined, operation: (actorUserId: string) => Promise<T>): Promise<T> {
    const token = /^Bearer (.+)$/.exec(authorization ?? '')?.[1];
    if (!token) throw new UnauthorizedException('ACCESS_TOKEN_INVALID');
    try { return await operation((await this.auth.authenticate(token)).userId); }
    catch (error) { if (error instanceof AuthBusinessError) throw new UnauthorizedException(error.code); if (error instanceof InvitationsBusinessError) { if (error.code === 'FORBIDDEN' || error.code === 'ACTOR_NOT_ACTIVE') throw new ForbiddenException(error.code); throw new BadRequestException(error.code); } throw error; }
  }
}
