import { DataSource } from 'typeorm';
import { createDatabaseOptions } from '../config/database.config';
import { EventDiscoveryImplementation } from './event-discovery.implementation';

describe('EventDiscoveryModule discover', () => {
  let dataSource: DataSource;
  let discovery: EventDiscoveryImplementation;
  beforeAll(async () => { dataSource = new DataSource(createDatabaseOptions(process.env.DATABASE_URL ?? '')); await dataSource.initialize(); await dataSource.runMigrations(); discovery = new EventDiscoveryImplementation(dataSource, () => new Date('2026-08-28T12:00:00.000Z')); });
  afterAll(async () => dataSource.destroy());
  beforeEach(async () => { await dataSource.query('TRUNCATE invitations, attendances, event_locations, events, event_creation_quota_usage, categories, refresh_sessions, email_verification_tokens, password_reset_tokens, profiles, users CASCADE'); });
  it('returns only matching future public events in cursor order with the viewer own attendance', async () => {
    const [viewer, organizer, activeCategory, inactiveCategory, first, second, privateEvent, pastEvent] = ['81818181-8181-4818-8818-818181818181','82828282-8282-4828-8828-828282828282','83838383-8383-4838-8838-838383838383','84848484-8484-4848-8848-848484848484','85858585-8585-4858-8858-858585858585','86868686-8686-4868-8868-868686868686','87878787-8787-4878-8878-878787878787','88888888-8888-4888-8888-888888888888'];
    await dataSource.query("INSERT INTO users (id,email,password_hash,email_verified_at,status) VALUES ($1,'viewer@example.test','x',now(),'ACTIVE'),($2,'discover-organizer@example.test','x',now(),'ACTIVE')", [viewer, organizer]);
    await dataSource.query("INSERT INTO categories (id,name,slug,is_active,updated_by_kind) VALUES ($1,'Active','active',true,'SYSTEM'),($2,'Inactive','inactive',false,'SYSTEM')", [activeCategory, inactiveCategory]);
    const create = async (id: string, category: string, startsAt: string, visibility = 'PUBLIC') => dataSource.query("INSERT INTO events (id,organizer_id,category_id,title,description,starts_at,ends_at,timezone,capacity,confirmed_count,visibility,join_policy,status,created_by_user_id,updated_by_kind) VALUES ($1,$2,$3,'Event','Description',$4,$5,'Europe/Istanbul',10,1,$6,$7,'PUBLISHED',$2,'USER')", [id, organizer, category, startsAt, new Date(new Date(startsAt).getTime() + 3_600_000).toISOString(), visibility, visibility === 'PRIVATE' ? 'INVITE_ONLY' : 'OPEN']);
    for (const [id, category, startsAt, visibility] of [[first, activeCategory, '2026-09-01T10:00:00Z', 'PUBLIC'], [second, inactiveCategory, '2026-09-02T10:00:00Z', 'PUBLIC'], [privateEvent, activeCategory, '2026-09-03T10:00:00Z', 'PRIVATE'], [pastEvent, activeCategory, '2026-08-27T10:00:00Z', 'PUBLIC']] as const) { await create(id, category, startsAt, visibility); await dataSource.query("INSERT INTO event_locations (event_id,city,district,address,address_visibility,updated_by_kind) VALUES ($1,'Istanbul','Kadikoy','Secret address','EVENT_VIEWERS','USER')", [id]); }
    await dataSource.query("INSERT INTO attendances (event_id,user_id,status,waitlist_opt_in,requested_at,confirmed_at,updated_by_user_id,updated_by_kind) VALUES ($1,$2,'CONFIRMED',false,now(),now(),$2,'USER')", [first, viewer]);
    const page = await discovery.discover({ viewer: { userId: viewer, verification: 'VERIFIED' }, city: 'Istanbul', limit: 1 });
    expect(page.items).toMatchObject([{ id: first, ownAttendanceStatus: 'CONFIRMED' }]);
    expect(page.activeCategories).toEqual([{ id: activeCategory, name: 'Active' }]);
    expect(page.nextCursor).toEqual(expect.any(String));
    await expect(discovery.discover({ viewer: null, city: 'Istanbul', limit: 1, after: page.nextCursor })).resolves.toMatchObject({ items: [{ id: second, category: { isActive: false } }] });
    await expect(discovery.open({ viewer: null, eventId: first })).resolves.toMatchObject({ id: first, location: { address: 'Secret address' }, joinAvailable: false });
    await expect(discovery.open({ viewer: { userId: viewer, verification: 'VERIFIED' }, eventId: privateEvent })).rejects.toMatchObject({ code: 'EVENT_NOT_FOUND_OR_NOT_VIEWABLE' });
    await expect(discovery.personalCalendar({ actor: { userId: viewer, verification: 'VERIFIED' } })).resolves.toMatchObject({ items: [{ id: first, relationship: 'ATTENDEE' }] });
  });
});
