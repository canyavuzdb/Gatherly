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
    const coverAsset = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaad';
    const galleryOne = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc';
    const galleryTwo = 'cccccccc-cccc-4ccc-8ccc-cccccccccccd';
    for (const assetId of [coverAsset, galleryOne, galleryTwo]) await dataSource.query("INSERT INTO media_assets (id,owner_user_id,storage_key,mime_type,byte_size,width,height,status,updated_by_user_id,updated_by_kind) VALUES ($1,$2,$3,'image/png',1,1,1,'READY',$2,'USER')", [assetId, organizer, `${assetId}.png`]);
    await dataSource.query("INSERT INTO event_media (event_id,media_asset_id,role,position,added_by_user_id,updated_by_user_id,updated_by_kind) VALUES ($1,$2,'COVER',0,$3,$3,'USER'),($1,$4,'GALLERY',0,$3,$3,'USER'),($1,$5,'GALLERY',1,$3,$3,'USER')", [first, coverAsset, organizer, galleryOne, galleryTwo]);
    const page = await discovery.discover({ viewer: { userId: viewer, verification: 'VERIFIED' }, city: 'Istanbul', limit: 1 });
    expect(page.items).toMatchObject([{ id: first, ownAttendanceStatus: 'CONFIRMED', coverMediaAssetId: coverAsset }]);
    expect(page.activeCategories).toEqual([{ id: activeCategory, name: 'Active' }]);
    expect(page.nextCursor).toEqual(expect.any(String));
    await expect(discovery.discover({ viewer: null, city: 'Istanbul', limit: 1, after: page.nextCursor })).resolves.toMatchObject({ items: [{ id: second, category: { isActive: false } }] });
    await expect(discovery.discover({ viewer: null, city: 'Ankara', limit: 1, after: page.nextCursor })).rejects.toMatchObject({ code: 'INVALID_DISCOVERY_CURSOR' });
    await expect(discovery.open({ viewer: null, eventId: first })).resolves.toMatchObject({ id: first, coverMediaAssetId: coverAsset, galleryMediaAssetIds: [galleryOne, galleryTwo], location: { address: 'Secret address' }, joinAvailable: false });
    await expect(discovery.open({ viewer: { userId: viewer, verification: 'VERIFIED' }, eventId: privateEvent })).rejects.toMatchObject({ code: 'EVENT_NOT_FOUND_OR_NOT_VIEWABLE' });
    await expect(discovery.personalCalendar({ actor: { userId: viewer, verification: 'VERIFIED' } })).resolves.toMatchObject({ items: [{ id: first, relationship: 'ATTENDEE' }] });
  });

  it('enforces detail access and reveals confirmed-attendee addresses only to eligible viewers', async () => {
    const [organizer, invitee, attendee, stranger, category, unlisted, privateEvent, draft, cancelled] = [
      '91919191-9191-4919-8919-919191919191', '92929292-9292-4929-8929-929292929292',
      '93939393-9393-4939-8939-939393939393', '94949494-9494-4949-8949-949494949494',
      '95959595-9595-4959-8959-959595959595', '96969696-9696-4969-8969-969696969696',
      '97979797-9797-4979-8979-979797979797', '98989898-9898-4989-8989-989898989898',
      '99999999-9999-4999-8999-999999999999',
    ];
    await dataSource.query("INSERT INTO users (id,email,password_hash,email_verified_at,status) VALUES ($1,'organizer@example.test','x',now(),'ACTIVE'),($2,'invitee@example.test','x',now(),'ACTIVE'),($3,'attendee@example.test','x',now(),'ACTIVE'),($4,'stranger@example.test','x',now(),'ACTIVE')", [organizer, invitee, attendee, stranger]);
    await dataSource.query("INSERT INTO categories (id,name,slug,is_active,updated_by_kind) VALUES ($1,'Privacy','privacy',true,'SYSTEM')", [category]);
    const create = async (id: string, visibility: 'PUBLIC' | 'UNLISTED' | 'PRIVATE', status: 'DRAFT' | 'PUBLISHED' | 'CANCELLED', shareToken: string | null = null) => {
      await dataSource.query("INSERT INTO events (id,organizer_id,category_id,title,description,starts_at,ends_at,timezone,capacity,confirmed_count,visibility,join_policy,status,share_token,created_by_user_id,updated_by_kind) VALUES ($1,$2,$3,'Privacy event','Description','2026-09-10T10:00:00Z','2026-09-10T11:00:00Z','Europe/Istanbul',10,1,$4,$5,$6,$7,$2,'USER')", [id, organizer, category, visibility, visibility === 'PRIVATE' ? 'INVITE_ONLY' : 'OPEN', status, shareToken]);
      await dataSource.query("INSERT INTO event_locations (event_id,city,district,address,address_visibility,updated_by_kind) VALUES ($1,'Istanbul','Kadikoy','Only confirmed attendees see this','CONFIRMED_ATTENDEES','USER')", [id]);
    };
    const shareToken = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaab';
    await create(unlisted, 'UNLISTED', 'PUBLISHED', shareToken);
    await create(privateEvent, 'PRIVATE', 'PUBLISHED');
    await create(draft, 'PUBLIC', 'DRAFT');
    await create(cancelled, 'PUBLIC', 'CANCELLED');
    await dataSource.query("INSERT INTO invitations (id,event_id,recipient_user_id,invited_by_user_id,status,expires_at,updated_by_kind) VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',$1,$2,$3,'PENDING','2026-09-09T00:00:00Z','USER')", [privateEvent, invitee, organizer]);
    await dataSource.query("INSERT INTO attendances (event_id,user_id,status,waitlist_opt_in,requested_at,confirmed_at,updated_by_user_id,updated_by_kind) VALUES ($1,$2,'CONFIRMED',false,now(),now(),$2,'USER')", [privateEvent, attendee]);

    await expect(discovery.open({ viewer: null, eventId: unlisted })).rejects.toMatchObject({ code: 'EVENT_NOT_FOUND_OR_NOT_VIEWABLE' });
    await expect(discovery.open({ viewer: null, eventId: unlisted, shareToken })).resolves.toMatchObject({ location: { address: null } });
    await expect(discovery.open({ viewer: { userId: invitee, verification: 'VERIFIED' }, eventId: privateEvent })).resolves.toMatchObject({ id: privateEvent, location: { address: null }, joinAvailable: true });
    await expect(discovery.open({ viewer: { userId: attendee, verification: 'VERIFIED' }, eventId: privateEvent })).resolves.toMatchObject({ id: privateEvent, location: { address: 'Only confirmed attendees see this' }, ownAttendanceStatus: 'CONFIRMED' });
    await expect(discovery.open({ viewer: { userId: stranger, verification: 'VERIFIED' }, eventId: privateEvent })).rejects.toMatchObject({ code: 'EVENT_NOT_FOUND_OR_NOT_VIEWABLE' });
    await expect(discovery.open({ viewer: { userId: organizer, verification: 'VERIFIED' }, eventId: draft })).resolves.toMatchObject({ id: draft });
    await expect(discovery.open({ viewer: null, eventId: draft })).rejects.toMatchObject({ code: 'EVENT_NOT_FOUND_OR_NOT_VIEWABLE' });
    await expect(discovery.open({ viewer: null, eventId: cancelled })).resolves.toMatchObject({ id: cancelled, joinAvailable: false });
  });

  it('builds a future personal calendar from organizer and attendee paths without duplicates', async () => {
    const [user, organizer, category, organizerDraft, organizerCancelled, sharedEvent, attendeeEvent, pastEvent] = [
      '31313131-3131-4313-8313-313131313131', '32323232-3232-4323-8323-323232323232',
      '33333333-3333-4333-8333-333333333333', '34343434-3434-4343-8343-343434343434',
      '35353535-3535-4353-8353-353535353535', '36363636-3636-4363-8363-363636363636',
      '37373737-3737-4373-8373-373737373737', '38383838-3838-4383-8383-383838383838',
    ];
    await dataSource.query("INSERT INTO users (id,email,password_hash,email_verified_at,status) VALUES ($1,'calendar-user@example.test','x',now(),'ACTIVE'),($2,'calendar-organizer@example.test','x',now(),'ACTIVE')", [user, organizer]);
    await dataSource.query("INSERT INTO categories (id,name,slug,is_active,updated_by_kind) VALUES ($1,'Calendar','calendar',true,'SYSTEM')", [category]);
    const create = async (eventId: string, eventOrganizer: string, status: 'DRAFT' | 'PUBLISHED' | 'CANCELLED' | 'COMPLETED', startsAt: string) => {
      await dataSource.query("INSERT INTO events (id,organizer_id,category_id,title,description,starts_at,ends_at,timezone,capacity,confirmed_count,visibility,join_policy,status,created_by_user_id,updated_by_kind) VALUES ($1,$2,$3,'Calendar event','Description',$4,$5,'Europe/Istanbul',10,1,'PUBLIC','OPEN',$6,$2,'USER')", [eventId, eventOrganizer, category, startsAt, new Date(new Date(startsAt).getTime() + 3_600_000).toISOString(), status]);
      await dataSource.query("INSERT INTO event_locations (event_id,city,district,address_visibility,updated_by_kind) VALUES ($1,'Istanbul','Kadikoy','EVENT_VIEWERS','USER')", [eventId]);
    };
    await create(organizerDraft, user, 'DRAFT', '2026-09-01T10:00:00Z');
    await create(organizerCancelled, user, 'CANCELLED', '2026-09-02T10:00:00Z');
    await create(sharedEvent, user, 'PUBLISHED', '2026-09-03T10:00:00Z');
    await create(attendeeEvent, organizer, 'PUBLISHED', '2026-09-04T10:00:00Z');
    await create(pastEvent, organizer, 'PUBLISHED', '2026-08-27T10:00:00Z');
    for (const eventId of [sharedEvent, attendeeEvent, pastEvent]) await dataSource.query("INSERT INTO attendances (event_id,user_id,status,waitlist_opt_in,requested_at,confirmed_at,updated_by_user_id,updated_by_kind) VALUES ($1,$2,'CONFIRMED',false,now(),now(),$2,'USER')", [eventId, user]);

    const firstPage = await discovery.personalCalendar({ actor: { userId: user, verification: 'VERIFIED' }, limit: 2 });
    expect(firstPage.items).toMatchObject([{ id: organizerDraft, relationship: 'ORGANIZER' }, { id: organizerCancelled, relationship: 'ORGANIZER', status: 'CANCELLED' }]);
    expect(firstPage.nextCursor).toEqual(expect.any(String));
    const secondPage = await discovery.personalCalendar({ actor: { userId: user, verification: 'VERIFIED' }, after: firstPage.nextCursor });
    expect(secondPage.items).toMatchObject([{ id: sharedEvent, relationship: 'ORGANIZER' }, { id: attendeeEvent, relationship: 'ATTENDEE' }]);
    expect([...firstPage.items, ...secondPage.items].map((item) => item.id)).not.toContain(pastEvent);
    await expect(discovery.personalCalendar({ actor: { userId: organizer, verification: 'VERIFIED' }, after: firstPage.nextCursor })).rejects.toMatchObject({ code: 'INVALID_DISCOVERY_CURSOR' });
  });
});
