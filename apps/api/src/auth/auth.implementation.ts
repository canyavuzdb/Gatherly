import { createHash, randomBytes } from 'node:crypto';
import * as argon2 from 'argon2';
import { sign, verify } from 'jsonwebtoken';
import { DataSource, EntityManager, IsNull, Not, QueryFailedError } from 'typeorm';
import { AuthBusinessError } from './auth.errors';
import type { AuthEmailDelivery } from './auth.email';
import type {
  AuthCommand,
  AuthModule,
  AuthOutcome,
  ChangePassword,
  Register,
  RequestPasswordReset,
  ResetPassword,
  ResendVerification,
  RefreshSession,
  SessionGrant,
  SignIn,
  SignOut,
  SelfDelete,
  UserIdentity,
  VerifyEmail,
} from './auth.interface';
import { AttendanceRecord, EventRecord, InvitationRecord } from '../events/events.persistence';
import {
  EmailVerificationTokenRecord,
  PasswordResetTokenRecord,
  ProfileRecord,
  RefreshSessionRecord,
  UserRecord,
} from './auth.persistence';

const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000;
const COMMON_PASSWORDS = new Set([
  '123456789012',
  'passwordpassword',
  'qwertyuiopasdf',
]);

type AuthDependencies = {
  jwtSecret: string;
  sendVerificationEmail: AuthEmailDelivery['sendVerificationEmail'];
  sendPasswordResetEmail: AuthEmailDelivery['sendPasswordResetEmail'];
  now?: () => Date;
  randomSecret?: () => string;
  retireOwnedMedia?: (manager: EntityManager, userId: string, now: Date) => Promise<string[]>;
  removeRetiredMediaFiles?: (storageKeys: string[]) => Promise<void>;
};

export class AuthImplementation implements AuthModule {
  private readonly now: () => Date;
  private readonly randomSecret: () => string;

  constructor(
    private readonly dataSource: DataSource,
    private readonly dependencies: AuthDependencies,
  ) {
    this.now = dependencies.now ?? (() => new Date());
    this.randomSecret =
      dependencies.randomSecret ?? (() => randomBytes(32).toString('base64url'));
  }

  async decide(command: AuthCommand): Promise<AuthOutcome> {
    switch (command.kind) {
      case 'REGISTER':
        return this.register(command);
      case 'SIGN_IN':
        return this.signIn(command);
      case 'REFRESH_SESSION':
        return this.refreshSession(command);
      case 'SIGN_OUT':
        return this.signOut(command);
      case 'VERIFY_EMAIL':
        return this.verifyEmail(command);
      case 'RESEND_VERIFICATION':
        return this.resendVerification(command);
      case 'REQUEST_PASSWORD_RESET':
        return this.requestPasswordReset(command);
      case 'RESET_PASSWORD':
        return this.resetPassword(command);
      case 'CHANGE_PASSWORD':
        return this.changePassword(command);
      case 'SELF_DELETE':
        return this.selfDelete(command);
    }
  }

  private async selfDelete(command: SelfDelete): Promise<AuthOutcome> {
    const retiredMediaKeys = await this.dataSource.transaction(async (manager) => {
      const user = await manager.findOne(UserRecord, { where: { id: command.actorUserId }, lock: { mode: 'pessimistic_write' } });
      if (!user || user.status !== 'ACTIVE' || !(await argon2.verify(user.passwordHash, command.currentPassword))) throw new AuthBusinessError('CURRENT_PASSWORD_INCORRECT');
      const now = this.now();
      if (await manager.getRepository(EventRecord).createQueryBuilder('event').where('event.organizer_id = :userId AND event.starts_at > :now', { userId: user.id, now }).getExists()) throw new AuthBusinessError('SELF_DELETE_BLOCKED_BY_FUTURE_EVENTS');
      if (await manager.getRepository(AttendanceRecord).createQueryBuilder('attendance').innerJoin(EventRecord, 'event', 'event.id = attendance.event_id').where("attendance.user_id = :userId AND event.starts_at > :now AND attendance.status IN ('CONFIRMED','PENDING','WAITLISTED')", { userId: user.id, now }).getExists()) throw new AuthBusinessError('SELF_DELETE_BLOCKED_BY_ACTIVE_ATTENDANCES');
      await manager.createQueryBuilder().update(RefreshSessionRecord).set({ revokedAt: now }).where('user_id = :userId AND revoked_at IS NULL', { userId: user.id }).execute();
      await manager.createQueryBuilder().update(InvitationRecord).set({ status: 'REVOKED', revokedAt: now, updatedByUserId: user.id, updatedByKind: 'USER' }).where("recipient_user_id = :userId AND status = 'PENDING'", { userId: user.id }).execute();
      const storageKeys = this.dependencies.retireOwnedMedia ? await this.dependencies.retireOwnedMedia(manager, user.id, now) : [];
      const profile = await manager.findOneBy(ProfileRecord, { userId: user.id });
      if (profile) { profile.firstName = 'Deleted'; profile.lastName = 'User'; profile.bio = null; profile.avatarMediaAssetId = null; profile.visibility = 'PRIVATE'; profile.updatedByUserId = user.id; profile.updatedByKind = 'USER'; profile.version += 1; await manager.save(profile); }
      user.email = `deleted+${user.id}@invalid.local`; user.status = 'DELETED'; user.emailVerifiedAt = null; user.version += 1; await manager.save(user);
      return storageKeys;
    });
    await this.dependencies.removeRetiredMediaFiles?.(retiredMediaKeys);
    return { kind: 'SELF_DELETED' };
  }

