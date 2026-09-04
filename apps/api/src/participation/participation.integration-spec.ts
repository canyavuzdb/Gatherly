import { DataSource } from 'typeorm';
import { createDatabaseOptions } from '../config/database.config';
import { ParticipationImplementation } from './participation.implementation';
import { CheckInRecord, ParticipationOutcomeRecord } from './participation.persistence';

describe('ParticipationModule', () => {
  let dataSource: DataSource;
  const organizer = 'a1111111-1111-4111-8111-111111111111';
  const guest = 'a2222222-2222-4222-8222-222222222222';
  const noShowGuest = 'a3333333-3333-4333-8333-333333333333';
  const category = 'a4444444-4444-4444-8444-444444444444';
  const event = 'a5555555-5555-4555-8555-555555555555';
  const checkInTime = new Date('2026-09-01T18:15:00.000Z');

  beforeAll(async () => { dataSource = new DataSource(createDatabaseOptions(process.env.DATABASE_URL ?? '')); await dataSource.initialize(); await dataSource.runMigrations(); });
  afterAll(async () => dataSource.destroy());
  beforeEach(async () => {
    await dataSource.query('TRUNCATE participation_outcomes, check_in_records, invitations, attendances, event_locations, events, event_creation_quota_usage, categories, refresh_sessions, email_verification_tokens, password_reset_tokens, profiles, users CASCADE');
    await dataSource.query("INSERT INTO users (id,email,password_hash,email_verified_at,status) VALUES ($1,'checkin-organizer@example.test','x',now(),'ACTIVE'),($2,'checkin-guest@example.test','x',now(),'ACTIVE'),($3,'checkin-noshow@example.test','x',now(),'ACTIVE')", [organizer, guest, noShowGuest]);
    await dataSource.query("INSERT INTO categories (id,name,slug,updated_by_kind) VALUES ($1,'Sports','sports','SYSTEM')", [category]);
    await dataSource.query("INSERT INTO events (id,organizer_id,category_id,title,description,starts_at,ends_at,timezone,capacity,confirmed_count,visibility,join_policy,status,created_by_user_id,updated_by_kind) VALUES ($1,$2,$3,'Run','Morning run','2026-09-01T18:00:00Z','2026-09-01T20:00:00Z','Europe/Istanbul',3,3,'PUBLIC','OPEN','PUBLISHED',$2,'USER')", [event, organizer, category]);
    await dataSource.query("INSERT INTO attendances (event_id,user_id,status,requested_at,confirmed_at,updated_by_user_id,updated_by_kind) VALUES ($1,$2,'CONFIRMED',now(),now(),$2,'USER'),($1,$3,'CONFIRMED',now(),now(),$3,'USER'),($1,$4,'CONFIRMED',now(),now(),$4,'USER')", [event, organizer, guest, noShowGuest]);
  });

  it('records one immutable organizer check-in for a confirmed attendee', async () => {
    const participation = new ParticipationImplementation(dataSource, () => checkInTime);
    const attendance = await dataSource.query('SELECT id FROM attendances WHERE event_id = $1 AND user_id = $2', [event, guest]);
    await expect(participation.decide({ kind: 'RECORD_CHECK_IN', eventId: event, attendanceId: attendance[0].id, actorUserId: organizer })).resolves.toMatchObject({ kind: 'CHECK_IN_RECORDED', checkIn: { attendanceId: attendance[0].id, userId: guest } });
    await expect(participation.decide({ kind: 'RECORD_CHECK_IN', eventId: event, attendanceId: attendance[0].id, actorUserId: organizer })).rejects.toMatchObject({ code: 'CHECK_IN_ALREADY_RECORDED' });
    await expect(dataSource.getRepository(CheckInRecord).countBy({ eventId: event, attendanceId: attendance[0].id, kind: 'CHECKED_IN' })).resolves.toBe(1);
  });

  it('derives attended and no-show outcomes only after the late check-in window ends', async () => {
    const attendance = await dataSource.query('SELECT id FROM attendances WHERE event_id = $1 AND user_id = $2', [event, guest]);
    const checkIn = new ParticipationImplementation(dataSource, () => checkInTime);
    await checkIn.decide({ kind: 'RECORD_CHECK_IN', eventId: event, attendanceId: attendance[0].id, actorUserId: organizer });
    const finalizer = new ParticipationImplementation(dataSource, () => new Date('2026-09-01T22:01:00.000Z'));
    await expect(finalizer.decide({ kind: 'FINALIZE_DUE_PARTICIPATION' })).resolves.toMatchObject({ kind: 'PARTICIPATION_FINALIZED', finalizedEventIds: [event] });
    const outcomes = await dataSource.getRepository(ParticipationOutcomeRecord).find({ where: { eventId: event } });
    expect(outcomes).toEqual(expect.arrayContaining([expect.objectContaining({ userId: guest, outcome: 'ATTENDED' }), expect.objectContaining({ userId: noShowGuest, outcome: 'NO_SHOW' })]));
    await expect(finalizer.decide({ kind: 'FINALIZE_DUE_PARTICIPATION' })).resolves.toMatchObject({ finalizedEventIds: [] });
  });
});
