# Auth design

This document applies the [application architecture](../architecture/application.md) pattern to User identity, verification, credentials, sessions, and self-deletion.

## 1. Purpose and ownership

The `auth` module owns User registration, credentials, email verification, password reset, access-token validation, Refresh Session lifecycle, and self-deletion. It is the only module that handles passwords, emailed secrets, JWT signing, or refresh secrets.

`events`, `attendance`, and `media` own their own business authorization. They receive a `UserIdentity` from `auth` and enforce the Verified User rule where their command requires it. The HTTP adapter owns HTTP status mapping and writes or clears the refresh cookie; it never chooses a session outcome or reconstructs an identity rule.

PostgreSQL is authoritative for User status, verification, token consumption, and session revocation. Mailpit receives local email only after a committed transaction.

## 2. External interface

The module has two external entry points. A discriminated command keeps the identity life cycle behind one interface; `authenticate` gives every protected caller a current User identity.

```ts
export interface AuthModule {
  decide(command: AuthCommand): Promise<AuthOutcome>;
  authenticate(accessToken: string): Promise<UserIdentity>;
}

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
  | DeleteSelf;

export type UserIdentity = {
  userId: UserId;
  verification: 'UNVERIFIED' | 'VERIFIED';
};
```

`authenticate` validates the JWT and reads the current User state. It rejects an access token belonging to a `SUSPENDED` or `DELETED` User even if its fifteen-minute JWT expiry has not yet passed. A module that needs a Verified User checks `identity.verification`; it does not receive an email, password, session, or ORM entity.

```ts
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

export type DeleteSelf = {
  kind: 'DELETE_SELF';
  actorUserId: UserId;
  currentPassword: string;
};

export type SessionGrant = {
  kind: 'SESSION_GRANTED';
  accessToken: string;
  refreshSecret: string;
  refreshExpiresAt: Instant;
  identity: UserIdentity;
};

export type AuthOutcome =
  | SessionGrant
  | { kind: 'EMAIL_VERIFIED'; identity: UserIdentity }
  | { kind: 'REQUEST_ACCEPTED' }
  | { kind: 'SIGNED_OUT' }
  | { kind: 'PASSWORD_CHANGED' }
  | { kind: 'SELF_DELETED' };
```

`REQUEST_ACCEPTED` intentionally says nothing about account or token existence. The adapter sees `refreshSecret` only in `SESSION_GRANTED`, writes it as an `HttpOnly`, `SameSite=Lax` cookie, and enables `Secure` outside local HTTP development. The access token is returned to the browser; the refresh secret is never returned in a JSON body.

## 3. Command semantics

| Command | Who may call it | Committed result |
| --- | --- | --- |
| `REGISTER` | anonymous caller | creates User, Profile, initial session, and verification token; returns `SESSION_GRANTED`. |
| `SIGN_IN` | anonymous caller | validates an active User's credentials and returns a new session. |
| `REFRESH_SESSION` | holder of refresh cookie | rotates the presented session and returns its replacement. |
| `SIGN_OUT` | holder of refresh cookie | revokes the presented session; duplicate or missing cookies are harmless. |
| `VERIFY_EMAIL` | holder of verification link | consumes a valid token and makes its User a Verified User. |
| `RESEND_VERIFICATION` | active unverified User | creates a replacement verification token subject to its cooldown. |
| `REQUEST_PASSWORD_RESET` | anonymous caller | records a reset token if an eligible User exists; always returns `REQUEST_ACCEPTED`. |
| `RESET_PASSWORD` | holder of reset link | consumes token, changes password, revokes existing sessions, and creates one replacement session. |
| `CHANGE_PASSWORD` | active User | requires current password, changes it, and revokes all sessions. |
| `DELETE_SELF` | active User | requires current password; either reports an outstanding commitment or atomically deletes the User presentation. |

`SUSPENDED` is platform-only in the MVP; no external `SUSPEND_USER` command exists. Email-address change and device-management operations are intentionally absent.

## 4. Credential and token rules

1. Passwords are stored only as Argon2id digests.
2. A password has at least twelve characters and must not occur in the small versioned common-password deny list. No character-class rule exists.
3. An access JWT lasts fifteen minutes. A Refresh Session expires after seven days without meaningful authenticated activity and has a fixed maximum lifetime of thirty days from sign-in; refreshes do not extend that maximum. Only its secret digest is stored.
4. A User has at most five active Refresh Sessions. A sixth sign-in revokes the oldest active session in the same transaction.
5. Refresh rotates the secret of the same session without recording activity or extending its maximum lifetime. Replaying an old refresh secret fails.
6. Normal sign-out affects only the presented session. Password reset, password change, suspension, and self-deletion revoke all active sessions.
7. Verification secrets expire after twenty-four hours; a resend invalidates earlier unused verification secrets and may occur at most once per User per sixty seconds.
8. Reset secrets expire after one hour; a new request invalidates earlier unused reset secrets.
9. Registration creates an unverified but signed-in User. That User may manage their Profile and request verification, but cannot perform Verified User actions.
10. Reset and verification-resend requests use generic results. Registration alone returns `EMAIL_ALREADY_REGISTERED`.

