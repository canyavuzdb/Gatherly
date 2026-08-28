import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import { createDatabaseOptions } from '../config/database.config';
import { MediaImplementation } from './media.implementation';
import { MediaAssetRecord } from './media.persistence';
import { LocalMediaStorage } from './media.storage';

describe('MediaModule upload image', () => {
  let dataSource: DataSource;
  let storageDirectory: string;
  let media: MediaImplementation;
  const userId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaac';

  beforeAll(async () => {
    dataSource = new DataSource(createDatabaseOptions(process.env.DATABASE_URL ?? ''));
    await dataSource.initialize();
    await dataSource.runMigrations();
    storageDirectory = await mkdtemp(join(tmpdir(), 'gatherly-media-'));
    media = new MediaImplementation(dataSource, new LocalMediaStorage(storageDirectory));
  });

  afterAll(async () => {
    await dataSource.destroy();
    await rm(storageDirectory, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await dataSource.query('TRUNCATE event_media, media_assets, invitations, attendances, event_locations, events, event_creation_quota_usage, categories, refresh_sessions, email_verification_tokens, password_reset_tokens, profiles, users CASCADE');
    await dataSource.query("INSERT INTO users (id,email,password_hash,email_verified_at,status) VALUES ($1,'media-owner@example.test','x',now(),'ACTIVE')", [userId]);
  });

  it('stores inspected image metadata and lets only its owner list the ready asset', async () => {
    const outcome = await media.decide({
      kind: 'UPLOAD_IMAGE',
      actor: { userId, verification: 'VERIFIED' },
      image: { bytes: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9WZ5kAAAAASUVORK5CYII=', 'base64'), declaredMimeType: 'image/jpeg' },
    });
    if (outcome.kind !== 'IMAGE_UPLOADED') throw new Error('Expected an uploaded media asset.');

    expect(outcome).toMatchObject({ kind: 'IMAGE_UPLOADED', mediaAsset: { mimeType: 'image/png', width: 1, height: 1, status: 'READY' } });
    await expect(media.listOwned({ actor: { userId, verification: 'VERIFIED' } })).resolves.toEqual([outcome.mediaAsset]);
    const stored = await dataSource.getRepository(MediaAssetRecord).findOneByOrFail({ id: outcome.mediaAsset.id });
    await expect(new LocalMediaStorage(storageDirectory).read(stored.storageKey)).resolves.toEqual(expect.any(Buffer));
  });

  it('rejects unverified users and invalid bytes without creating assets', async () => {
    await expect(media.decide({ kind: 'UPLOAD_IMAGE', actor: { userId, verification: 'UNVERIFIED' }, image: { bytes: new Uint8Array([1, 2, 3]) } })).rejects.toMatchObject({ code: 'USER_NOT_VERIFIED' });
    await expect(media.decide({ kind: 'UPLOAD_IMAGE', actor: { userId, verification: 'VERIFIED' }, image: { bytes: new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]) } })).rejects.toMatchObject({ code: 'MEDIA_UNSUPPORTED_TYPE' });
    await expect(media.decide({ kind: 'UPLOAD_IMAGE', actor: { userId, verification: 'VERIFIED' }, image: { bytes: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB', 'base64') } })).rejects.toMatchObject({ code: 'MEDIA_INVALID_IMAGE' });
    await expect(dataSource.getRepository(MediaAssetRecord).count()).resolves.toBe(0);
  });

  it('sets an owned ready asset as avatar without deleting the previous asset', async () => {
    await dataSource.query("INSERT INTO profiles (user_id,first_name,last_name,visibility,updated_by_kind,version) VALUES ($1,'Media','Owner','PUBLIC','USER',1)", [userId]);
    const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9WZ5kAAAAASUVORK5CYII=', 'base64');
    const first = await media.decide({ kind: 'UPLOAD_IMAGE', actor: { userId, verification: 'VERIFIED' }, image: { bytes: image } });
    const second = await media.decide({ kind: 'UPLOAD_IMAGE', actor: { userId, verification: 'VERIFIED' }, image: { bytes: image } });
    if (first.kind !== 'IMAGE_UPLOADED' || second.kind !== 'IMAGE_UPLOADED') throw new Error('Expected uploads.');

    await expect(media.decide({ kind: 'SET_PROFILE_AVATAR', actor: { userId, verification: 'VERIFIED' }, mediaAssetId: first.mediaAsset.id })).resolves.toEqual({ kind: 'PROFILE_AVATAR_SET', mediaAssetId: first.mediaAsset.id });
    await expect(media.decide({ kind: 'SET_PROFILE_AVATAR', actor: { userId, verification: 'VERIFIED' }, mediaAssetId: second.mediaAsset.id })).resolves.toEqual({ kind: 'PROFILE_AVATAR_SET', mediaAssetId: second.mediaAsset.id });
    await expect(dataSource.query('SELECT avatar_media_asset_id FROM profiles WHERE user_id = $1', [userId])).resolves.toEqual([{ avatar_media_asset_id: second.mediaAsset.id }]);
    await expect(media.listOwned({ actor: { userId, verification: 'VERIFIED' } })).resolves.toHaveLength(2);
  });

  it('lets an organizer replace cover media and limits the gallery to five assets', async () => {
    const categoryId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
    const eventId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    await dataSource.query("INSERT INTO categories (id,name,slug,is_active,updated_by_kind) VALUES ($1,'Media','media',true,'SYSTEM')", [categoryId]);
    await dataSource.query("INSERT INTO events (id,organizer_id,category_id,title,description,starts_at,ends_at,timezone,capacity,confirmed_count,visibility,join_policy,status,created_by_user_id,updated_by_kind) VALUES ($1,$2,$3,'Media event','Description','2027-09-10T10:00:00Z','2027-09-10T11:00:00Z','Europe/Istanbul',10,1,'PUBLIC','OPEN','DRAFT',$2,'USER')", [eventId, userId, categoryId]);
    const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9WZ5kAAAAASUVORK5CYII=', 'base64');
    const assets = await Promise.all(Array.from({ length: 7 }, async () => {
      const outcome = await media.decide({ kind: 'UPLOAD_IMAGE', actor: { userId, verification: 'VERIFIED' }, image: { bytes: image } });
      if (outcome.kind !== 'IMAGE_UPLOADED') throw new Error('Expected upload.');
      return outcome.mediaAsset;
    }));
    const cover = await media.decide({ kind: 'ATTACH_EVENT_MEDIA', actor: { userId, verification: 'VERIFIED' }, eventId, mediaAssetId: assets[0].id, role: 'COVER', altText: 'Cover' });
    if (cover.kind !== 'EVENT_MEDIA_ATTACHED') throw new Error('Expected cover attachment.');
    await expect(media.decide({ kind: 'ATTACH_EVENT_MEDIA', actor: { userId, verification: 'VERIFIED' }, eventId, mediaAssetId: assets[0].id, role: 'COVER', altText: 'Cover' })).resolves.toEqual(cover);
    await media.decide({ kind: 'ATTACH_EVENT_MEDIA', actor: { userId, verification: 'VERIFIED' }, eventId, mediaAssetId: assets[1].id, role: 'COVER' });
    await expect(dataSource.query("SELECT count(*)::int AS count FROM event_media WHERE event_id = $1 AND role = 'COVER'", [eventId])).resolves.toEqual([{ count: 1 }]);
    for (const asset of assets.slice(2, 7)) await media.decide({ kind: 'ATTACH_EVENT_MEDIA', actor: { userId, verification: 'VERIFIED' }, eventId, mediaAssetId: asset.id, role: 'GALLERY' });
    await expect(media.decide({ kind: 'ATTACH_EVENT_MEDIA', actor: { userId, verification: 'VERIFIED' }, eventId, mediaAssetId: assets[0].id, role: 'GALLERY' })).rejects.toMatchObject({ code: 'GALLERY_LIMIT_REACHED' });
  });

  it('prevents deleting attached media, then detaches and retires it idempotently', async () => {
    const categoryId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    const eventId = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    await dataSource.query("INSERT INTO categories (id,name,slug,is_active,updated_by_kind) VALUES ($1,'Delete media','delete-media',true,'SYSTEM')", [categoryId]);
    await dataSource.query("INSERT INTO events (id,organizer_id,category_id,title,description,starts_at,ends_at,timezone,capacity,confirmed_count,visibility,join_policy,status,created_by_user_id,updated_by_kind) VALUES ($1,$2,$3,'Delete media event','Description','2027-09-10T10:00:00Z','2027-09-10T11:00:00Z','Europe/Istanbul',10,1,'PUBLIC','OPEN','DRAFT',$2,'USER')", [eventId, userId, categoryId]);
    const uploaded = await media.decide({ kind: 'UPLOAD_IMAGE', actor: { userId, verification: 'VERIFIED' }, image: { bytes: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9WZ5kAAAAASUVORK5CYII=', 'base64') } });
    if (uploaded.kind !== 'IMAGE_UPLOADED') throw new Error('Expected upload.');
    const attached = await media.decide({ kind: 'ATTACH_EVENT_MEDIA', actor: { userId, verification: 'VERIFIED' }, eventId, mediaAssetId: uploaded.mediaAsset.id, role: 'GALLERY' });
    if (attached.kind !== 'EVENT_MEDIA_ATTACHED') throw new Error('Expected attachment.');
    await expect(media.decide({ kind: 'DELETE_MEDIA_ASSET', actor: { userId, verification: 'VERIFIED' }, mediaAssetId: uploaded.mediaAsset.id })).rejects.toMatchObject({ code: 'MEDIA_STILL_ATTACHED' });
    await expect(media.decide({ kind: 'DETACH_EVENT_MEDIA', actor: { userId, verification: 'VERIFIED' }, eventMediaId: attached.eventMediaId })).resolves.toEqual({ kind: 'EVENT_MEDIA_DETACHED', eventMediaId: attached.eventMediaId });
    await expect(media.decide({ kind: 'DELETE_MEDIA_ASSET', actor: { userId, verification: 'VERIFIED' }, mediaAssetId: uploaded.mediaAsset.id })).resolves.toEqual({ kind: 'MEDIA_ASSET_DELETED', mediaAssetId: uploaded.mediaAsset.id });
    await expect(media.decide({ kind: 'DELETE_MEDIA_ASSET', actor: { userId, verification: 'VERIFIED' }, mediaAssetId: uploaded.mediaAsset.id })).resolves.toEqual({ kind: 'MEDIA_ASSET_DELETED', mediaAssetId: uploaded.mediaAsset.id });
    await expect(media.listOwned({ actor: { userId, verification: 'VERIFIED' } })).resolves.toEqual([]);
  });

  it('delivers only media reachable through an owner or an authorized event use', async () => {
    const categoryId = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    const publicEvent = '11111111-1111-4111-8111-111111111111';
    const privateEvent = '22222222-2222-4222-8222-222222222222';
    await dataSource.query("INSERT INTO categories (id,name,slug,is_active,updated_by_kind) VALUES ($1,'Open media','open-media',true,'SYSTEM')", [categoryId]);
    for (const [eventId, visibility, joinPolicy] of [[publicEvent, 'PUBLIC', 'OPEN'], [privateEvent, 'PRIVATE', 'INVITE_ONLY']] as const) {
      await dataSource.query("INSERT INTO events (id,organizer_id,category_id,title,description,starts_at,ends_at,timezone,capacity,confirmed_count,visibility,join_policy,status,created_by_user_id,updated_by_kind) VALUES ($1,$2,$3,'Media event','Description','2027-09-10T10:00:00Z','2027-09-10T11:00:00Z','Europe/Istanbul',10,1,$4,$5,'PUBLISHED',$2,'USER')", [eventId, userId, categoryId, visibility, joinPolicy]);
    }
    const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9WZ5kAAAAASUVORK5CYII=', 'base64');
    const publicAsset = await media.decide({ kind: 'UPLOAD_IMAGE', actor: { userId, verification: 'VERIFIED' }, image: { bytes: image } });
    const privateAsset = await media.decide({ kind: 'UPLOAD_IMAGE', actor: { userId, verification: 'VERIFIED' }, image: { bytes: image } });
    if (publicAsset.kind !== 'IMAGE_UPLOADED' || privateAsset.kind !== 'IMAGE_UPLOADED') throw new Error('Expected uploads.');
    await media.decide({ kind: 'ATTACH_EVENT_MEDIA', actor: { userId, verification: 'VERIFIED' }, eventId: publicEvent, mediaAssetId: publicAsset.mediaAsset.id, role: 'COVER' });
    await media.decide({ kind: 'ATTACH_EVENT_MEDIA', actor: { userId, verification: 'VERIFIED' }, eventId: privateEvent, mediaAssetId: privateAsset.mediaAsset.id, role: 'COVER' });
    await expect(media.open({ mediaAssetId: publicAsset.mediaAsset.id, viewer: null })).resolves.toMatchObject({ mimeType: 'image/png', bytes: image });
    await expect(media.open({ mediaAssetId: privateAsset.mediaAsset.id, viewer: null })).rejects.toMatchObject({ code: 'MEDIA_NOT_VIEWABLE' });
    await expect(media.open({ mediaAssetId: privateAsset.mediaAsset.id, viewer: { userId, verification: 'VERIFIED' } })).resolves.toMatchObject({ mimeType: 'image/png' });
  });
});
