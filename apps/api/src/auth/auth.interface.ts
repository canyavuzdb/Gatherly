export type UserId = string;

export type UserIdentity = {
  userId: UserId;
  verification: 'UNVERIFIED' | 'VERIFIED';
};

export type Register = {
  kind: 'REGISTER';
  email: string;
  password: string;
  firstName: string;
  lastName: string;
};

export type SignIn = {
  kind: 'SIGN_IN';
  email: string;
  password: string;
};

export type RefreshSession = {
  kind: 'REFRESH_SESSION';
  refreshSecret: string;
};

export type SignOut = {
  kind: 'SIGN_OUT';
  refreshSecret: string;
};

export type VerifyEmail = {
  kind: 'VERIFY_EMAIL';
  verificationSecret: string;
};

export type ResendVerification = {
  kind: 'RESEND_VERIFICATION';
  actorUserId: UserId;
};

export type RequestPasswordReset = {
  kind: 'REQUEST_PASSWORD_RESET';
  email: string;
};

export type ResetPassword = {
  kind: 'RESET_PASSWORD';
  resetSecret: string;
  newPassword: string;
};

export type ChangePassword = {
  kind: 'CHANGE_PASSWORD';
  actorUserId: UserId;
  currentPassword: string;
  newPassword: string;
};
export type SelfDelete = { kind: 'SELF_DELETE'; actorUserId: UserId; currentPassword: string };

export type AuthCommand =
  | Register
  | SignIn
  | RefreshSession
  | SignOut
  | VerifyEmail
  | ResendVerification
  | RequestPasswordReset
  | ResetPassword
  | ChangePassword
  | SelfDelete;

export type SessionGrant = {
  kind: 'SESSION_GRANTED';
  accessToken: string;
  refreshSecret: string;
  refreshExpiresAt: Date;
  identity: UserIdentity;
};

export type AuthOutcome =
  | SessionGrant
  | { kind: 'SIGNED_OUT' }
  | { kind: 'EMAIL_VERIFIED'; identity: UserIdentity }
  | { kind: 'REQUEST_ACCEPTED' }
  | { kind: 'PASSWORD_CHANGED' }
  | { kind: 'SELF_DELETED' };

export interface AuthModule {
  decide(command: AuthCommand): Promise<AuthOutcome>;
  authenticate(accessToken: string): Promise<UserIdentity>;
}
