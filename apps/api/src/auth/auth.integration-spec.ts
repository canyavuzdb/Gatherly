import { DataSource } from 'typeorm';
import { createDatabaseOptions } from '../config/database.config';
import type { PasswordResetEmail, VerificationEmail } from './auth.email';
import { AuthImplementation } from './auth.implementation';
import type { AuthModule, AuthOutcome, SessionGrant } from './auth.interface';

describe('AuthModule registration', () => {
  let dataSource: DataSource;
  let auth: AuthModule;
  let verificationEmails: VerificationEmail[];
  let passwordResetEmails: PasswordResetEmail[];
  let currentTime: Date;

  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error('DATABASE_URL is required for PostgreSQL integration tests.');
    }

    dataSource = new DataSource(createDatabaseOptions(databaseUrl));
    await dataSource.initialize();
    await dataSource.runMigrations();
    verificationEmails = [];
    passwordResetEmails = [];
    auth = new AuthImplementation(dataSource, {
      jwtSecret: 'test-jwt-secret-that-is-long-enough',
      sendVerificationEmail: async (message) => {
        verificationEmails.push(message);
      },
      sendPasswordResetEmail: async (message) => {
        passwordResetEmails.push(message);
      },
      now: () => currentTime,
    });
  });

  afterAll(async () => {
    await dataSource?.destroy();
  });

  beforeEach(async () => {
    currentTime = new Date('2026-08-28T12:00:00.000Z');
    verificationEmails = [];
    passwordResetEmails = [];
    await dataSource.query(
      'TRUNCATE refresh_sessions, email_verification_tokens, password_reset_tokens, profiles, users CASCADE',
    );
  });

  it('creates an unverified identity and a session for a valid registration', async () => {
    const outcome = await auth.decide({
      kind: 'REGISTER',
      email: 'ada@example.com',
      password: 'correct-horse-battery-staple',
      firstName: 'Ada',
      lastName: 'Lovelace',
    });

    expect(outcome).toMatchObject({
      kind: 'SESSION_GRANTED',
      identity: { verification: 'UNVERIFIED' },
    });
    const session = asSessionGrant(outcome);
    expect(session.accessToken).toEqual(expect.any(String));
    expect(session.refreshSecret).toEqual(expect.any(String));
  });

  it('authenticates an access token against the current user identity', async () => {
    const registration = asSessionGrant(await auth.decide({
      kind: 'REGISTER',
      email: 'ada@example.com',
      password: 'correct-horse-battery-staple',
      firstName: 'Ada',
      lastName: 'Lovelace',
    }));

    await expect(auth.authenticate(registration.accessToken)).resolves.toEqual(
      registration.identity,
    );
  });

  it('grants a new session to an active user with valid credentials', async () => {
    const registration = asSessionGrant(await auth.decide({
      kind: 'REGISTER',
      email: 'ada@example.com',
      password: 'correct-horse-battery-staple',
      firstName: 'Ada',
      lastName: 'Lovelace',
    }));

    const outcome = asSessionGrant(await auth.decide({
      kind: 'SIGN_IN',
      email: 'ada@example.com',
      password: 'correct-horse-battery-staple',
    }));

    expect(outcome).toMatchObject({
      kind: 'SESSION_GRANTED',
      identity: registration.identity,
    });
    expect(outcome.refreshSecret).not.toEqual(registration.refreshSecret);
  });

  it('rotates a refresh session and rejects reuse of the old secret', async () => {
    const registration = asSessionGrant(await auth.decide({
      kind: 'REGISTER',
      email: 'ada@example.com',
      password: 'correct-horse-battery-staple',
      firstName: 'Ada',
      lastName: 'Lovelace',
    }));

    const replacement = asSessionGrant(await auth.decide({
      kind: 'REFRESH_SESSION',
      refreshSecret: registration.refreshSecret,
    }));

    expect(replacement).toMatchObject({
      kind: 'SESSION_GRANTED',
      identity: registration.identity,
    });
    expect(replacement.refreshSecret).not.toEqual(registration.refreshSecret);
    await expect(
      auth.decide({
        kind: 'REFRESH_SESSION',
        refreshSecret: registration.refreshSecret,
      }),
    ).rejects.toMatchObject({ code: 'REFRESH_SESSION_INVALID' });
  });

  it('revokes the presented session and allows a repeated sign-out', async () => {
    const registration = asSessionGrant(await auth.decide({
      kind: 'REGISTER',
      email: 'ada@example.com',
      password: 'correct-horse-battery-staple',
      firstName: 'Ada',
      lastName: 'Lovelace',
    }));

    await expect(
      auth.decide({
        kind: 'SIGN_OUT',
        refreshSecret: registration.refreshSecret,
      }),
    ).resolves.toEqual({ kind: 'SIGNED_OUT' });
    await expect(
      auth.decide({
        kind: 'SIGN_OUT',
        refreshSecret: registration.refreshSecret,
      }),
    ).resolves.toEqual({ kind: 'SIGNED_OUT' });
  });

  it('verifies a user from the delivered verification secret', async () => {
    await auth.decide({
      kind: 'REGISTER',
      email: 'ada@example.com',
      password: 'correct-horse-battery-staple',
      firstName: 'Ada',
      lastName: 'Lovelace',
    });
    const verificationSecret = verificationEmails.at(-1)?.verificationSecret;
    if (!verificationSecret) {
      throw new Error('Registration did not deliver a verification secret.');
    }

    const outcome = await auth.decide({
      kind: 'VERIFY_EMAIL',
      verificationSecret,
    });

    expect(outcome).toMatchObject({
      kind: 'EMAIL_VERIFIED',
      identity: { verification: 'VERIFIED' },
    });
  });

  it('replaces the verification secret and enforces the resend cooldown', async () => {
    const registration = asSessionGrant(await auth.decide({
      kind: 'REGISTER',
      email: 'ada@example.com',
      password: 'correct-horse-battery-staple',
      firstName: 'Ada',
      lastName: 'Lovelace',
    }));
    const firstSecret = verificationEmails.at(-1)?.verificationSecret;
    if (!firstSecret) {
      throw new Error('Registration did not deliver a verification secret.');
    }

    await expect(
      auth.decide({
        kind: 'RESEND_VERIFICATION',
        actorUserId: registration.identity.userId,
      }),
    ).resolves.toEqual({ kind: 'REQUEST_ACCEPTED' });
    const replacementSecret = verificationEmails.at(-1)?.verificationSecret;
    if (!replacementSecret) {
      throw new Error('Resend did not deliver a verification secret.');
    }

    expect(replacementSecret).not.toEqual(firstSecret);
    await expect(
      auth.decide({ kind: 'VERIFY_EMAIL', verificationSecret: firstSecret }),
    ).rejects.toMatchObject({ code: 'VERIFICATION_TOKEN_INVALID_OR_EXPIRED' });
    await expect(
      auth.decide({
        kind: 'RESEND_VERIFICATION',
        actorUserId: registration.identity.userId,
      }),
    ).rejects.toMatchObject({ code: 'VERIFICATION_RESEND_TOO_SOON' });
  });

  it('accepts password reset requests without revealing account existence', async () => {
    await expect(
      auth.decide({
        kind: 'REQUEST_PASSWORD_RESET',
        email: 'missing@example.com',
      }),
    ).resolves.toEqual({ kind: 'REQUEST_ACCEPTED' });
    expect(passwordResetEmails).toEqual([]);

    await auth.decide({
      kind: 'REGISTER',
      email: 'ada@example.com',
      password: 'correct-horse-battery-staple',
      firstName: 'Ada',
      lastName: 'Lovelace',
    });
    await expect(
      auth.decide({
        kind: 'REQUEST_PASSWORD_RESET',
        email: 'ada@example.com',
      }),
    ).resolves.toEqual({ kind: 'REQUEST_ACCEPTED' });
    expect(passwordResetEmails.at(-1)).toMatchObject({ email: 'ada@example.com' });
  });

  it('consumes a reset secret, revokes old sessions, and grants one replacement session', async () => {
    const registration = asSessionGrant(await auth.decide({
      kind: 'REGISTER',
      email: 'ada@example.com',
      password: 'correct-horse-battery-staple',
      firstName: 'Ada',
      lastName: 'Lovelace',
    }));
    await auth.decide({
      kind: 'REQUEST_PASSWORD_RESET',
      email: 'ada@example.com',
    });
    const resetSecret = passwordResetEmails.at(-1)?.resetSecret;
    if (!resetSecret) {
      throw new Error('Password reset request did not deliver a reset secret.');
    }

    const replacement = asSessionGrant(await auth.decide({
      kind: 'RESET_PASSWORD',
      resetSecret,
      newPassword: 'new-correct-horse-battery-staple',
    }));

    expect(replacement.refreshSecret).not.toEqual(registration.refreshSecret);
    await expect(
      auth.decide({
        kind: 'REFRESH_SESSION',
        refreshSecret: registration.refreshSecret,
      }),
    ).rejects.toMatchObject({ code: 'REFRESH_SESSION_INVALID' });
    await expect(
      auth.decide({
        kind: 'RESET_PASSWORD',
        resetSecret,
        newPassword: 'another-correct-horse-battery-staple',
      }),
    ).rejects.toMatchObject({ code: 'PASSWORD_RESET_TOKEN_INVALID_OR_EXPIRED' });
  });

  it('changes a password and invalidates existing sessions and access tokens', async () => {
    const registration = asSessionGrant(await auth.decide({
      kind: 'REGISTER',
      email: 'ada@example.com',
      password: 'correct-horse-battery-staple',
      firstName: 'Ada',
      lastName: 'Lovelace',
    }));

    await expect(
      auth.decide({
        kind: 'CHANGE_PASSWORD',
        actorUserId: registration.identity.userId,
        currentPassword: 'correct-horse-battery-staple',
        newPassword: 'new-correct-horse-battery-staple',
      }),
    ).resolves.toEqual({ kind: 'PASSWORD_CHANGED' });
    await expect(auth.authenticate(registration.accessToken)).rejects.toMatchObject({
      code: 'ACCESS_TOKEN_INVALID',
    });
    await expect(
      auth.decide({
        kind: 'REFRESH_SESSION',
        refreshSecret: registration.refreshSecret,
      }),
    ).rejects.toMatchObject({ code: 'REFRESH_SESSION_INVALID' });
  });
});

function asSessionGrant(outcome: AuthOutcome): SessionGrant {
  if (outcome.kind !== 'SESSION_GRANTED') {
    throw new Error(`Expected SESSION_GRANTED, received ${outcome.kind}`);
  }
  return outcome;
}
