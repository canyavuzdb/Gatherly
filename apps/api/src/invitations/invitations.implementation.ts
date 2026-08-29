import { DataSource, In } from 'typeorm';
import { UserRecord } from '../auth/auth.persistence';
import { EventRecord, InvitationRecord } from '../events/events.persistence';
import { InvitationsBusinessError } from './invitations.errors';
import { MessagingImplementation } from '../messaging/messaging.implementation';
import type { RealtimeModule } from '../realtime/realtime.interface';
import type { CreateInvitation, InvitationCommand, InvitationView, InvitationsModule, ListEventInvitations, ListMyPendingInvitations, RevokeInvitation } from './invitations.interface';

export class InvitationsImplementation implements InvitationsModule {
  constructor(private readonly dataSource: DataSource, private readonly messaging?: MessagingImplementation, private readonly now = () => new Date(), private readonly realtime?: RealtimeModule) {}
  async decide(command: InvitationCommand): Promise<InvitationView | InvitationView[]> {
    if (command.kind === 'CREATE_INVITATION') return this.create(command);
    if (command.kind === 'REVOKE_INVITATION') return this.revoke(command);
    if (command.kind === 'LIST_EVENT_INVITATIONS') return this.listEvent(command);
    return this.listPending(command);
  }
  private async listEvent(command: ListEventInvitations): Promise<InvitationView[]> {
    const event = await this.dataSource.getRepository(EventRecord).findOneBy({ id: command.eventId, organizerId: command.actorUserId });
    if (!event) throw new InvitationsBusinessError('FORBIDDEN');
    const invitations = await this.dataSource.getRepository(InvitationRecord).find({ where: { eventId: event.id }, order: { expiresAt: 'ASC', id: 'ASC' } });
    return invitations.map((invitation) => this.view(invitation, event));
  }
  private async create(command: CreateInvitation): Promise<InvitationView> {
    const result = await this.dataSource.transaction(async (manager) => {
      const event = await manager.findOne(EventRecord, { where: { id: command.eventId }, lock: { mode: 'pessimistic_write' } });
      if (!event || event.status !== 'PUBLISHED' || event.startsAt <= this.now() || event.organizerId !== command.actorUserId) throw new InvitationsBusinessError(!event || event.status !== 'PUBLISHED' || event.startsAt <= this.now() ? 'EVENT_NOT_JOINABLE' : 'FORBIDDEN');
      const [actor, recipient] = await Promise.all([manager.findOneBy(UserRecord, { id: command.actorUserId }), manager.findOneBy(UserRecord, { id: command.recipientUserId })]);
      if (!actor || actor.status !== 'ACTIVE' || !actor.emailVerifiedAt || !recipient || recipient.status !== 'ACTIVE' || !recipient.emailVerifiedAt) throw new InvitationsBusinessError('ACTOR_NOT_ACTIVE');
      if (recipient.id === event.organizerId || command.expiresAt <= this.now()) throw new InvitationsBusinessError('INVALID_INVITATION');
      const existing = await manager.findOne(InvitationRecord, { where: { eventId: event.id, recipientUserId: recipient.id }, lock: { mode: 'pessimistic_write' } });
      if (existing?.status === 'ACCEPTED') throw new InvitationsBusinessError('INVALID_INVITATION');
      const invitation = existing
        ? await manager.save(Object.assign(existing, { status: 'PENDING', expiresAt: command.expiresAt, acceptedAt: null, revokedAt: null, invitedByUserId: actor.id, updatedByUserId: actor.id, updatedByKind: 'USER', version: existing.version + 1 }))
        : await manager.save(manager.create(InvitationRecord, { id: command.invitationId, eventId: event.id, recipientUserId: recipient.id, invitedByUserId: actor.id, status: 'PENDING', expiresAt: command.expiresAt, acceptedAt: null, revokedAt: null, updatedByUserId: actor.id, updatedByKind: 'USER', version: 1 }));
      return this.view(invitation, event);
    });
    await this.messaging?.publish([{ messageId: `invitation:${result.id}:${result.version}`, eventName: 'invitation.received.v1', eventVersion: 1, occurredAt: this.now(), correlationId: result.id, payload: { recipientUserId: result.recipientUserId, eventId: result.eventId, title: 'New invitation', body: 'You have been invited to an event.' } }]);
    await this.realtime?.emit({ kind: 'USER_EVENT_CHANGED', recipientUserId: result.recipientUserId, eventId: result.eventId, change: 'INVITATION' });
    return result;
  }
  private async revoke(command: RevokeInvitation): Promise<InvitationView> {
    const result = await this.dataSource.transaction(async (manager) => {
      const found = await manager.findOneBy(InvitationRecord, { id: command.invitationId });
      if (!found) throw new InvitationsBusinessError('INVITATION_NOT_FOUND');
      const event = await manager.findOne(EventRecord, { where: { id: found.eventId }, lock: { mode: 'pessimistic_write' } });
      const invitation = await manager.findOne(InvitationRecord, { where: { id: found.id }, lock: { mode: 'pessimistic_write' } });
      if (!event || !invitation) throw new InvitationsBusinessError('INVITATION_NOT_FOUND');
      if (event.organizerId !== command.actorUserId) throw new InvitationsBusinessError('FORBIDDEN');
      if (invitation.status === 'REVOKED') return this.view(invitation, event);
      if (invitation.status !== 'PENDING') throw new InvitationsBusinessError('INVITATION_NOT_REVOCABLE');
      invitation.status = 'REVOKED'; invitation.revokedAt = this.now(); invitation.updatedByUserId = command.actorUserId; invitation.updatedByKind = 'USER'; invitation.version += 1;
      return this.view(await manager.save(invitation), event);
    });
    await this.messaging?.publish([{ messageId: `invitation:${result.id}:${result.version}`, eventName: 'invitation.revoked.v1', eventVersion: 1, occurredAt: this.now(), correlationId: result.id, payload: { recipientUserId: result.recipientUserId, eventId: result.eventId, title: 'Invitation revoked', body: 'An event invitation was revoked.' } }]);
    await this.realtime?.emit({ kind: 'USER_EVENT_CHANGED', recipientUserId: result.recipientUserId, eventId: result.eventId, change: 'INVITATION' });
    return result;
  }
  private async listPending(command: ListMyPendingInvitations): Promise<InvitationView[]> {
    const user = await this.dataSource.getRepository(UserRecord).findOneBy({ id: command.actorUserId });
    if (!user || user.status !== 'ACTIVE' || !user.emailVerifiedAt) throw new InvitationsBusinessError('ACTOR_NOT_ACTIVE');
    const pending = (await this.dataSource.getRepository(InvitationRecord).find({ where: { recipientUserId: user.id, status: 'PENDING' }, order: { expiresAt: 'ASC', id: 'ASC' } })).filter((invitation) => invitation.expiresAt > this.now());
    const events = pending.length ? await this.dataSource.getRepository(EventRecord).findBy({ id: In(pending.map((invitation) => invitation.eventId)) }) : [];
    const eventsById = new Map(events.map((event) => [event.id, event]));
    return pending.map((invitation) => this.view(invitation, eventsById.get(invitation.eventId)));
  }
  private view(invitation: InvitationRecord, event?: EventRecord): InvitationView { return { id: invitation.id, eventId: invitation.eventId, recipientUserId: invitation.recipientUserId, status: invitation.status, expiresAt: invitation.expiresAt, version: invitation.version, ...(event ? { event: { title: event.title, startsAt: event.startsAt } } : {}) }; }
}
