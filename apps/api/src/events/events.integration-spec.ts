import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import type { VerificationEmail } from '../auth/auth.email';
import { AuthImplementation } from '../auth/auth.implementation';
import type { AuthModule, SessionGrant } from '../auth/auth.interface';
import { createDatabaseOptions } from '../config/database.config';
import { EventsImplementation } from './events.implementation';
import type { EventModule } from './events.interface';

describe('EventModule draft creation', () => {
  let dataSource: DataSource;
  let auth: AuthModule;
  let events: EventModule;
  let verificationEmails: VerificationEmail[];

  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
      throw new Error('DATABASE_URL is required for PostgreSQL integration tests.');
    }

    dataSource = new DataSource(createDatabaseOptions(databaseUrl));
    await dataSource.initialize();
    await dataSource.runMigrations();
    verificationEmails = [];
    auth = new AuthImplementation(dataSource, {
      jwtSecret: 'test-jwt-secret-that-is-long-enough',
      sendVerificationEmail: async (message) => {
        verificationEmails.push(message);
      },
      sendPasswordResetEmail: async () => undefined,
    });
    events = new EventsImplementation(dataSource, { now: () => new Date('2026-08-28T12:00:00.000Z') });
  });

  afterAll(async () => {
    await dataSource?.destroy();
  });

  beforeEach(async () => {
    verificationEmails = [];
    await dataSource.query(
      'TRUNCATE attendances, event_locations, events, event_creation_quota_usage, categories, refresh_sessions, email_verification_tokens, password_reset_tokens, profiles, users CASCADE',
    );
  });

  it('creates a complete draft with the organizer occupying its first seat', async () => {
    const registration = asSessionGrant(await auth.decide({
      kind: 'REGISTER',
      email: 'ada@example.com',
      password: 'correct-horse-battery-staple',
      firstName: 'Ada',
      lastName: 'Lovelace',
    }));
    const verificationSecret = verificationEmails.at(-1)?.verificationSecret;
    if (!verificationSecret) throw new Error('Expected verification email.');
    const verified = await auth.decide({ kind: 'VERIFY_EMAIL', verificationSecret });
    if (verified.kind !== 'EMAIL_VERIFIED') throw new Error('Expected verified identity.');

    const categoryId = randomUUID();
    await dataSource.query(
      `INSERT INTO categories (id, name, slug, is_active, sort_order, created_at, updated_at, updated_by_kind, version)
       VALUES ($1, 'Technology', 'technology', true, 0, now(), now(), 'SYSTEM', 1)`,
      [categoryId],
    );
    const eventId = randomUUID();

    const command: Parameters<EventModule['decide']>[0] = {
      kind: 'CREATE_DRAFT',
      eventId,
      actorUserId: verified.identity.userId,
      definition: {
        categoryId,
        title: '  TypeScript meetup  ',
        description: 'A practical evening about types.',
        startsAt: new Date('2026-09-10T18:00:00.000Z'),
        endsAt: new Date('2026-09-10T20:00:00.000Z'),
        timezone: 'Europe/Istanbul',
        capacity: 10,
        visibility: 'PUBLIC',
        joinPolicy: 'OPEN',
        location: {
          city: 'Istanbul',
          district: 'Kadikoy',
          venueName: 'Moda Sahne',
          address: null,
          addressVisibility: 'EVENT_VIEWERS',
        },
      },
    };
    const outcome = await events.decide(command);

    expect(outcome).toEqual({
      kind: 'DRAFT_CREATED',
      event: {
        id: eventId,
        organizerId: verified.identity.userId,
        categoryId,
        title: 'TypeScript meetup',
        description: 'A practical evening about types.',
        startsAt: new Date('2026-09-10T18:00:00.000Z'),
        endsAt: new Date('2026-09-10T20:00:00.000Z'),
        timezone: 'Europe/Istanbul',
        capacity: 10,
        confirmedCount: 1,
        visibility: 'PUBLIC',
        joinPolicy: 'OPEN',
        status: 'DRAFT',
        shareToken: null,
        version: 1,
        location: {
          city: 'Istanbul',
          district: 'Kadikoy',
          venueName: 'Moda Sahne',
          address: null,
          addressVisibility: 'EVENT_VIEWERS',
        },
      },
      capacity: { capacity: 10, confirmedCount: 1, availableCount: 9 },
    });
    await expect(events.decide(command)).resolves.toEqual(outcome);

    const unlisted = await events.decide({
      ...command,
      eventId: randomUUID(),
      definition: { ...command.definition, visibility: 'UNLISTED' },
    });
    if (unlisted.kind !== 'DRAFT_CREATED') throw new Error('Expected unlisted draft.');
    expect(unlisted.event.shareToken).toEqual(expect.any(String));
    const pendingInvitationId = randomUUID();
    await dataSource.query(
      "INSERT INTO invitations (id,event_id,recipient_user_id,invited_by_user_id,status,expires_at,updated_by_kind) VALUES ($1,$2,$3,$3,'PENDING','2026-09-11T00:00:00Z','USER')",
      [pendingInvitationId, unlisted.event.id, verified.identity.userId],
    );
    await expect(events.decide({
      kind: 'CANCEL_EVENT', eventId: unlisted.event.id,
      actorUserId: verified.identity.userId, expectedVersion: 1,
    })).resolves.toMatchObject({
      kind: 'EVENT_CANCELLED', event: { id: unlisted.event.id, status: 'CANCELLED', version: 2 },
    });
    await expect(dataSource.query('SELECT status FROM invitations WHERE id = $1', [pendingInvitationId])).resolves.toEqual([{ status: 'REVOKED' }]);
    await expect(events.decide({
      kind: 'CANCEL_EVENT', eventId: unlisted.event.id,
      actorUserId: verified.identity.userId, expectedVersion: 2,
    })).rejects.toMatchObject({ code: 'EVENT_NOT_CANCELLABLE' });
    await expect(events.decide({
      kind: 'REVISE_EVENT', eventId, actorUserId: verified.identity.userId,
      expectedVersion: 0, definition: command.definition,
    })).rejects.toMatchObject({ code: 'EVENT_VERSION_CONFLICT' });
    await expect(events.decide({
      kind: 'REVISE_EVENT', eventId, actorUserId: randomUUID(),
      expectedVersion: 1, definition: command.definition,
    })).rejects.toMatchObject({ code: 'NOT_ORGANIZER' });
    await expect(events.decide({
      kind: 'REVISE_EVENT', eventId, actorUserId: verified.identity.userId,
      expectedVersion: 1,
      definition: { ...command.definition, title: 'Revised TypeScript meetup', location: { ...command.definition.location, district: 'Besiktas' } },
    })).resolves.toMatchObject({
      kind: 'EVENT_REVISED', event: { id: eventId, title: 'Revised TypeScript meetup', version: 2, location: { district: 'Besiktas' } },
    });
    await expect(events.decide({
      kind: 'PUBLISH_EVENT', eventId, actorUserId: verified.identity.userId, expectedVersion: 2,
    })).resolves.toMatchObject({ kind: 'EVENT_PUBLISHED', event: { id: eventId, status: 'PUBLISHED', version: 3 } });
    await expect(events.decide({
      kind: 'PUBLISH_EVENT', eventId, actorUserId: verified.identity.userId, expectedVersion: 2,
    })).rejects.toMatchObject({ code: 'EVENT_VERSION_CONFLICT' });
    await expect(events.decide({
      kind: 'PUBLISH_EVENT', eventId, actorUserId: randomUUID(), expectedVersion: 3,
    })).rejects.toMatchObject({ code: 'NOT_ORGANIZER' });
    const inactiveCategoryId = randomUUID();
    await dataSource.query(`INSERT INTO categories (id, name, slug, is_active, sort_order, created_at, updated_at, updated_by_kind, version) VALUES ($1, 'Archived', 'archived', false, 0, now(), now(), 'SYSTEM', 1)`, [inactiveCategoryId]);
    await expect(events.decide({
      kind: 'REVISE_EVENT', eventId, actorUserId: verified.identity.userId,
      expectedVersion: 3, definition: { ...command.definition, categoryId: inactiveCategoryId },
    })).rejects.toMatchObject({ code: 'CATEGORY_INACTIVE' });
    await dataSource.query('UPDATE events SET confirmed_count = 2 WHERE id = $1', [eventId]);
    await expect(events.decide({
      kind: 'REVISE_EVENT', eventId, actorUserId: verified.identity.userId,
      expectedVersion: 3,
      definition: { ...command.definition, capacity: 1 },
    })).rejects.toMatchObject({ code: 'CAPACITY_BELOW_CONFIRMED_COUNT' });
    await dataSource.query("UPDATE events SET starts_at = '2026-08-28T11:00:00.000Z' WHERE id = $1", [eventId]);
    await expect(events.decide({
      kind: 'REVISE_EVENT', eventId, actorUserId: verified.identity.userId,
      expectedVersion: 3, definition: command.definition,
    })).rejects.toMatchObject({ code: 'EVENT_NOT_EDITABLE' });
    await expect(events.decide({
      kind: 'PUBLISH_EVENT', eventId, actorUserId: verified.identity.userId, expectedVersion: 3,
    })).rejects.toMatchObject({ code: 'EVENT_NOT_PUBLISHABLE' });
    await dataSource.query("UPDATE events SET ends_at = '2026-08-28T11:30:00.000Z' WHERE id = $1", [eventId]);
    await expect(events.decide({ kind: 'COMPLETE_DUE_EVENTS' })).resolves.toEqual({
      kind: 'DUE_EVENTS_COMPLETED', completedEventIds: [eventId],
    });
    await expect(events.decide({ kind: 'COMPLETE_DUE_EVENTS' })).resolves.toEqual({
      kind: 'DUE_EVENTS_COMPLETED', completedEventIds: [],
    });
  });

  it('rejects an overlong timezone as an invalid event definition', async () => {
    const registration = asSessionGrant(await auth.decide({ kind: 'REGISTER', email: 'grace@example.com', password: 'correct-horse-battery-staple', firstName: 'Grace', lastName: 'Hopper' }));
    const verificationSecret = verificationEmails.at(-1)?.verificationSecret;
    if (!verificationSecret) throw new Error('Expected verification email.');
    const verified = await auth.decide({ kind: 'VERIFY_EMAIL', verificationSecret });
    if (verified.kind !== 'EMAIL_VERIFIED') throw new Error('Expected verified identity.');
    const categoryId = randomUUID();
    await dataSource.query(`INSERT INTO categories (id, name, slug, is_active, sort_order, created_at, updated_at, updated_by_kind, version) VALUES ($1, 'Science', 'science', true, 0, now(), now(), 'SYSTEM', 1)`, [categoryId]);

    await expect(events.decide({
      kind: 'CREATE_DRAFT', eventId: randomUUID(), actorUserId: verified.identity.userId,
      definition: { categoryId, title: 'Science meetup', description: 'Talks.', startsAt: new Date('2026-09-10T18:00:00.000Z'), endsAt: new Date('2026-09-10T20:00:00.000Z'), timezone: 'x'.repeat(65), capacity: 1, visibility: 'PUBLIC', joinPolicy: 'OPEN', location: { city: 'Istanbul', district: 'Kadikoy', venueName: null, address: null, addressVisibility: 'EVENT_VIEWERS' } },
    })).rejects.toMatchObject({ code: 'INVALID_EVENT_DEFINITION' });
  });

  it('requires Invite Only for a private event', async () => {
    await expect(events.decide({
      kind: 'CREATE_DRAFT', eventId: randomUUID(), actorUserId: randomUUID(),
      definition: { categoryId: randomUUID(), title: 'Private meetup', description: 'Members only.', startsAt: new Date('2026-09-10T18:00:00.000Z'), endsAt: new Date('2026-09-10T20:00:00.000Z'), timezone: 'Europe/Istanbul', capacity: 1, visibility: 'PRIVATE', joinPolicy: 'OPEN', location: { city: 'Istanbul', district: 'Kadikoy', venueName: null, address: null, addressVisibility: 'EVENT_VIEWERS' } },
    })).rejects.toMatchObject({ code: 'PRIVATE_EVENT_REQUIRES_INVITE_ONLY' });
  });

  it.each([
    ['ends before it starts', new Date('2026-09-10T20:00:00.000Z'), new Date('2026-09-10T18:00:00.000Z'), 1, 'INVALID_EVENT_TIMING'],
    ['has no organizer seat', new Date('2026-09-10T18:00:00.000Z'), new Date('2026-09-10T20:00:00.000Z'), 0, 'INVALID_EVENT_DEFINITION'],
  ])('rejects a draft that %s', async (_description, startsAt, endsAt, capacity, code) => {
    await expect(events.decide({
      kind: 'CREATE_DRAFT', eventId: randomUUID(), actorUserId: randomUUID(),
      definition: { categoryId: randomUUID(), title: 'Invalid meetup', description: 'Invalid.', startsAt, endsAt, timezone: 'Europe/Istanbul', capacity, visibility: 'PUBLIC', joinPolicy: 'OPEN', location: { city: 'Istanbul', district: 'Kadikoy', venueName: null, address: null, addressVisibility: 'EVENT_VIEWERS' } },
    })).rejects.toMatchObject({ code });
  });
});

function asSessionGrant(outcome: Awaited<ReturnType<AuthModule['decide']>>): SessionGrant {
  if (outcome.kind !== 'SESSION_GRANTED') throw new Error('Expected session grant.');
  return outcome;
}
