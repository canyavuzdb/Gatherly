export type CreateInvitation = { kind: 'CREATE_INVITATION'; invitationId: string; eventId: string; actorUserId: string; recipientUserId: string; expiresAt: Date };
export type RevokeInvitation = { kind: 'REVOKE_INVITATION'; invitationId: string; actorUserId: string };
export type ListMyPendingInvitations = { kind: 'LIST_MY_PENDING_INVITATIONS'; actorUserId: string };
export type InvitationCommand = CreateInvitation | RevokeInvitation | ListMyPendingInvitations;
export type InvitationView = { id: string; eventId: string; recipientUserId: string; status: 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED'; expiresAt: Date; version: number };
export interface InvitationsModule { decide(command: InvitationCommand): Promise<InvitationView | InvitationView[]>; }
