import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import { createDatabaseOptions } from '../config/database.config';
import { EventsImplementation } from './events.implementation';

describe('Organizer transfers', () => {
  let dataSource: DataSource;
  let events: EventsImplementation;
  const now = new Date('2026-08-28T12:00:00.000Z');

  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error('DATABASE_URL is required for PostgreSQL integration tests.');
    dataSource = new DataSource(createDatabaseOptions(databaseUrl));
    await dataSource.initialize();
    await dataSource.runMigrations();
    events = new EventsImplementation(dataSource, { now: () => now });
  });

  afterAll(async () => { await dataSource?.destroy(); });

  beforeEach(async () => {
    await dataSource.query('TRUNCATE event_organizer_transfers, invitations, attendances, event_locations, events, event_creation_quota_usage, categories, refresh_sessions, email_verification_tokens, password_reset_tokens, profiles, users CASCADE');
  });

  it('hands ownership to a confirmed participant only after acceptance', async () => {
    const [organizer, recipient, categoryId, eventId] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    await dataSource.query("INSERT INTO users (id,email,password_hash,status,email_verified_at,created_at,updated_at,version) VALUES ($1,'organizer@example.com','x','ACTIVE',now(),now(),now(),1),($2,'recipient@example.com','x','ACTIVE',now(),now(),now(),1)", [organizer, recipient]);
    await dataSource.query("INSERT INTO categories (id,name,slug,is_active,sort_order,created_at,updated_at,updated_by_kind,version) VALUES ($1,'Transfer','transfer',true,0,now(),now(),'SYSTEM',1)", [categoryId]);
    await dataSource.query("INSERT INTO events (id,organizer_id,category_id,title,description,starts_at,ends_at,timezone,capacity,confirmed_count,visibility,join_policy,status,created_by_user_id,updated_by_kind,version) VALUES ($1,$2,$3,'Ownership handover','A handover-ready event.','2026-09-10T18:00:00Z','2026-09-10T20:00:00Z','Europe/Istanbul',5,2,'PUBLIC','OPEN','PUBLISHED',$2,'USER',1)", [eventId, organizer, categoryId]);
    await dataSource.query("INSERT INTO event_locations (event_id,city,district,venue_name,address,address_visibility,updated_by_kind,version) VALUES ($1,'Istanbul','Kadikoy',NULL,NULL,'EVENT_VIEWERS','USER',1)", [eventId]);
    await dataSource.query("INSERT INTO attendances (event_id,user_id,status,waitlist_opt_in,requested_at,confirmed_at,updated_by_user_id,updated_by_kind,version) VALUES ($1,$2,'CONFIRMED',false,now(),now(),$2,'USER',1),($1,$3,'CONFIRMED',false,now(),now(),$3,'USER',1)", [eventId, organizer, recipient]);

    const requested = await events.decide({ kind: 'REQUEST_ORGANIZER_TRANSFER', eventId, actorUserId: organizer, recipientUserId: recipient });
    expect(requested.kind).toBe('ORGANIZER_TRANSFER_REQUESTED');
    if (requested.kind !== 'ORGANIZER_TRANSFER_REQUESTED') throw new Error('Expected organizer transfer request.');
    await expect(events.decide({ kind: 'RESPOND_TO_ORGANIZER_TRANSFER', transferId: requested.transferId, actorUserId: recipient, response: 'ACCEPT' })).resolves.toMatchObject({ kind: 'ORGANIZER_TRANSFER_ACCEPTED' });
    await expect(dataSource.query('SELECT organizer_id, confirmed_count FROM events WHERE id = $1', [eventId])).resolves.toEqual([{ organizer_id: recipient, confirmed_count: 2 }]);
    await expect(dataSource.query('SELECT status FROM event_organizer_transfers WHERE id = $1', [requested.transferId])).resolves.toEqual([{ status: 'ACCEPTED' }]);
  });
});
