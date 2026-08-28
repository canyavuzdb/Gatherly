import { randomUUID } from 'node:crypto';
import { DataSource, EntityManager } from 'typeorm';
import { UserRecord } from '../auth/auth.persistence';
import { ProfileRecord } from '../auth/auth.persistence';
import { EventRecord } from '../events/events.persistence';
import { AttendanceRecord, InvitationRecord } from '../events/events.persistence';
import { MediaBusinessError } from './media.errors';
import type { MediaCommand, MediaIdentity, MediaModule, MediaOutcome, OpenedMedia, OwnedMediaAsset } from './media.interface';
import { EventMediaRecord, MediaAssetRecord } from './media.persistence';
import type { MediaStorage } from './media.storage';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
type InspectedImage = { mimeType: 'image/jpeg' | 'image/png' | 'image/webp'; width: number; height: number; extension: 'jpeg' | 'png' | 'webp' };

export class MediaImplementation implements MediaModule {
  constructor(private readonly dataSource: DataSource, private readonly storage: MediaStorage) {}

  async decide(command: MediaCommand): Promise<MediaOutcome> {
    if (command.kind === 'UPLOAD_IMAGE') return this.upload(command);
    if (command.kind === 'ATTACH_EVENT_MEDIA') return this.attachEventMedia(command);
    if (command.kind === 'DETACH_EVENT_MEDIA') return this.detachEventMedia(command);
    if (command.kind === 'DELETE_MEDIA_ASSET') return this.deleteMediaAsset(command);
    return this.setProfileAvatar(command);
  }

  async listOwned(request: { actor: MediaIdentity }): Promise<OwnedMediaAsset[]> {
    const assets = await this.dataSource.getRepository(MediaAssetRecord).find({
      where: { ownerUserId: request.actor.userId, status: 'READY' },
      order: { createdAt: 'DESC', id: 'DESC' },
    });
    return assets.map((asset) => this.view(asset));
  }

  async open(request: { mediaAssetId: string; viewer: MediaIdentity | null; eventShareToken?: string }): Promise<OpenedMedia> {
    const asset = await this.dataSource.getRepository(MediaAssetRecord).findOneBy({ id: request.mediaAssetId });
    if (!asset || asset.status !== 'READY') throw new MediaBusinessError('MEDIA_NOT_VIEWABLE');
    if (!await this.canView(asset, request.viewer, request.eventShareToken)) throw new MediaBusinessError('MEDIA_NOT_VIEWABLE');
    try {
      return { mimeType: asset.mimeType, byteSize: asset.byteSize, bytes: await this.storage.read(asset.storageKey) };
    } catch {
      throw new MediaBusinessError('MEDIA_NOT_VIEWABLE');
    }
  }

  /** Trusted internal seam for Auth self-deletion; it is intentionally not part of MediaModule. */
  async retireOwnedAssetsInTransaction(manager: EntityManager, userId: string, now: Date): Promise<string[]> {
    const assets = await manager.getRepository(MediaAssetRecord).findBy({ ownerUserId: userId });
    if (assets.length === 0) return [];
    await manager.getRepository(EventMediaRecord).createQueryBuilder().delete().where('media_asset_id IN (:...assetIds)', { assetIds: assets.map((asset) => asset.id) }).execute();
    for (const asset of assets) {
      if (asset.status === 'DELETED') continue;
      asset.status = 'DELETED'; asset.deletedAt = now; asset.deletedByUserId = userId;
      asset.updatedByUserId = userId; asset.updatedByKind = 'USER'; asset.version += 1;
    }
    await manager.save(assets);
    return assets.map((asset) => asset.storageKey);
  }

  async removeRetiredFiles(storageKeys: string[]): Promise<void> {
    await Promise.all(storageKeys.map(async (storageKey) => {
      try { await this.storage.remove(storageKey); } catch { /* A later cleanup may retry an inaccessible deleted file. */ }
    }));
  }

  private async upload(command: MediaCommand): Promise<MediaOutcome> {
    if (command.kind !== 'UPLOAD_IMAGE') throw new Error('Unexpected media command.');
    await this.requireVerifiedActiveUser(command.actor);
    if (command.image.bytes.byteLength > MAX_IMAGE_BYTES) throw new MediaBusinessError('MEDIA_TOO_LARGE');
    const inspected = inspectImage(command.image.bytes);
    const storageKey = `${randomUUID()}.${inspected.extension}`;
    await this.storage.put(storageKey, command.image.bytes);
    try {
      const asset = this.dataSource.getRepository(MediaAssetRecord).create({
        ownerUserId: command.actor.userId,
        storageKey,
        mimeType: inspected.mimeType,
        byteSize: command.image.bytes.byteLength,
        width: inspected.width,
        height: inspected.height,
        status: 'READY',
        updatedByUserId: command.actor.userId,
        updatedByKind: 'USER',
        deletedAt: null,
        deletedByUserId: null,
        version: 1,
      });
      await this.dataSource.getRepository(MediaAssetRecord).save(asset);
      return { kind: 'IMAGE_UPLOADED', mediaAsset: this.view(asset) };
    } catch (error) {
      await this.storage.remove(storageKey);
      throw error;
    }
  }