  async authenticate(accessToken: string): Promise<UserIdentity> {
    let userId: string;
    let tokenVersion: number;
    try {
      const payload = verify(accessToken, this.dependencies.jwtSecret, {
        algorithms: ['HS256'],
      });
      if (
        typeof payload !== 'object' ||
        typeof payload.sub !== 'string' ||
        typeof payload.uv !== 'number'
      ) {
        throw new AuthBusinessError('ACCESS_TOKEN_INVALID');
      }
      userId = payload.sub;
      tokenVersion = payload.uv;
    } catch (error) {
      if (error instanceof AuthBusinessError) {
        throw error;
      }
      throw new AuthBusinessError('ACCESS_TOKEN_INVALID');
    }

    const user = await this.dataSource.manager.findOneBy(UserRecord, { id: userId });
    if (
      !user ||
      user.status !== 'ACTIVE' ||
      tokenVersion !== user.version
    ) {
      throw new AuthBusinessError('ACCESS_TOKEN_INVALID');
    }

    return {
      userId: user.id,
      verification: user.emailVerifiedAt ? 'VERIFIED' : 'UNVERIFIED',
    };
  }

  private async register(command: Register): Promise<SessionGrant> {
    const email = command.email.trim().toLowerCase();
    const firstName = command.firstName.trim();
    const lastName = command.lastName.trim();
    this.assertPasswordAllowed(command.password);

    const [passwordHash, verificationSecret, refreshSecret] = await Promise.all([
      argon2.hash(command.password, { type: argon2.argon2id }),
      Promise.resolve(this.randomSecret()),
      Promise.resolve(this.randomSecret()),
    ]);
    const now = this.now();
    const refreshExpiresAt = new Date(now.getTime() + 30 * DAY_IN_MILLISECONDS);

    let issuedTo: { userId: string; version: number };
    try {
      issuedTo = await this.dataSource.transaction(async (manager) => {
        const user = await manager.save(
          manager.create(UserRecord, {
            email,
            passwordHash,
            emailVerifiedAt: null,
            status: 'ACTIVE',
          }),
        );

        await manager.save(
          manager.create(ProfileRecord, {
            userId: user.id,
            firstName,
            lastName,
            bio: null,
            avatarMediaAssetId: null,
            visibility: 'EVENT_ATTENDEES',
            createdByUserId: user.id,
            updatedByUserId: user.id,
            updatedByKind: 'SYSTEM',
          }),
        );
        await manager.save(
          manager.create(EmailVerificationTokenRecord, {
            userId: user.id,
            tokenHash: hashSecret(verificationSecret),
            expiresAt: new Date(now.getTime() + DAY_IN_MILLISECONDS),
            usedAt: null,
            invalidatedAt: null,
          }),
        );
        await manager.save(
          manager.create(RefreshSessionRecord, {
            userId: user.id,
            tokenHash: hashSecret(refreshSecret),
            expiresAt: refreshExpiresAt,
            revokedAt: null,
            lastUsedAt: null,
          }),
        );

        return { userId: user.id, version: user.version };
      });
    } catch (error) {
      if (isUniqueEmailViolation(error)) {
        throw new AuthBusinessError('EMAIL_ALREADY_REGISTERED');
      }
      throw error;
    }

    await this.dependencies.sendVerificationEmail({ email, verificationSecret });

    return {
      kind: 'SESSION_GRANTED',
      accessToken: this.issueAccessToken(issuedTo.userId, issuedTo.version),
      refreshSecret,
      refreshExpiresAt,
      identity: { userId: issuedTo.userId, verification: 'UNVERIFIED' },
    };
  }

