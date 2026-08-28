import { DataSource } from 'typeorm';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabaseOptions } from '../config/database.config';
import type { PasswordResetEmail, VerificationEmail } from './auth.email';
import { AuthImplementation } from './auth.implementation';
import type { AuthModule, AuthOutcome, SessionGrant } from './auth.interface';
import { MediaImplementation } from '../media/media.implementation';
import { LocalMediaStorage } from '../media/media.storage';

describe('AuthModule registration', () => {
  let dataSource: DataSource;
  let auth: AuthModule;
  let verificationEmails: VerificationEmail[];
  let passwordResetEmails: PasswordResetEmail[];
  let currentTime: Date;
  let mediaStorageDirectory: string;

  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error('DATABASE_URL is required for PostgreSQL integration tests.');
    }

    dataSource = new DataSource(createDatabaseOptions(databaseUrl));
    await dataSource.initialize();
    await dataSource.runMigrations();
    mediaStorageDirectory = await mkdtemp(join(tmpdir(), 'gatherly-auth-media-'));
    const media = new MediaImplementation(dataSource, new LocalMediaStorage(mediaStorageDirectory));
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
      retireOwnedMedia: media.retireOwnedAssetsInTransaction.bind(media),
      removeRetiredMediaFiles: media.removeRetiredFiles.bind(media),
    });
  });

  afterAll(async () => {
    await dataSource?.destroy();
    await rm(mediaStorageDirectory, { recursive: true, force: true });
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

  it('pseudonymizes a user and invalidates their access after self-delete', async () => {
    const registration = asSessionGrant(await auth.decide({ kind: 'REGISTER', email: 'delete@example.com', password: 'correct-horse-battery-staple', firstName: 'Delete', lastName: 'Me' }));
    const categoryId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    const eventId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    const mediaAssetId = 'abababab-abab-4bab-8bab-abababababab';
    await dataSource.query("INSERT INTO categories (id,name,slug,updated_by_kind) VALUES ($1,'Deletion','deletion','SYSTEM')", [categoryId]);
    await dataSource.query("INSERT INTO events (id,organizer_id,category_id,title,description,starts_at,ends_at,timezone,capacity,confirmed_count,visibility,join_policy,status,created_by_user_id,updated_by_kind) VALUES ($1,$2,$3,'Past event','Description','2026-08-01T10:00:00Z','2026-08-01T11:00:00Z','Europe/Istanbul',2,1,'PUBLIC','OPEN','COMPLETED',$2,'USER')", [eventId, registration.identity.userId, categoryId]);
    await dataSource.query("INSERT INTO media_assets (id,owner_user_id,storage_key,mime_type,byte_size,width,height,status,updated_by_user_id,updated_by_kind) VALUES ($1,$2,'delete-test.png','image/png',1,1,1,'READY',$2,'USER')", [mediaAssetId, registration.identity.userId]);
    await dataSource.query("UPDATE profiles SET avatar_media_asset_id = $1 WHERE user_id = $2", [mediaAssetId, registration.identity.userId]);
    await dataSource.query("INSERT INTO event_media (event_id,media_asset_id,role,position,added_by_user_id,updated_by_user_id,updated_by_kind) VALUES ($1,$2,'COVER',0,$3,$3,'USER')", [eventId, mediaAssetId, registration.identity.userId]);
    await expect(auth.decide({ kind: 'SELF_DELETE', actorUserId: registration.identity.userId, currentPassword: 'correct-horse-battery-staple' })).resolves.toEqual({ kind: 'SELF_DELETED' });
    await expect(auth.authenticate(registration.accessToken)).rejects.toMatchObject({ code: 'ACCESS_TOKEN_INVALID' });
    await expect(auth.decide({ kind: 'REFRESH_SESSION', refreshSecret: registration.refreshSecret })).rejects.toMatchObject({ code: 'REFRESH_SESSION_INVALID' });
    await expect(dataSource.query('SELECT status, email FROM users WHERE id = $1', [registration.identity.userId])).resolves.toEqual([{ status: 'DELETED', email: `deleted+${registration.identity.userId}@invalid.local` }]);
    await expect(dataSource.query('SELECT first_name, last_name, bio, visibility FROM profiles WHERE user_id = $1', [registration.identity.userId])).resolves.toEqual([{ first_name: 'Deleted', last_name: 'User', bio: null, visibility: 'PRIVATE' }]);
    await expect(dataSource.query('SELECT avatar_media_asset_id FROM profiles WHERE user_id = $1', [registration.identity.userId])).resolves.toEqual([{ avatar_media_asset_id: null }]);
    await expect(dataSource.query('SELECT status, deleted_by_user_id FROM media_assets WHERE id = $1', [mediaAssetId])).resolves.toEqual([{ status: 'DELETED', deleted_by_user_id: registration.identity.userId }]);
    await expect(dataSource.query('SELECT id FROM event_media WHERE media_asset_id = $1', [mediaAssetId])).resolves.toEqual([]);
  });

  it('blocks self-delete when the user organizes a future event', async () => {
    const registration = asSessionGrant(await auth.decide({ kind: 'REGISTER', email: 'future-organizer@example.test', password: 'correct-horse-battery-staple', firstName: 'Future', lastName: 'Organizer' }));
    const category = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; const event = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    await dataSource.query("INSERT INTO categories (id,name,slug,updated_by_kind) VALUES ($1,'Testing','testing','SYSTEM')", [category]);
    await dataSource.query("INSERT INTO events (id,organizer_id,category_id,title,description,starts_at,ends_at,timezone,capacity,confirmed_count,visibility,join_policy,status,created_by_user_id,updated_by_kind) VALUES ($1,$2,$3,'Future','Event','2099-01-01T18:00:00Z','2099-01-01T20:00:00Z','Europe/Istanbul',2,1,'PUBLIC','OPEN','PUBLISHED',$2,'USER')", [event, registration.identity.userId, category]);
    await expect(auth.decide({ kind: 'SELF_DELETE', actorUserId: registration.identity.userId, currentPassword: 'correct-horse-battery-staple' })).rejects.toMatchObject({ code: 'SELF_DELETE_BLOCKED_BY_FUTURE_EVENTS' });
    await expect(dataSource.query('SELECT status FROM users WHERE id = $1', [registration.identity.userId])).resolves.toEqual([{ status: 'ACTIVE' }]);
  });

  it('blocks self-delete when the user has an active future attendance', async () => {
    const attendee = asSessionGrant(await auth.decide({ kind: 'REGISTER', email: 'future-attendee@example.test', password: 'correct-horse-battery-staple', firstName: 'Future', lastName: 'Attendee' }));
    const organizer = asSessionGrant(await auth.decide({ kind: 'REGISTER', email: 'future-event-owner@example.test', password: 'correct-horse-battery-staple', firstName: 'Event', lastName: 'Owner' }));
    const category = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'; const event = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    await dataSource.query("INSERT INTO categories (id,name,slug,updated_by_kind) VALUES ($1,'Testing two','testing-two','SYSTEM')", [category]);
    await dataSource.query("INSERT INTO events (id,organizer_id,category_id,title,description,starts_at,ends_at,timezone,capacity,confirmed_count,visibility,join_policy,status,created_by_user_id,updated_by_kind) VALUES ($1,$2,$3,'Future','Event','2099-01-01T18:00:00Z','2099-01-01T20:00:00Z','Europe/Istanbul',2,1,'PUBLIC','OPEN','PUBLISHED',$2,'USER')", [event, organizer.identity.userId, category]);
    await dataSource.query("INSERT INTO attendances (event_id,user_id,status,waitlist_opt_in,requested_at,confirmed_at,updated_by_user_id,updated_by_kind) VALUES ($1,$2,'CONFIRMED',false,now(),now(),$2,'USER')", [event, attendee.identity.userId]);
    await expect(auth.decide({ kind: 'SELF_DELETE', actorUserId: attendee.identity.userId, currentPassword: 'correct-horse-battery-staple' })).rejects.toMatchObject({ code: 'SELF_DELETE_BLOCKED_BY_ACTIVE_ATTENDANCES' });
  });
});

function asSessionGrant(outcome: AuthOutcome): SessionGrant {
  if (outcome.kind !== 'SESSION_GRANTED') {
    throw new Error(`Expected SESSION_GRANTED, received ${outcome.kind}`);
  }
  return outcome;
}