  private async setProfileAvatar(command: Extract<MediaCommand, { kind: 'SET_PROFILE_AVATAR' }>): Promise<MediaOutcome> {
    await this.requireVerifiedActiveUser(command.actor);
    await this.dataSource.transaction(async (manager) => {
      const asset = await manager.getRepository(MediaAssetRecord).findOneBy({ id: command.mediaAssetId });
      if (!asset) throw new MediaBusinessError('MEDIA_NOT_FOUND');
      if (asset.ownerUserId !== command.actor.userId) throw new MediaBusinessError('MEDIA_NOT_OWNED');
      if (asset.status !== 'READY') throw new MediaBusinessError('MEDIA_NOT_READY');
      const profile = await manager.getRepository(ProfileRecord).findOneBy({ userId: command.actor.userId });
      if (!profile) throw new MediaBusinessError('MEDIA_NOT_FOUND');
      if (profile.avatarMediaAssetId === asset.id) return;
      profile.avatarMediaAssetId = asset.id;
      profile.updatedByUserId = command.actor.userId;
      profile.updatedByKind = 'USER';
      profile.version += 1;
      await manager.save(profile);
    });
    return { kind: 'PROFILE_AVATAR_SET', mediaAssetId: command.mediaAssetId };
  }

  private async attachEventMedia(command: Extract<MediaCommand, { kind: 'ATTACH_EVENT_MEDIA' }>): Promise<MediaOutcome> {
    await this.requireVerifiedActiveUser(command.actor);
    const altText = command.altText?.trim() || null;
    if (altText && altText.length > 250) throw new MediaBusinessError('INVALID_ALT_TEXT');
    return this.dataSource.transaction(async (manager) => {
      const event = await manager.getRepository(EventRecord).findOneBy({ id: command.eventId });
      if (!event) throw new MediaBusinessError('EVENT_NOT_FOUND');
      if (event.organizerId !== command.actor.userId) throw new MediaBusinessError('EVENT_ORGANIZER_REQUIRED');
      if (!['DRAFT', 'PUBLISHED'].includes(event.status) || event.startsAt <= new Date()) throw new MediaBusinessError('EVENT_MEDIA_NOT_EDITABLE');
      const asset = await manager.getRepository(MediaAssetRecord).findOneBy({ id: command.mediaAssetId });
      if (!asset) throw new MediaBusinessError('MEDIA_NOT_FOUND');
      if (asset.ownerUserId !== command.actor.userId) throw new MediaBusinessError('MEDIA_NOT_OWNED');
      if (asset.status !== 'READY') throw new MediaBusinessError('MEDIA_NOT_READY');

      const eventMedia = manager.getRepository(EventMediaRecord);
      const existingAttachment = await eventMedia.findOneBy({ eventId: event.id, mediaAssetId: asset.id });
      if (existingAttachment) {
        if (existingAttachment.role === command.role && existingAttachment.altText === altText) {
          return { kind: 'EVENT_MEDIA_ATTACHED', eventMediaId: existingAttachment.id, eventId: event.id };
        }
        throw new MediaBusinessError('MEDIA_ALREADY_ATTACHED');
      }
      if (command.role === 'COVER') {
        await eventMedia.delete({ eventId: event.id, role: 'COVER' });
      } else {
        const galleryCount = await eventMedia.countBy({ eventId: event.id, role: 'GALLERY' });
        if (galleryCount >= 5) throw new MediaBusinessError('GALLERY_LIMIT_REACHED');
      }
      const position = command.role === 'COVER' ? 0 : await eventMedia.countBy({ eventId: event.id, role: 'GALLERY' });
      const attachment = eventMedia.create({
        eventId: event.id, mediaAssetId: asset.id, role: command.role, position, altText,
        addedByUserId: command.actor.userId, updatedByUserId: command.actor.userId, updatedByKind: 'USER', version: 1,
      });
      await eventMedia.save(attachment);
      return { kind: 'EVENT_MEDIA_ATTACHED', eventMediaId: attachment.id, eventId: event.id };
    });
  }