  private async signIn(command: SignIn): Promise<SessionGrant> {
    const email = command.email.trim().toLowerCase();
    const refreshSecret = this.randomSecret();
    const now = this.now();
    const refreshExpiresAt = new Date(now.getTime() + 30 * DAY_IN_MILLISECONDS);

    const identity = await this.dataSource.transaction(async (manager) => {
      const user = await manager.findOneBy(UserRecord, { email });
      if (!user || user.status !== 'ACTIVE') {
        throw new AuthBusinessError('INVALID_CREDENTIALS');
      }

      const passwordMatches = await argon2.verify(user.passwordHash, command.password);
      if (!passwordMatches) {
        throw new AuthBusinessError('INVALID_CREDENTIALS');
      }

      const activeSessions = await manager.find(RefreshSessionRecord, {
        where: { userId: user.id, revokedAt: IsNull() },
        order: { createdAt: 'ASC' },
      });
      const oldestSession = activeSessions.at(-5);
      if (oldestSession) {
        oldestSession.revokedAt = now;
        await manager.save(oldestSession);
      }

      await manager.save(
        manager.create(RefreshSessionRecord, {
          userId: user.id,
          tokenHash: hashSecret(refreshSecret),
          expiresAt: refreshExpiresAt,
          revokedAt: null,
          lastUsedAt: null,
        }),
      );

      return {
        userId: user.id,
        version: user.version,
        verification: user.emailVerifiedAt ? ('VERIFIED' as const) : ('UNVERIFIED' as const),
      };
    });

    return {
      kind: 'SESSION_GRANTED',
      accessToken: this.issueAccessToken(identity.userId, identity.version),
      refreshSecret,
      refreshExpiresAt,
      identity,
    };
  }

  private async refreshSession(command: RefreshSession): Promise<SessionGrant> {
    const now = this.now();
    const refreshSecret = this.randomSecret();
    const refreshExpiresAt = new Date(now.getTime() + 30 * DAY_IN_MILLISECONDS);
    const presentedSecretHash = hashSecret(command.refreshSecret);

    const identity = await this.dataSource.transaction(async (manager) => {
      const presentedSession = await manager.findOne(RefreshSessionRecord, {
        where: { tokenHash: presentedSecretHash },
        lock: { mode: 'pessimistic_write' },
      });
      if (
        !presentedSession ||
        presentedSession.revokedAt ||
        presentedSession.expiresAt <= now
      ) {
        throw new AuthBusinessError('REFRESH_SESSION_INVALID');
      }

      const user = await manager.findOneBy(UserRecord, {
        id: presentedSession.userId,
      });
      if (!user || user.status !== 'ACTIVE') {
        throw new AuthBusinessError('REFRESH_SESSION_INVALID');
      }

      presentedSession.revokedAt = now;
      presentedSession.lastUsedAt = now;
      await manager.save(presentedSession);
      await manager.save(
        manager.create(RefreshSessionRecord, {
          userId: user.id,
          tokenHash: hashSecret(refreshSecret),
          expiresAt: refreshExpiresAt,
          revokedAt: null,
          lastUsedAt: null,
        }),
      );

      return {
        userId: user.id,
        version: user.version,
        verification: user.emailVerifiedAt ? ('VERIFIED' as const) : ('UNVERIFIED' as const),
      };
    });

    return {
      kind: 'SESSION_GRANTED',
      accessToken: this.issueAccessToken(identity.userId, identity.version),
      refreshSecret,
      refreshExpiresAt,
      identity,
    };
  }

  private async signOut(command: SignOut): Promise<{ kind: 'SIGNED_OUT' }> {
    const now = this.now();
    await this.dataSource.transaction(async (manager) => {
      const session = await manager.findOne(RefreshSessionRecord, {
        where: { tokenHash: hashSecret(command.refreshSecret) },
        lock: { mode: 'pessimistic_write' },
      });
      if (!session || session.revokedAt || session.expiresAt <= now) {
        return;
      }

      session.revokedAt = now;
      await manager.save(session);
    });

    return { kind: 'SIGNED_OUT' };
  }

