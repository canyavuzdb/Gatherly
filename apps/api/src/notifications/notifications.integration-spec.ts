import { DataSource } from 'typeorm';
import { createDatabaseOptions } from '../config/database.config';
import { NotificationsImplementation } from './notifications.implementation';

describe('NotificationsModule', () => {
  let database: DataSource;
  let notifications: NotificationsImplementation;
  const user = '91919191-9191-4919-8919-919191919191';
  const organizer = '92929292-9292-4929-8929-929292929292';
  const category = '93939393-9393-4939-8939-939393939393';
  const event = '94949494-9494-4949-8949-949494949494';
  const actor = { userId: user, verification: 'VERIFIED' as const };

  beforeAll(async () => {
    database = new DataSource(createDatabaseOptions(process.env.DATABASE_URL ?? ''));
    await database.initialize();
    await database.runMigrations();
    notifications = new NotificationsImplementation(database);
  });

  afterAll(async () => database.destroy());

  beforeEach(async () => {
    await database.query('TRUNCATE notifications, invitations, attendances, event_locations, events, event_creation_quota_usage, categories, refresh_sessions, email_verification_tokens, password_reset_tokens, profiles, users CASCADE');
    await database.query("INSERT INTO users (id,email,password_hash,email_verified_at,status) VALUES ($1,'user@test','x',now(),'ACTIVE'),($2,'organizer@test','x',now(),'ACTIVE')", [user, organizer]);
    await database.query("INSERT INTO categories (id,name,slug,updated_by_kind) VALUES ($1,'News','news','SYSTEM')", [category]);
    await database.query("INSERT INTO events (id,organizer_id,category_id,title,description,starts_at,ends_at,timezone,capacity,confirmed_count,visibility,join_policy,status,created_by_user_id,updated_by_kind) VALUES ($1,$2,$3,'Event','Description','2026-09-01T18:00:00Z','2026-09-01T20:00:00Z','Europe/Istanbul',2,1,'PUBLIC','OPEN','PUBLISHED',$2,'USER')", [event, organizer, category]);
  });

  it('pages notifications with a user-bound cursor', async () => {
    for (const id of ['one', 'two', 'three']) {
      await notifications.consume({ messageId: id, eventName: 'invitation.received.v1', payload: { recipientUserId: user, eventId: event, title: id, body: id } });
    }
    const first = await notifications.list({ actor, limit: 2 });
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).toEqual(expect.any(String));
    await expect(notifications.list({ actor, before: first.nextCursor, limit: 2 })).resolves.toMatchObject({ items: [{}] });
    await expect(notifications.list({ actor: { userId: organizer, verification: 'VERIFIED' }, before: first.nextCursor })).rejects.toMatchObject({ code: 'INVALID_NOTIFICATION_CURSOR' });
    await expect(notifications.list({ actor, limit: 51 })).rejects.toMatchObject({ code: 'INVALID_PAGE_LIMIT' });
  });

  it('maps pending attendance to an organizer request notification exactly once', async () => {
    const delivery = { messageId: 'pending-attendance-1', eventName: 'attendance.pending.v1' as const, payload: { recipientUserId: organizer, eventId: event, title: 'Attendance request', body: 'A guest requested to join your event.' } };
    const realtime = { emit: jest.fn().mockResolvedValue(undefined) };
    const withRealtime = new NotificationsImplementation(database, undefined, realtime);
    await expect(withRealtime.consume(delivery)).resolves.toEqual({ created: true });
    await expect(withRealtime.consume(delivery)).resolves.toEqual({ created: false });
    expect(realtime.emit).toHaveBeenCalledTimes(2);
    expect(realtime.emit).toHaveBeenNthCalledWith(1, { kind: 'NOTIFICATIONS_CHANGED', recipientUserId: organizer });
    expect(realtime.emit).toHaveBeenNthCalledWith(2, { kind: 'USER_EVENT_CHANGED', recipientUserId: organizer, eventId: event, change: 'ATTENDANCE' });
    await expect(notifications.list({ actor: { userId: organizer, verification: 'VERIFIED' } })).resolves.toMatchObject({ unreadCount: 1, items: [{ type: 'ATTENDANCE_REQUESTED', payload: { eventId: event } }] });
  });

  it('does not turn event completion into a notification', async () => {
    await expect(notifications.consume({
      messageId: 'event-completed-1', eventName: 'event.completed.v1',
      payload: { recipientUserId: organizer, eventId: event, title: 'Event completed', body: 'This event has ended.' },
    })).resolves.toEqual({ created: false });
    await expect(notifications.list({ actor: { userId: organizer, verification: 'VERIFIED' } })).resolves.toMatchObject({ unreadCount: 0, items: [] });
  });

  it('marks only its own notifications read and makes mark-all idempotent', async () => {
    for (const id of ['first', 'second']) {
      await notifications.consume({ messageId: id, eventName: 'invitation.received.v1', payload: { recipientUserId: user, eventId: event, title: id, body: id } });
    }
    await notifications.consume({ messageId: 'organizer', eventName: 'invitation.received.v1', payload: { recipientUserId: organizer, eventId: event, title: 'Organizer', body: 'Organizer' } });
    const page = await notifications.list({ actor });
    await expect(notifications.decide({ kind: 'MARK_NOTIFICATION_READ', actor, notificationId: page.items[0].id })).resolves.toEqual({ kind: 'NOTIFICATION_READ' });
    await expect(notifications.decide({ kind: 'MARK_NOTIFICATION_READ', actor, notificationId: page.items[0].id })).resolves.toEqual({ kind: 'NOTIFICATION_READ' });
    const organizerPage = await notifications.list({ actor: { userId: organizer, verification: 'VERIFIED' } });
    await expect(notifications.decide({ kind: 'MARK_NOTIFICATION_READ', actor, notificationId: organizerPage.items[0].id })).rejects.toMatchObject({ code: 'NOTIFICATION_NOT_FOUND_OR_NOT_OWNED' });
    await expect(notifications.decide({ kind: 'MARK_ALL_NOTIFICATIONS_READ', actor })).resolves.toEqual({ kind: 'NOTIFICATIONS_READ' });
    await expect(notifications.decide({ kind: 'MARK_ALL_NOTIFICATIONS_READ', actor })).resolves.toEqual({ kind: 'NOTIFICATIONS_READ' });
    await expect(notifications.list({ actor })).resolves.toMatchObject({ unreadCount: 0 });
  });
});
