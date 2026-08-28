import { DataSource } from 'typeorm';
import { AuthImplementation } from '../auth/auth.implementation';
import type { AuthModule, SessionGrant } from '../auth/auth.interface';
import { createDatabaseOptions } from '../config/database.config';
import { UsersImplementation } from './users.implementation';
import type { UsersModule } from './users.interface';

describe('UsersModule profile revision', () => {
  let dataSource: DataSource;
  let auth: AuthModule;
  let users: UsersModule;

  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error('DATABASE_URL is required for PostgreSQL integration tests.');
    }

    dataSource = new DataSource(createDatabaseOptions(databaseUrl));
    await dataSource.initialize();
    await dataSource.runMigrations();
    auth = new AuthImplementation(dataSource, {
      jwtSecret: 'test-jwt-secret-that-is-long-enough',
      sendVerificationEmail: async () => undefined,
      sendPasswordResetEmail: async () => undefined,
    });
    users = new UsersImplementation(dataSource);
  });

  afterAll(async () => {
    await dataSource?.destroy();
  });

  beforeEach(async () => {
    await dataSource.query(
      'TRUNCATE refresh_sessions, email_verification_tokens, password_reset_tokens, profiles, users CASCADE',
    );
  });

  it('lets an active unverified user revise their complete profile', async () => {
    const registration = asSessionGrant(
      await auth.decide({
        kind: 'REGISTER',
        email: 'ada@example.com',
        password: 'correct-horse-battery-staple',
        firstName: 'Ada',
        lastName: 'Lovelace',
      }),
    );

    await expect(
      users.reviseMyProfile({
        actor: registration.identity,
        expectedVersion: 1,
        firstName: '  Ada  ',
        lastName: ' Byron ',
        bio: '  Computing pioneer.  ',
        visibility: 'PUBLIC',
      }),
    ).resolves.toEqual({
      userId: registration.identity.userId,
      firstName: 'Ada',
      lastName: 'Byron',
      bio: 'Computing pioneer.',
      avatar: null,
      visibility: 'PUBLIC',
      version: 2,
    });
  });
});

function asSessionGrant(outcome: Awaited<ReturnType<AuthModule['decide']>>): SessionGrant {
  if (outcome.kind !== 'SESSION_GRANTED') {
    throw new Error('Expected session grant.');
  }
  return outcome;
}
