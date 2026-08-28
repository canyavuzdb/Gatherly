export type MediaIdentity = { userId: string; verification: 'VERIFIED' | 'UNVERIFIED' };

export type OwnedMediaAsset = {
  id: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  byteSize: number;
  width: number;
  height: number;
  status: 'READY';
  createdAt: Date;
};

export type MediaCommand =
  | { kind: 'UPLOAD_IMAGE'; actor: MediaIdentity; image: { bytes: Uint8Array; declaredMimeType?: string } }
  | { kind: 'SET_PROFILE_AVATAR'; actor: MediaIdentity; mediaAssetId: string }
  | { kind: 'CLEAR_PROFILE_AVATAR'; actor: MediaIdentity }
  | { kind: 'ATTACH_EVENT_MEDIA'; actor: MediaIdentity; eventId: string; mediaAssetId: string; role: 'COVER' | 'GALLERY'; altText?: string }
  | { kind: 'DETACH_EVENT_MEDIA'; actor: MediaIdentity; eventMediaId: string }
  | { kind: 'DELETE_MEDIA_ASSET'; actor: MediaIdentity; mediaAssetId: string };

export type MediaOutcome =
  | { kind: 'IMAGE_UPLOADED'; mediaAsset: OwnedMediaAsset }
  | { kind: 'PROFILE_AVATAR_SET'; mediaAssetId: string }
  | { kind: 'PROFILE_AVATAR_CLEARED' }
  | { kind: 'EVENT_MEDIA_ATTACHED'; eventMediaId: string; eventId: string }
  | { kind: 'EVENT_MEDIA_DETACHED'; eventMediaId: string }
  | { kind: 'MEDIA_ASSET_DELETED'; mediaAssetId: string };

export type OpenedMedia = {
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  byteSize: number;
  bytes: Buffer;
};

export interface MediaModule {
  decide(command: MediaCommand): Promise<MediaOutcome>;
  open(request: { mediaAssetId: string; viewer: MediaIdentity | null; eventShareToken?: string }): Promise<OpenedMedia>;
  listOwned(request: { actor: MediaIdentity }): Promise<OwnedMediaAsset[]>;
}
