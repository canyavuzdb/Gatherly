import { DataSource } from 'typeorm';
import { createDatabaseOptions } from '../config/database.config';
import { AttendanceImplementation } from './attendance.implementation';
import type { AttendanceModule } from './attendance.interface';
import { MessagingImplementation } from '../messaging/messaging.implementation';
import type { CommittedFact } from '../messaging/messaging.interface';

describe('AttendanceModule request', () => {
  let dataSource: DataSource;
  let attendance: AttendanceModule;
  let publishedFacts: CommittedFact[];
  beforeAll(async () => { dataSource = new DataSource(createDatabaseOptions(process.env.DATABASE_URL ?? '')); await dataSource.initialize(); await dataSource.runMigrations(); attendance = new AttendanceImplementation(dataSource, () => new Date('2026-08-28T12:00:00.000Z'), { publish: async (facts: readonly CommittedFact[]) => { publishedFacts.push(...facts); } } as unknown as MessagingImplementation); });
  afterAll(async () => dataSource.destroy());
  beforeEach(async () => { publishedFacts = []; await dataSource.query('TRUNCATE invitations, attendances, event_locations, events, event_creation_quota_usage, categories, refresh_sessions, email_verification_tokens, password_reset_tokens, profiles, users CASCADE'); });
  it('confirms an RSVP and consumes one capacity seat', async () => {
    const [organizer, guest, secondGuest, category, event] = ['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222','55555555-5555-4555-8555-555555555555','33333333-3333-4333-8333-333333333333','44444444-4444-4444-8444-444444444444'];
    await dataSource.query("INSERT INTO users (id,email,password_hash,email_verified_at,status) VALUES ($1,'organizer@example.test','x',now(),'ACTIVE'),($2,'guest@example.test','x',now(),'ACTIVE'),($3,'second-guest@example.test','x',now(),'ACTIVE')", [organizer, guest, secondGuest]);
    await dataSource.query("INSERT INTO categories (id,name,slug,updated_by_kind) VALUES ($1,'Technology','technology','SYSTEM')", [category]);
    await dataSource.query("INSERT INTO events (id,organizer_id,category_id,title,description,starts_at,ends_at,timezone,capacity,confirmed_count,visibility,join_policy,status,created_by_user_id,updated_by_kind) VALUES ($1,$2,$3,'Meetup','Talks','2026-09-01T18:00:00Z','2026-09-01T20:00:00Z','Europe/Istanbul',2,1,'PUBLIC','OPEN','PUBLISHED',$2,'USER')", [event, organizer, category]);
    await expect(attendance.decide({ kind: 'REQUEST_ATTENDANCE', eventId: event, actorUserId: guest, waitlistOptIn: false })).resolves.toMatchObject({ attendance: { userId: guest, status: 'CONFIRMED' }, capacity: { capacity: 2, confirmedCount: 2, availableCount: 0 } });
    await expect(attendance.decide({ kind: 'REQUEST_ATTENDANCE', eventId: event, actorUserId: secondGuest, waitlistOptIn: true })).rejects.toMatchObject({ code: 'EVENT_AT_CAPACITY' });
    await expect(attendance.decide({ kind: 'ENROLL_WAITLIST', eventId: event, actorUserId: secondGuest })).resolves.toMatchObject({ attendance: { userId: secondGuest, status: 'WAITLISTED' }, capacity: { confirmedCount: 2, availableCount: 0 } });
    await expect(attendance.decide({ kind: 'CANCEL_ATTENDANCE', eventId: event, actorUserId: guest })).resolves.toMatchObject({ attendance: { userId: guest, status: 'CANCELLED' }, capacity: { confirmedCount: 2, availableCount: 0 } });
    expect(publishedFacts).toEqual([expect.objectContaining({ eventName: 'attendance.promoted.v1', payload: expect.objectContaining({ recipientUserId: secondGuest, eventId: event }) })]);
    await expect(attendance.decide({ kind: 'CANCEL_ATTENDANCE', eventId: event, actorUserId: guest })).resolves.toMatchObject({ attendance: { userId: guest, status: 'CANCELLED' }, capacity: { confirmedCount: 2, availableCount: 0 } });
  });
  it('creates a pending RSVP for an Approval Required event without consuming capacity', async () => {
    const [organizer, guest, rejectedGuest, waitlistedGuest, newerWaitlistedGuest, category, event] = ['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','77777777-7777-4777-8777-777777777777','99999999-9999-4999-8999-999999999999','cccccccc-cccc-4ccc-8ccc-cccccccccccc','dddddddd-dddd-4ddd-8ddd-dddddddddddd'];
    await dataSource.query("INSERT INTO users (id,email,password_hash,email_verified_at,status) VALUES ($1,'approval-organizer@example.test','x',now(),'ACTIVE'),($2,'approval-guest@example.test','x',now(),'ACTIVE'),($3,'rejected-guest@example.test','x',now(),'ACTIVE'),($4,'waitlisted-guest@example.test','x',now(),'ACTIVE'),($5,'newer-waitlisted@example.test','x',now(),'ACTIVE')", [organizer, guest, rejectedGuest, waitlistedGuest, newerWaitlistedGuest]);
    await dataSource.query("INSERT INTO categories (id,name,slug,updated_by_kind) VALUES ($1,'Arts','arts','SYSTEM')", [category]);
    await dataSource.query("INSERT INTO events (id,organizer_id,category_id,title,description,starts_at,ends_at,timezone,capacity,confirmed_count,visibility,join_policy,status,created_by_user_id,updated_by_kind) VALUES ($1,$2,$3,'Workshop','Talks','2026-09-01T18:00:00Z','2026-09-01T20:00:00Z','Europe/Istanbul',2,1,'PUBLIC','APPROVAL_REQUIRED','PUBLISHED',$2,'USER')", [event, organizer, category]);
    const pending = await attendance.decide({ kind: 'REQUEST_ATTENDANCE', eventId: event, actorUserId: guest, waitlistOptIn: true });
    expect(pending).toMatchObject({ attendance: { userId: guest, status: 'PENDING' }, capacity: { confirmedCount: 1, availableCount: 1 } });
    expect(publishedFacts).toEqual([expect.objectContaining({ eventName: 'attendance.pending.v1', payload: expect.objectContaining({ recipientUserId: organizer, eventId: event }) })]);
    await expect(attendance.decide({ kind: 'DECIDE_ATTENDANCE', eventId: event, attendanceId: pending.attendance.id, actorUserId: organizer, decision: 'CONFIRM' })).resolves.toMatchObject({ attendance: { userId: guest, status: 'CONFIRMED' }, capacity: { confirmedCount: 2, availableCount: 0 } });
    const rejected = await attendance.decide({ kind: 'REQUEST_ATTENDANCE', eventId: event, actorUserId: rejectedGuest, waitlistOptIn: false });
    await expect(attendance.decide({ kind: 'DECIDE_ATTENDANCE', eventId: event, attendanceId: rejected.attendance.id, actorUserId: organizer, decision: 'CONFIRM' })).rejects.toMatchObject({ code: 'EVENT_AT_CAPACITY' });
    await expect(attendance.decide({ kind: 'DECIDE_ATTENDANCE', eventId: event, attendanceId: rejected.attendance.id, actorUserId: organizer, decision: 'REJECT', rejectionReason: 'Capacity reached.' })).resolves.toMatchObject({ attendance: { userId: rejectedGuest, status: 'REJECTED' }, capacity: { confirmedCount: 2, availableCount: 0 } });
    const waitlisted = await attendance.decide({ kind: 'REQUEST_ATTENDANCE', eventId: event, actorUserId: waitlistedGuest, waitlistOptIn: true });
    await expect(attendance.decide({ kind: 'DECIDE_ATTENDANCE', eventId: event, attendanceId: waitlisted.attendance.id, actorUserId: organizer, decision: 'CONFIRM' })).resolves.toMatchObject({ attendance: { userId: waitlistedGuest, status: 'WAITLISTED' }, capacity: { confirmedCount: 2, availableCount: 0 } });
    await dataSource.query("UPDATE attendances SET waitlisted_at = '2026-08-28T11:00:00.000Z' WHERE id = $1", [waitlisted.attendance.id]);
    const newer = await attendance.decide({ kind: 'REQUEST_ATTENDANCE', eventId: event, actorUserId: newerWaitlistedGuest, waitlistOptIn: true });
    const newerWaitlisted = await attendance.decide({ kind: 'DECIDE_ATTENDANCE', eventId: event, attendanceId: newer.attendance.id, actorUserId: organizer, decision: 'CONFIRM' });
    await expect(attendance.decide({ kind: 'DECIDE_ATTENDANCE', eventId: event, attendanceId: newerWaitlisted.attendance.id, actorUserId: organizer, decision: 'CONFIRM' })).rejects.toMatchObject({ code: 'INVALID_ATTENDANCE_TRANSITION' });
  });
  it('accepts a valid invitation into an Open event with capacity', async () => {
    const [organizer, guest, category, event, invitation] = ['12121212-1212-4212-8212-121212121212','23232323-2323-4232-8232-232323232323','34343434-3434-4343-8343-343434343434','45454545-4545-4545-8454-454545454545','56565656-5656-4565-8565-565656565656'];
    await dataSource.query("INSERT INTO users (id,email,password_hash,email_verified_at,status) VALUES ($1,'invite-organizer@example.test','x',now(),'ACTIVE'),($2,'invite-guest@example.test','x',now(),'ACTIVE')", [organizer, guest]);
    await dataSource.query("INSERT INTO categories (id,name,slug,updated_by_kind) VALUES ($1,'Music','music','SYSTEM')", [category]);
    await dataSource.query("INSERT INTO events (id,organizer_id,category_id,title,description,starts_at,ends_at,timezone,capacity,confirmed_count,visibility,join_policy,status,created_by_user_id,updated_by_kind) VALUES ($1,$2,$3,'Concert','Music','2026-09-01T18:00:00Z','2026-09-01T20:00:00Z','Europe/Istanbul',2,1,'PUBLIC','OPEN','PUBLISHED',$2,'USER')", [event, organizer, category]);
    await dataSource.query("INSERT INTO invitations (id,event_id,recipient_user_id,invited_by_user_id,status,expires_at,updated_by_kind) VALUES ($1,$2,$3,$4,'PENDING','2026-09-02T00:00:00Z','USER')", [invitation,event,guest,organizer]);
    await expect(attendance.decide({ kind: 'ACCEPT_INVITATION', invitationId: invitation, actorUserId: guest, ifFull: 'REJECT' })).resolves.toMatchObject({ attendance: { userId: guest, status: 'CONFIRMED' }, capacity: { confirmedCount: 2, availableCount: 0 } });
  });
  it('accepts an invitation into an Approval Required event as pending', async () => {
    const [organizer, guest, category, event, invitation] = ['67676767-6767-4767-8767-676767676767','78787878-7878-4787-8787-787878787878','89898989-8989-4989-8989-898989898989','abababab-abab-4bab-8bab-abababababab','cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd'];
    await dataSource.query("INSERT INTO users (id,email,password_hash,email_verified_at,status) VALUES ($1,'approval-invite-organizer@example.test','x',now(),'ACTIVE'),($2,'approval-invite-guest@example.test','x',now(),'ACTIVE')", [organizer, guest]);
    await dataSource.query("INSERT INTO categories (id,name,slug,updated_by_kind) VALUES ($1,'Film','film','SYSTEM')", [category]);
    await dataSource.query("INSERT INTO events (id,organizer_id,category_id,title,description,starts_at,ends_at,timezone,capacity,confirmed_count,visibility,join_policy,status,created_by_user_id,updated_by_kind) VALUES ($1,$2,$3,'Screening','Film','2026-09-01T18:00:00Z','2026-09-01T20:00:00Z','Europe/Istanbul',2,1,'PUBLIC','APPROVAL_REQUIRED','PUBLISHED',$2,'USER')", [event,organizer,category]);
    await dataSource.query("INSERT INTO invitations (id,event_id,recipient_user_id,invited_by_user_id,status,expires_at,updated_by_kind) VALUES ($1,$2,$3,$4,'PENDING','2026-09-02T00:00:00Z','USER')", [invitation,event,guest,organizer]);
    await expect(attendance.decide({ kind: 'ACCEPT_INVITATION', invitationId: invitation, actorUserId: guest, ifFull: 'REJECT' })).resolves.toMatchObject({ attendance: { userId: guest, status: 'PENDING' }, capacity: { confirmedCount: 1, availableCount: 1 } });
    expect(publishedFacts).toEqual([expect.objectContaining({ eventName: 'attendance.pending.v1', payload: expect.objectContaining({ recipientUserId: organizer, eventId: event }) })]);
  });
  it('accepts a valid invitation into an Invite Only event', async () => {
    const [organizer, guest, category, event, invitation] = ['dededede-dede-4ede-8ede-dededededede','efefefef-efef-4fef-8fef-efefefefefef','10101010-1010-4010-8010-101010101010','20202020-2020-4020-8020-202020202020','30303030-3030-4030-8030-303030303030'];
    await dataSource.query("INSERT INTO users (id,email,password_hash,email_verified_at,status) VALUES ($1,'only-organizer@example.test','x',now(),'ACTIVE'),($2,'only-guest@example.test','x',now(),'ACTIVE')", [organizer, guest]);
    await dataSource.query("INSERT INTO categories (id,name,slug,updated_by_kind) VALUES ($1,'Games','games','SYSTEM')", [category]);
    await dataSource.query("INSERT INTO events (id,organizer_id,category_id,title,description,starts_at,ends_at,timezone,capacity,confirmed_count,visibility,join_policy,status,created_by_user_id,updated_by_kind) VALUES ($1,$2,$3,'Game night','Games','2026-09-01T18:00:00Z','2026-09-01T20:00:00Z','Europe/Istanbul',2,1,'PRIVATE','INVITE_ONLY','PUBLISHED',$2,'USER')", [event,organizer,category]);
    await dataSource.query("INSERT INTO invitations (id,event_id,recipient_user_id,invited_by_user_id,status,expires_at,updated_by_kind) VALUES ($1,$2,$3,$4,'PENDING','2026-09-02T00:00:00Z','USER')", [invitation,event,guest,organizer]);
    await expect(attendance.decide({ kind: 'ACCEPT_INVITATION', invitationId: invitation, actorUserId: guest, ifFull: 'REJECT' })).resolves.toMatchObject({ attendance: { userId: guest, status: 'CONFIRMED' }, capacity: { confirmedCount: 2, availableCount: 0 } });
  });
  it('lets an invited guest join the waitlist, but not silently exceed a full event', async () => {
    const [organizer, rejectingGuest, waitlistedGuest, category, event, rejectedInvitation, waitlistedInvitation] = ['41414141-4141-4414-8414-414141414141','42424242-4242-4424-8424-424242424242','43434343-4343-4434-8434-434343434343','44444444-4444-4444-8444-444444444444','45454545-4545-4454-8454-454545454545','46464646-4646-4464-8464-464646464646','47474747-4747-4474-8474-474747474747'];
    await dataSource.query("INSERT INTO users (id,email,password_hash,email_verified_at,status) VALUES ($1,'full-organizer@example.test','x',now(),'ACTIVE'),($2,'full-reject@example.test','x',now(),'ACTIVE'),($3,'full-waitlist@example.test','x',now(),'ACTIVE')", [organizer, rejectingGuest, waitlistedGuest]);
    await dataSource.query("INSERT INTO categories (id,name,slug,updated_by_kind) VALUES ($1,'Food','food','SYSTEM')", [category]);
    await dataSource.query("INSERT INTO events (id,organizer_id,category_id,title,description,starts_at,ends_at,timezone,capacity,confirmed_count,visibility,join_policy,status,created_by_user_id,updated_by_kind) VALUES ($1,$2,$3,'Dinner','Food','2026-09-01T18:00:00Z','2026-09-01T20:00:00Z','Europe/Istanbul',1,1,'PUBLIC','OPEN','PUBLISHED',$2,'USER')", [event, organizer, category]);
    await dataSource.query("INSERT INTO invitations (id,event_id,recipient_user_id,invited_by_user_id,status,expires_at,updated_by_kind) VALUES ($1,$3,$4,$2,'PENDING','2026-09-02T00:00:00Z','USER'),($5,$3,$6,$2,'PENDING','2026-09-02T00:00:00Z','USER')", [rejectedInvitation, organizer, event, rejectingGuest, waitlistedInvitation, waitlistedGuest]);
    await expect(attendance.decide({ kind: 'ACCEPT_INVITATION', invitationId: rejectedInvitation, actorUserId: rejectingGuest, ifFull: 'REJECT' })).rejects.toMatchObject({ code: 'EVENT_AT_CAPACITY' });
    await expect(attendance.decide({ kind: 'ACCEPT_INVITATION', invitationId: waitlistedInvitation, actorUserId: waitlistedGuest, ifFull: 'JOIN_WAITLIST' })).resolves.toMatchObject({ attendance: { userId: waitlistedGuest, status: 'WAITLISTED' }, capacity: { confirmedCount: 1, availableCount: 0 } });
  });
  it('rejects expired, revoked, or unauthorised invitation acceptance', async () => {
    const [organizer, recipient, otherUser, category, event, expired, revoked] = ['51515151-5151-4515-8515-515151515151','52525252-5252-4525-8525-525252525252','53535353-5353-4535-8535-535353535353','54545454-5454-4545-8545-545454545454','55555555-5555-4555-8555-555555555555','56565656-5656-4565-8565-565656565656','57575757-5757-4575-8575-575757575757'];
    await dataSource.query("INSERT INTO users (id,email,password_hash,email_verified_at,status) VALUES ($1,'invalid-organizer@example.test','x',now(),'ACTIVE'),($2,'invalid-recipient@example.test','x',now(),'ACTIVE'),($3,'invalid-other@example.test','x',now(),'ACTIVE')", [organizer, recipient, otherUser]);
    await dataSource.query("INSERT INTO categories (id,name,slug,updated_by_kind) VALUES ($1,'Sports','sports','SYSTEM')", [category]);
    await dataSource.query("INSERT INTO events (id,organizer_id,category_id,title,description,starts_at,ends_at,timezone,capacity,confirmed_count,visibility,join_policy,status,created_by_user_id,updated_by_kind) VALUES ($1,$2,$3,'Run','Sports','2026-09-01T18:00:00Z','2026-09-01T20:00:00Z','Europe/Istanbul',2,0,'PUBLIC','OPEN','PUBLISHED',$2,'USER')", [event, organizer, category]);
    await dataSource.query("INSERT INTO invitations (id,event_id,recipient_user_id,invited_by_user_id,status,expires_at,updated_by_kind) VALUES ($1,$3,$4,$2,'PENDING','2026-08-27T00:00:00Z','USER'),($5,$3,$6,$2,'REVOKED','2026-09-02T00:00:00Z','USER')", [expired, organizer, event, recipient, revoked, otherUser]);
    await expect(attendance.decide({ kind: 'ACCEPT_INVITATION', invitationId: expired, actorUserId: recipient, ifFull: 'REJECT' })).rejects.toMatchObject({ code: 'INVALID_ATTENDANCE_TRANSITION' });
    await expect(attendance.decide({ kind: 'ACCEPT_INVITATION', invitationId: revoked, actorUserId: recipient, ifFull: 'REJECT' })).rejects.toMatchObject({ code: 'INVALID_ATTENDANCE_TRANSITION' });
    await expect(attendance.decide({ kind: 'ACCEPT_INVITATION', invitationId: revoked, actorUserId: otherUser, ifFull: 'REJECT' })).rejects.toMatchObject({ code: 'INVALID_ATTENDANCE_TRANSITION' });
  });
  it('serializes concurrent requests for the final seat', async () => {
    const [organizer, firstGuest, secondGuest, category, event] = ['61616161-6161-4616-8616-616161616161','62626262-6262-4626-8626-626262626262','63636363-6363-4636-8636-636363636363','64646464-6464-4646-8646-646464646464','65656565-6565-4656-8656-656565656565'];
    await dataSource.query("INSERT INTO users (id,email,password_hash,email_verified_at,status) VALUES ($1,'race-organizer@example.test','x',now(),'ACTIVE'),($2,'race-first@example.test','x',now(),'ACTIVE'),($3,'race-second@example.test','x',now(),'ACTIVE')", [organizer, firstGuest, secondGuest]);
    await dataSource.query("INSERT INTO categories (id,name,slug,updated_by_kind) VALUES ($1,'Travel','travel','SYSTEM')", [category]);
    await dataSource.query("INSERT INTO events (id,organizer_id,category_id,title,description,starts_at,ends_at,timezone,capacity,confirmed_count,visibility,join_policy,status,created_by_user_id,updated_by_kind) VALUES ($1,$2,$3,'Trip','Travel','2026-09-01T18:00:00Z','2026-09-01T20:00:00Z','Europe/Istanbul',2,1,'PUBLIC','OPEN','PUBLISHED',$2,'USER')", [event, organizer, category]);
    await dataSource.query("INSERT INTO attendances (event_id,user_id,status,requested_at,confirmed_at,updated_by_user_id,updated_by_kind) VALUES ($1,$2,'CONFIRMED',now(),now(),$2,'USER')", [event, organizer]);
    const outcomes = await Promise.allSettled([
      attendance.decide({ kind: 'REQUEST_ATTENDANCE', eventId: event, actorUserId: firstGuest, waitlistOptIn: false }),
      attendance.decide({ kind: 'REQUEST_ATTENDANCE', eventId: event, actorUserId: secondGuest, waitlistOptIn: false }),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === 'rejected')).toHaveLength(1);
    const count = await dataSource.query('SELECT confirmed_count FROM events WHERE id = $1', [event]);
    expect(count[0].confirmed_count).toBe(2);
    const confirmed = await dataSource.query("SELECT count(*)::int AS count FROM attendances WHERE event_id = $1 AND status = 'CONFIRMED'", [event]);
    expect(confirmed[0].count).toBe(2);
  });
});