  private async verifyEmail(
    command: VerifyEmail,
  ): Promise<{ kind: 'EMAIL_VERIFIED'; identity: { userId: string; verification: 'VERIFIED' } }> {
    const now = this.now();
    const identity = await this.dataSource.transaction(async (manager) => {
      const token = await manager.findOne(EmailVerificationTokenRecord, {
        where: { tokenHash: hashSecret(command.verificationSecret) },
        lock: { mode: 'pessimistic_write' },
      });
      if (!token || token.invalidatedAt || token.expiresAt <= now) {
        throw new AuthBusinessError('VERIFICATION_TOKEN_INVALID_OR_EXPIRED');
      }

      const user = await manager.findOne(UserRecord, {
        where: { id: token.userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!user || user.status !== 'ACTIVE') {
        throw new AuthBusinessError('VERIFICATION_TOKEN_INVALID_OR_EXPIRED');
      }

      if (token.usedAt && user.emailVerifiedAt) {
        return { userId: user.id, verification: 'VERIFIED' as const };
      }
      if (token.usedAt) {
        throw new AuthBusinessError('VERIFICATION_TOKEN_INVALID_OR_EXPIRED');
      }

      token.usedAt = now;
      user.emailVerifiedAt = now;
      await manager.save(token);
      await manager.save(user);
      return { userId: user.id, verification: 'VERIFIED' as const };
    });

    return { kind: 'EMAIL_VERIFIED', identity };
  }

  private async resendVerification(
    command: ResendVerification,
  ): Promise<{ kind: 'REQUEST_ACCEPTED' }> {
    const now = this.now();
    const verificationSecret = this.randomSecret();
    const delivery = await this.dataSource.transaction(async (manager) => {
      const user = await manager.findOne(UserRecord, {
        where: { id: command.actorUserId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!user || user.status !== 'ACTIVE' || user.emailVerifiedAt) {
        return null;
      }

      const lastInvalidatedToken = await manager.findOne(
        EmailVerificationTokenRecord,
        {
          where: {
            userId: user.id,
            invalidatedAt: Not(IsNull()),
          },
          order: { invalidatedAt: 'DESC' },
        },
      );
      if (
        lastInvalidatedToken?.invalidatedAt &&
        now.getTime() - lastInvalidatedToken.invalidatedAt.getTime() < 60_000
      ) {
        throw new AuthBusinessError('VERIFICATION_RESEND_TOO_SOON');
      }

      await manager
        .createQueryBuilder()
        .update(EmailVerificationTokenRecord)
        .set({ invalidatedAt: now })
        .where('user_id = :userId', { userId: user.id })
        .andWhere('used_at IS NULL')
        .andWhere('invalidated_at IS NULL')
        .execute();
      await manager.save(
        manager.create(EmailVerificationTokenRecord, {
          userId: user.id,
          tokenHash: hashSecret(verificationSecret),
          expiresAt: new Date(now.getTime() + DAY_IN_MILLISECONDS),
          usedAt: null,
          invalidatedAt: null,
        }),
      );

      return { email: user.email, verificationSecret };
    });

    if (delivery) {
      await this.dependencies.sendVerificationEmail(delivery);
    }
    return { kind: 'REQUEST_ACCEPTED' };
  }

  private async requestPasswordReset(
    command: RequestPasswordReset,
  ): Promise<{ kind: 'REQUEST_ACCEPTED' }> {
    const now = this.now();
    const resetSecret = this.randomSecret();
    const email = command.email.trim().toLowerCase();
    const delivery = await this.dataSource.transaction(async (manager) => {
      const user = await manager.findOne(UserRecord, {
        where: { email },
        lock: { mode: 'pessimistic_write' },
      });
      if (!user || user.status !== 'ACTIVE') {
        return null;
      }

      await manager
        .createQueryBuilder()
        .update(PasswordResetTokenRecord)
        .set({ invalidatedAt: now })
        .where('user_id = :userId', { userId: user.id })
        .andWhere('used_at IS NULL')
        .andWhere('invalidated_at IS NULL')
        .execute();
      await manager.save(
        manager.create(PasswordResetTokenRecord, {
          userId: user.id,
          tokenHash: hashSecret(resetSecret),
          expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
          usedAt: null,
          invalidatedAt: null,
        }),
      );
      return { email: user.email, resetSecret };
    });

    if (delivery) {
      await this.dependencies.sendPasswordResetEmail(delivery);
    }
    return { kind: 'REQUEST_ACCEPTED' };
  }

  private async resetPassword(command: ResetPassword): Promise<SessionGrant> {
    this.assertPasswordAllowed(command.newPassword);
    const [passwordHash, refreshSecret] = await Promise.all([
      argon2.hash(command.newPassword, { type: argon2.argon2id }),
      Promise.resolve(this.randomSecret()),
    ]);
    const now = this.now();
    const refreshExpiresAt = new Date(now.getTime() + 30 * DAY_IN_MILLISECONDS);

    const identity = await this.dataSource.transaction(async (manager) => {
      const token = await manager.findOne(PasswordResetTokenRecord, {
        where: { tokenHash: hashSecret(command.resetSecret) },
        lock: { mode: 'pessimistic_write' },
      });
      if (!token || token.usedAt || token.invalidatedAt || token.expiresAt <= now) {
        throw new AuthBusinessError('PASSWORD_RESET_TOKEN_INVALID_OR_EXPIRED');
      }

      const user = await manager.findOne(UserRecord, {
        where: { id: token.userId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!user || user.status !== 'ACTIVE') {
        throw new AuthBusinessError('PASSWORD_RESET_TOKEN_INVALID_OR_EXPIRED');
      }

      token.usedAt = now;
      user.passwordHash = passwordHash;
      user.version += 1;
      await manager.save(token);
      await manager.save(user);
      await manager
        .createQueryBuilder()
        .update(RefreshSessionRecord)
        .set({ revokedAt: now })
        .where('user_id = :userId', { userId: user.id })
        .andWhere('revoked_at IS NULL')
        .execute();
      await manager.save(
        manager.create(RefreshSessionRecord, {
          userId: user.id,
          tokenHash: hashSecret(refreshSecret),
          expiresAt: refreshExpiresAt,
          revokedAt: null,
          lastUsedAt: null,
        }),
      );

      return {
        userId: user.id,
        version: user.version,
        verification: user.emailVerifiedAt ? ('VERIFIED' as const) : ('UNVERIFIED' as const),
      };
    });

    return {
      kind: 'SESSION_GRANTED',
      accessToken: this.issueAccessToken(identity.userId, identity.version),
      refreshSecret,
      refreshExpiresAt,
      identity,
    };
  }

  private async changePassword(
    command: ChangePassword,
  ): Promise<{ kind: 'PASSWORD_CHANGED' }> {
    this.assertPasswordAllowed(command.newPassword);
    const passwordHash = await argon2.hash(command.newPassword, {
      type: argon2.argon2id,
    });
    const now = this.now();

    await this.dataSource.transaction(async (manager) => {
      const user = await manager.findOne(UserRecord, {
        where: { id: command.actorUserId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!user || user.status !== 'ACTIVE') {
        throw new AuthBusinessError('CURRENT_PASSWORD_INCORRECT');
      }

      const currentPasswordMatches = await argon2.verify(
        user.passwordHash,
        command.currentPassword,
      );
      if (!currentPasswordMatches) {
        throw new AuthBusinessError('CURRENT_PASSWORD_INCORRECT');
      }

      user.passwordHash = passwordHash;
      user.version += 1;
      await manager.save(user);
      await manager
        .createQueryBuilder()
        .update(RefreshSessionRecord)
        .set({ revokedAt: now })
        .where('user_id = :userId', { userId: user.id })
        .andWhere('revoked_at IS NULL')
        .execute();
    });

    return { kind: 'PASSWORD_CHANGED' };
  }

  private issueAccessToken(userId: string, version: number) {
    return sign({ sub: userId, uv: version }, this.dependencies.jwtSecret, {
      algorithm: 'HS256',
      expiresIn: '15m',
    });
  }

  private assertPasswordAllowed(password: string) {
    if (password.length < 12 || COMMON_PASSWORDS.has(password.toLowerCase())) {
      throw new AuthBusinessError('PASSWORD_POLICY_VIOLATION');
    }
  }
}

function hashSecret(secret: string) {
  return createHash('sha256').update(secret).digest('hex');
}

function isUniqueEmailViolation(error: unknown) {
  return (
    error instanceof QueryFailedError &&
    (error.driverError as { code?: string }).code === '23505'
  );
}
