import { DataSource } from 'typeorm';
import { createDatabaseOptions } from '../config/database.config';
import { InvitationsImplementation } from './invitations.implementation';

describe('InvitationsModule', () => {
  let dataSource: DataSource;
  let invitations: InvitationsImplementation;
  beforeAll(async () => { dataSource = new DataSource(createDatabaseOptions(process.env.DATABASE_URL ?? '')); await dataSource.initialize(); await dataSource.runMigrations(); invitations = new InvitationsImplementation(dataSource, undefined, () => new Date('2026-08-28T12:00:00.000Z')); });
  afterAll(async () => dataSource.destroy());
  beforeEach(async () => { await dataSource.query('TRUNCATE invitations, attendances, event_locations, events, event_creation_quota_usage, categories, refresh_sessions, email_verification_tokens, password_reset_tokens, profiles, users CASCADE'); });

  it('creates, lists, revokes, and renews an invitation without creating another row', async () => {
    const [organizer, recipient, category, event, firstId, secondId] = ['71717171-7171-4717-8717-717171717171','72727272-7272-4727-8727-727272727272','73737373-7373-4737-8737-737373737373','74747474-7474-4747-8747-747474747474','75757575-7575-4757-8757-757575757575','76767676-7676-4767-8767-767676767676'];
    await dataSource.query("INSERT INTO users (id,email,password_hash,email_verified_at,status) VALUES ($1,'inviter@example.test','x',now(),'ACTIVE'),($2,'invitee@example.test','x',now(),'ACTIVE')", [organizer, recipient]);
    await dataSource.query("INSERT INTO categories (id,name,slug,updated_by_kind) VALUES ($1,'Learning','learning','SYSTEM')", [category]);
    await dataSource.query("INSERT INTO events (id,organizer_id,category_id,title,description,starts_at,ends_at,timezone,capacity,confirmed_count,visibility,join_policy,status,created_by_user_id,updated_by_kind) VALUES ($1,$2,$3,'Lesson','Learning','2026-09-01T18:00:00Z','2026-09-01T20:00:00Z','Europe/Istanbul',2,1,'PRIVATE','INVITE_ONLY','PUBLISHED',$2,'USER')", [event, organizer, category]);
    const created = await invitations.decide({ kind: 'CREATE_INVITATION', invitationId: firstId, eventId: event, actorUserId: organizer, recipientUserId: recipient, expiresAt: new Date('2026-09-02T00:00:00Z') });
    expect(created).toMatchObject({ id: firstId, status: 'PENDING' });
    await expect(invitations.decide({ kind: 'LIST_MY_PENDING_INVITATIONS', actorUserId: recipient })).resolves.toMatchObject([{ id: firstId }]);
    await expect(invitations.decide({ kind: 'REVOKE_INVITATION', invitationId: firstId, actorUserId: organizer })).resolves.toMatchObject({ id: firstId, status: 'REVOKED' });
    const renewed = await invitations.decide({ kind: 'CREATE_INVITATION', invitationId: secondId, eventId: event, actorUserId: organizer, recipientUserId: recipient, expiresAt: new Date('2026-09-03T00:00:00Z') });
    expect(renewed).toMatchObject({ id: firstId, status: 'PENDING', version: 3 });
    const count = await dataSource.query('SELECT count(*)::int AS count FROM invitations WHERE event_id = $1 AND recipient_user_id = $2', [event, recipient]);
    expect(count[0].count).toBe(1);
  });
});
