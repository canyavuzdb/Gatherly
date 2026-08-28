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
  it('opens a public profile anonymously and hides it after becoming private', async () => {
    const subject = asSessionGrant(await auth.decide({ kind: 'REGISTER', email: 'profile-subject@example.test', password: 'correct-horse-battery-staple', firstName: 'Profile', lastName: 'Subject' }));
    await users.reviseMyProfile({ actor: subject.identity, expectedVersion: 1, firstName: 'Profile', lastName: 'Subject', bio: null, visibility: 'PUBLIC' });
    await expect(users.openProfile({ viewer: null, subjectUserId: subject.identity.userId })).resolves.toMatchObject({ userId: subject.identity.userId });
    await users.reviseMyProfile({ actor: subject.identity, expectedVersion: 2, firstName: 'Profile', lastName: 'Subject', bio: null, visibility: 'PRIVATE' });
    await expect(users.openProfile({ viewer: null, subjectUserId: subject.identity.userId })).rejects.toMatchObject({ code: 'PROFILE_NOT_FOUND_OR_NOT_VIEWABLE' });
  });

  it('reads the default and current-month event creation quota without creating a row', async () => {
    const registration = asSessionGrant(await auth.decide({ kind: 'REGISTER', email: 'quota@example.test', password: 'correct-horse-battery-staple', firstName: 'Quota', lastName: 'User' }));
    await expect(users.currentEventCreationQuota({ actor: registration.identity })).resolves.toMatchObject({ createdCount: 0, monthlyEventLimit: 8, remainingCount: 8 });
    const periodStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString().slice(0, 10);
    await dataSource.query("INSERT INTO event_creation_quota_usage (user_id,period_start,created_count,monthly_event_limit,updated_by_kind) VALUES ($1,$2,3,5,'USER')", [registration.identity.userId, periodStart]);
    await expect(users.currentEventCreationQuota({ actor: registration.identity })).resolves.toMatchObject({ periodStart, createdCount: 3, monthlyEventLimit: 5, remainingCount: 2 });
  });
});

function asSessionGrant(outcome: Awaited<ReturnType<AuthModule['decide']>>): SessionGrant {
  if (outcome.kind !== 'SESSION_GRANTED') {
    throw new Error('Expected session grant.');
  }
  return outcome;
}
