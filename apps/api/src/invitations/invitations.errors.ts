export class InvitationsBusinessError extends Error {
  constructor(readonly code: 'ACTOR_NOT_ACTIVE' | 'FORBIDDEN' | 'EVENT_NOT_JOINABLE' | 'INVITATION_NOT_FOUND' | 'INVITATION_NOT_REVOCABLE' | 'INVALID_INVITATION') { super(code); }
}