  private async detachEventMedia(command: Extract<MediaCommand, { kind: 'DETACH_EVENT_MEDIA' }>): Promise<MediaOutcome> {
    await this.requireVerifiedActiveUser(command.actor);
    await this.dataSource.transaction(async (manager) => {
      const attachment = await manager.getRepository(EventMediaRecord).findOneBy({ id: command.eventMediaId });
      if (!attachment) throw new MediaBusinessError('EVENT_MEDIA_NOT_FOUND');
      const event = await manager.getRepository(EventRecord).findOneBy({ id: attachment.eventId });
      if (!event) throw new MediaBusinessError('EVENT_NOT_FOUND');
      if (event.organizerId !== command.actor.userId) throw new MediaBusinessError('EVENT_ORGANIZER_REQUIRED');
      if (!['DRAFT', 'PUBLISHED'].includes(event.status) || event.startsAt <= new Date()) throw new MediaBusinessError('EVENT_MEDIA_NOT_EDITABLE');
      await manager.getRepository(EventMediaRecord).remove(attachment);
    });
    return { kind: 'EVENT_MEDIA_DETACHED', eventMediaId: command.eventMediaId };
  }

  private async deleteMediaAsset(command: Extract<MediaCommand, { kind: 'DELETE_MEDIA_ASSET' }>): Promise<MediaOutcome> {
    await this.requireVerifiedActiveUser(command.actor);
    const storageKey = await this.dataSource.transaction(async (manager) => {
      const asset = await manager.getRepository(MediaAssetRecord).findOneBy({ id: command.mediaAssetId });
      if (!asset) throw new MediaBusinessError('MEDIA_NOT_FOUND');
      if (asset.ownerUserId !== command.actor.userId) throw new MediaBusinessError('MEDIA_NOT_OWNED');
      if (asset.status === 'DELETED') return null;
      const [profileUse, eventMediaUse] = await Promise.all([
        manager.getRepository(ProfileRecord).countBy({ avatarMediaAssetId: asset.id }),
        manager.getRepository(EventMediaRecord).countBy({ mediaAssetId: asset.id }),
      ]);
      if (profileUse || eventMediaUse) throw new MediaBusinessError('MEDIA_STILL_ATTACHED');
      asset.status = 'DELETED';
      asset.deletedAt = new Date();
      asset.deletedByUserId = command.actor.userId;
      asset.updatedByUserId = command.actor.userId;
      asset.updatedByKind = 'USER';
      asset.version += 1;
      await manager.save(asset);
      return asset.storageKey;
    });
    if (storageKey) await this.storage.remove(storageKey);
    return { kind: 'MEDIA_ASSET_DELETED', mediaAssetId: command.mediaAssetId };
  }

  private async canView(asset: MediaAssetRecord, viewer: MediaIdentity | null, eventShareToken?: string): Promise<boolean> {
    if (viewer?.userId === asset.ownerUserId) return true;
    const profile = await this.dataSource.getRepository(ProfileRecord).findOneBy({ avatarMediaAssetId: asset.id });
    if (profile?.visibility === 'PUBLIC') return true;
    if (profile && viewer && profile.visibility === 'EVENT_ATTENDEES') {
      const shared = await this.dataSource.getRepository(AttendanceRecord).createQueryBuilder('viewerAttendance')
        .innerJoin(AttendanceRecord, 'ownerAttendance', "ownerAttendance.event_id = viewerAttendance.event_id AND ownerAttendance.user_id = :ownerId AND ownerAttendance.status = 'CONFIRMED'")
        .where('viewerAttendance.user_id = :viewerId', { viewerId: viewer.userId, ownerId: profile.userId })
        .andWhere("viewerAttendance.status IN ('CONFIRMED','PENDING','WAITLISTED')").getExists();
      if (shared) return true;
    }
    const attachments = await this.dataSource.getRepository(EventMediaRecord).findBy({ mediaAssetId: asset.id });
    for (const attachment of attachments) {
      const event = await this.dataSource.getRepository(EventRecord).findOneBy({ id: attachment.eventId });
      if (!event) continue;
      if (event.visibility === 'PUBLIC' && ['PUBLISHED', 'CANCELLED', 'COMPLETED'].includes(event.status)) return true;
      const organizer = event.organizerId === viewer?.userId;
      const attendance = viewer ? await this.dataSource.getRepository(AttendanceRecord).findOneBy({ eventId: event.id, userId: viewer.userId }) : null;
      const active = Boolean(attendance && ['CONFIRMED', 'PENDING', 'WAITLISTED'].includes(attendance.status));
      if (event.visibility === 'UNLISTED' && (organizer || active || eventShareToken === event.shareToken)) return true;
      if (event.visibility === 'PRIVATE' && (organizer || active || Boolean(viewer && await this.dataSource.getRepository(InvitationRecord).findOneBy({ eventId: event.id, recipientUserId: viewer.userId, status: 'PENDING' })))) return true;
    }
    return false;
  }

