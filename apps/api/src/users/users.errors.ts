export type UsersErrorCode =
  | 'ACTOR_NOT_ACTIVE'
  | 'INVALID_PROFILE_NAME'
  | 'BIO_TOO_LONG'
  | 'PROFILE_VERSION_CONFLICT';

export class UsersBusinessError extends Error {
  constructor(readonly code: UsersErrorCode) {
    super(code);
  }
}