## 5. Self-deletion transaction

Self-deletion is irreversible. It does not remove foreign-key history and it does not make a historical Event or Attendance anonymous by deleting its User identifier.

```text
begin
  lock User row
  verify User is ACTIVE and current password matches
  verify no future Event has this User as Organizer
  verify no future Attendance for this User is CONFIRMED, PENDING, or WAITLISTED
  invoke Media internal seam: detach owned Profile/Event Media and mark owned assets DELETED
  revoke every pending Invitation addressed to this User
  revoke every active Refresh Session for this User
  pseudonymize email and Profile presentation data
  mark User DELETED
commit
```

The command fails without mutation when an Organizer Event or active future Attendance exists. The media retirement step runs in the same transaction and its file cleanup runs after commit. Pseudonymization makes the original email unique and non-routable, makes the Profile private, removes avatar and biography, and presents the User as deleted. The original email may later register as a distinct new User with no connection to deleted history.

## 6. Transactions, adapters, and distribution

Every state-changing command evaluates secrets and User state, locks relevant records, applies the life-cycle rule, writes its canonical records, and commits once. Email links are built and delivered only after commit. A local Mailpit adapter is sufficient for the MVP; delivery failure is logged and does not roll back valid User/token state.

```text
validate command and password policy
begin transaction
  lock User, token, and/or Refresh Session rows as relevant
  apply session limit, token invalidation, or User life-cycle rule
  commit canonical state
deliver verification or reset link after commit when needed
```

PostgreSQL remains private to the `auth` implementation: there is no generic repository interface with only one meaningful adapter. Clock, Argon2id hashing, random-secret generation, JWT codec, and email delivery are internal seams. Deterministic test adapters may replace them inside the implementation; callers do not cross those seams.

The MVP emits no RabbitMQ identity event merely for registration or session rotation. Verification and self-deletion may later become distribution facts if another module acquires a real need; until then they remain local, avoiding speculative messaging.

## 7. Business failures and idempotency

```text
EMAIL_ALREADY_REGISTERED
INVALID_CREDENTIALS
USER_NOT_ACTIVE
ACCESS_TOKEN_INVALID
REFRESH_SESSION_INVALID
VERIFICATION_TOKEN_INVALID_OR_EXPIRED
VERIFICATION_RESEND_TOO_SOON
PASSWORD_RESET_TOKEN_INVALID_OR_EXPIRED
PASSWORD_POLICY_VIOLATION
CURRENT_PASSWORD_INCORRECT
SELF_DELETE_BLOCKED_BY_FUTURE_EVENTS
SELF_DELETE_BLOCKED_BY_ACTIVE_ATTENDANCES
```

Expected business failures are part of the interface; the HTTP adapter maps them to HTTP outcomes without changing their meaning. PostgreSQL, JWT codec, or email-adapter faults remain exceptional.

`SIGN_OUT` is deliberately idempotent: a missing, expired, or already-revoked refresh secret clears the caller cookie and returns `SIGNED_OUT`. Token-consuming commands are single-use: a repeated verification or reset link returns its named invalid-or-expired outcome and performs no further mutation.

## 8. Integration-test contract

The `AuthModule` interface is the test surface. PostgreSQL integration tests must prove:

1. Registration creates User, Profile, verification token, and first Refresh Session atomically.
2. An unverified User receives a session but cannot cross a Verified User gate.
3. Verification token expiry, consumption, invalidation, and sixty-second resend cooldown work correctly.
4. Password reset response does not reveal whether an eligible User exists.
5. Reset invalidates older reset secrets, revokes all prior sessions, and grants exactly one replacement session.
6. Refresh rotation makes the old secret unusable, even under concurrent attempts.
7. A sixth sign-in revokes exactly the oldest active session.
8. Suspension, password change, and self-deletion prevent an existing access JWT from authenticating.
9. Self-deletion is blocked by future Organizer Events or active future Attendances and otherwise revokes pending Invitations, sessions, and Profile presentation.
10. A later registration with the deleted email creates a distinct User.

## 9. Implementation map

```text
apps/api/src/auth/
  auth.module.ts
  auth.interface.ts
  auth.commands.ts
  auth.results.ts
  auth.errors.ts
  auth.implementation.ts
  auth.persistence.ts
  auth.email.ts
  auth.http.ts
  auth.integration-spec.ts
```

This is a responsibility map, not a mandate for shallow forwarding files. The deep `auth` implementation owns its rules, locks, secrets, and transaction order behind the two-entry interface.

## 10. Related documents

- [System design](../architecture/system.md)
- [Application architecture](../architecture/application.md)
- [Data model](../architecture/data-model.md)
- [Domain glossary](../domain-glossary.md)