  private async requireVerifiedActiveUser(actor: { userId: string; verification: string }): Promise<void> {
    if (actor.verification !== 'VERIFIED') throw new MediaBusinessError('USER_NOT_VERIFIED');
    const user = await this.dataSource.getRepository(UserRecord).findOneBy({ id: actor.userId });
    if (!user || user.status !== 'ACTIVE' || !user.emailVerifiedAt) throw new MediaBusinessError('USER_NOT_VERIFIED');
  }

  private view(asset: MediaAssetRecord): OwnedMediaAsset {
    return { id: asset.id, mimeType: asset.mimeType, byteSize: asset.byteSize, width: asset.width ?? 0, height: asset.height ?? 0, status: 'READY', createdAt: asset.createdAt };
  }
}

function inspectImage(bytes: Uint8Array): InspectedImage {
  if (bytes.length < 12) throw new MediaBusinessError('MEDIA_INVALID_IMAGE');
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
    return inspectPng(bytes);
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return inspectJpeg(bytes);
  if (String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP') return inspectWebp(bytes);
  throw new MediaBusinessError('MEDIA_UNSUPPORTED_TYPE');
}

function inspectPng(bytes: Uint8Array): InspectedImage {
  let offset = 8;
  let width = 0;
  let height = 0;
  let sawHeader = false;
  while (offset + 12 <= bytes.length) {
    const length = readU32(bytes, offset);
    const type = String.fromCharCode(...bytes.slice(offset + 4, offset + 8));
    const chunkEnd = offset + 12 + length;
    if (chunkEnd > bytes.length) throw new MediaBusinessError('MEDIA_INVALID_IMAGE');
    if (!sawHeader) {
      if (type !== 'IHDR' || length !== 13) throw new MediaBusinessError('MEDIA_INVALID_IMAGE');
      width = readU32(bytes, offset + 8);
      height = readU32(bytes, offset + 12);
      if (!width || !height) throw new MediaBusinessError('MEDIA_INVALID_IMAGE');
      sawHeader = true;
    }
    if (type === 'IEND') {
      if (length !== 0 || chunkEnd !== bytes.length) throw new MediaBusinessError('MEDIA_INVALID_IMAGE');
      return { mimeType: 'image/png', width, height, extension: 'png' };
    }
    offset = chunkEnd;
  }
  throw new MediaBusinessError('MEDIA_INVALID_IMAGE');
}

function inspectJpeg(bytes: Uint8Array): InspectedImage {
  if (bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) throw new MediaBusinessError('MEDIA_INVALID_IMAGE');
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) throw new MediaBusinessError('MEDIA_INVALID_IMAGE');
    const marker = bytes[offset + 1]; const length = (bytes[offset + 2] << 8) + bytes[offset + 3];
    if (length < 2 || offset + 2 + length > bytes.length) throw new MediaBusinessError('MEDIA_INVALID_IMAGE');
    if (marker >= 0xc0 && marker <= 0xc3) {
      const height = (bytes[offset + 5] << 8) + bytes[offset + 6]; const width = (bytes[offset + 7] << 8) + bytes[offset + 8];
      if (!width || !height) throw new MediaBusinessError('MEDIA_INVALID_IMAGE');
      return { mimeType: 'image/jpeg', width, height, extension: 'jpeg' };
    }
    offset += 2 + length;
  }
  throw new MediaBusinessError('MEDIA_INVALID_IMAGE');
}

function inspectWebp(bytes: Uint8Array): InspectedImage {
  const kind = String.fromCharCode(...bytes.slice(12, 16));
  const declaredSize = readU32LittleEndian(bytes, 4);
  const chunkSize = readU32LittleEndian(bytes, 16);
  if (kind !== 'VP8X' || bytes.length < 30 || declaredSize + 8 !== bytes.length || chunkSize < 10 || 20 + chunkSize > bytes.length) throw new MediaBusinessError('MEDIA_INVALID_IMAGE');
  const width = 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16); const height = 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16);
  return { mimeType: 'image/webp', width, height, extension: 'webp' };
}

function readU32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] << 24) >>> 0) + (bytes[offset + 1] << 16) + (bytes[offset + 2] << 8) + bytes[offset + 3];
}

function readU32LittleEndian(bytes: Uint8Array, offset: number): number {
  return bytes[offset] + (bytes[offset + 1] << 8) + (bytes[offset + 2] << 16) + ((bytes[offset + 3] << 24) >>> 0);
}
