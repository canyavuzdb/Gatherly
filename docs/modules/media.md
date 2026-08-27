# Media design

This document applies the [application architecture](../architecture/application.md) pattern to Media Asset ownership, image validation, Profile avatars, Event Media, access-controlled delivery, and deletion.

## 1. Purpose and ownership

The `media` module owns Media Asset lifecycle, image-byte validation, local storage, Profile avatar selection, Event Media attachment, and authorization-aware image delivery. It owns neither Profile visibility nor Event lifecycle: it asks for the facts required to apply those rules when an image is opened or attached.

The module accepts only images in the MVP. It does not introduce S3, a CDN, presigned upload, video, animated-media handling, file conversion, or a background worker.

`auth` owns self-deletion. Within Auth's deletion transaction, it invokes a trusted internal media seam to retire the User's Media Assets; this is not a public media command and cannot be reached by an HTTP adapter.

## 2. External interface

The module has one command entry point and two narrow query entry points.

```ts
export interface MediaModule {
  decide(command: MediaCommand): Promise<MediaOutcome>;
  open(request: OpenMediaRequest): Promise<OpenedMedia>;
  listOwned(request: ListOwnedMediaRequest): Promise<OwnedMediaAsset[]>;
}

export type MediaCommand =
  | UploadImage
  | SetProfileAvatar
  | AttachEventMedia
  | DetachEventMedia
  | DeleteMediaAsset;

export type UploadImage = {
  kind: 'UPLOAD_IMAGE';
  actor: UserIdentity;
  image: {
    bytes: Uint8Array;
    declaredMimeType?: string;
  };
};

export type SetProfileAvatar = {
  kind: 'SET_PROFILE_AVATAR';
  actor: UserIdentity;
  mediaAssetId: MediaAssetId;
};

export type AttachEventMedia = {
  kind: 'ATTACH_EVENT_MEDIA';
  actor: UserIdentity;
  eventId: EventId;
  mediaAssetId: MediaAssetId;
  role: 'COVER' | 'GALLERY';
  altText?: string;
};

export type DetachEventMedia = {
  kind: 'DETACH_EVENT_MEDIA';
  actor: UserIdentity;
  eventMediaId: EventMediaId;
};

export type DeleteMediaAsset = {
  kind: 'DELETE_MEDIA_ASSET';
  actor: UserIdentity;
  mediaAssetId: MediaAssetId;
};

export type OpenMediaRequest = {
  mediaAssetId: MediaAssetId;
  viewer: UserIdentity | null;
  eventShareToken?: string;
};

export type ListOwnedMediaRequest = {
  actor: UserIdentity;
};

export type OpenedMedia = {
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  byteSize: number;
  bytes: ReadableStream<Uint8Array>;
};

export type OwnedMediaAsset = {
  id: MediaAssetId;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  byteSize: number;
  width: number;
  height: number;
  status: 'READY';
  createdAt: Instant;
};
```

`MediaOutcome` reports committed facts, never `storage_key`, a file-system path, ORM record, transaction, or authorization internals.

```ts
export type MediaOutcome =
  | { kind: 'IMAGE_UPLOADED'; mediaAsset: OwnedMediaAsset }
  | { kind: 'PROFILE_AVATAR_SET'; mediaAssetId: MediaAssetId }
  | { kind: 'EVENT_MEDIA_ATTACHED'; eventMediaId: EventMediaId; eventId: EventId }
  | { kind: 'EVENT_MEDIA_DETACHED'; eventMediaId: EventMediaId }
  | { kind: 'MEDIA_ASSET_DELETED'; mediaAssetId: MediaAssetId };
```

The small interface gives callers leverage: they state an image or attachment intent, while the implementation keeps byte validation, storage, access, and transactional attachment rules local.

## 3. Command semantics

| Command | Who may call it | Committed result |
| --- | --- | --- |
| `UPLOAD_IMAGE` | active Verified User | validates bytes, persists image in local storage, and creates a Ready Media Asset. |
| `SET_PROFILE_AVATAR` | asset owner | atomically points the Profile to the owner's Ready Media Asset. |
| `ATTACH_EVENT_MEDIA` | Event's Organizer | attaches the Organizer's Ready asset as Cover or Gallery media to an editable Event. |
| `DETACH_EVENT_MEDIA` | Event's Organizer | removes that Event Media record without deleting its Media Asset. |
| `DELETE_MEDIA_ASSET` | asset owner | marks an unattached asset Deleted and schedules local-file cleanup. |

`SET_PROFILE_AVATAR` replaces the old avatar pointer only; the former asset stays Ready and reusable. `ATTACH_EVENT_MEDIA` with `COVER` atomically replaces the Event's existing Cover record; it does not delete the old asset. Gallery assets are appended in attachment order. Gallery reordering is intentionally absent from the MVP.

## 4. Image and attachment invariants

1. Only a Verified User may upload, select an avatar, or attach an Event image.
2. An upload must be a valid JPEG, PNG, or WebP image of at most 10 MB. The real bytes determine type and dimensions; the declared MIME type is advisory only.
3. A successfully uploaded asset is `READY` immediately. `PENDING` and `PROCESSING` remain reserved for a future asynchronous processor.
4. Only the owner of a Ready Media Asset can make it their Profile avatar or attach it to their Event.
5. A Profile has at most one avatar.
6. An Event has at most one Cover and five Gallery records. The same Media Asset has at most one attachment to an Event.
7. Only a Draft or a Published Event before `starts_at` is media-editable. Cancelled, Completed, and started Events cannot gain, lose, or replace media.
8. `alt_text`, when supplied, is at most 250 characters.
9. A normally deleted Media Asset is owned by the actor and attached nowhere: not as an avatar or Event Media.
10. A `DELETED`, `REJECTED`, `PENDING`, or `PROCESSING` asset is never delivered or attached.

## 5. Upload, storage, and deletion

The implementation bounds input before reading it fully, inspects the image, and gives the resulting object a random `storage_key` which never crosses the external interface.

```text
receive at most 10 MB into temporary local storage
inspect actual bytes and extract MIME type, width, and height
reject invalid or unsupported data and remove temporary bytes
move valid data to generated storage_key
begin transaction
  create READY media_assets row
commit
if transaction fails: remove the stored file as compensation
```

This is synchronous by design. A committed Ready asset must have a readable local file. The inverse physical cleanup happens after the asset has committed as `DELETED`; if local-file removal fails, the file is inaccessible and cleanup can safely retry later.

The storage seam is internal:

```ts
interface MediaStorage {
  writeTemporary(bytes: Uint8Array): Promise<TemporaryMedia>;
  inspect(temporary: TemporaryMedia): Promise<InspectedImage>;
  commit(temporary: TemporaryMedia, storageKey: StorageKey): Promise<void>;
  open(storageKey: StorageKey): Promise<ReadableStream<Uint8Array>>;
  remove(storageKey: StorageKey): Promise<void>;
}
```

`DockerVolumeMediaStorage` is the production adapter. `TemporaryDirectoryMediaStorage` is the integration-test adapter. PostgreSQL stays inside the implementation: a generic repository seam has only one meaningful adapter today and would lower depth.

## 6. Delivery and authorization

`open` returns bytes only after it proves both that the asset is Ready and that the viewer can see at least one current use of it:

- the owner may open their own Ready asset from the media selector;
- an avatar follows the Profile visibility rule;
- Public Event Media is anonymous-readable;
- Unlisted Event Media requires the same valid share access as the Event;
- Private Event Media requires the same authorized access as the Event.

An asset attached in multiple allowed places may be delivered when any one of those checks succeeds. Direct storage URLs are never exposed. For an anonymous or unauthorized caller, a missing asset and a forbidden asset both surface as `MEDIA_NOT_VIEWABLE`, avoiding existence disclosure.

## 7. Self-deletion coordination

Self-deletion must not leave the deleted User's image visible through an old Event or Profile link. `auth` first validates all deletion preconditions, then runs its own User-state mutation and the media internal seam in one PostgreSQL transaction:

```text
lock User and verify deletion preconditions
detach Profile avatar and every Event Media record whose asset belongs to User
mark every Media Asset owned by User as DELETED
revoke pending Invitations and Refresh Sessions
pseudonymize Profile/User and mark User DELETED
commit
remove local files after commit
```

The media implementation owns the detach/delete sequence; Auth owns the overall deletion transaction and failure outcome. No public `DELETE_OWNED_MEDIA` command exists.

## 8. Business failures and idempotency

```text
USER_NOT_VERIFIED
MEDIA_TOO_LARGE
MEDIA_UNSUPPORTED_TYPE
MEDIA_INVALID_IMAGE
MEDIA_NOT_FOUND
MEDIA_NOT_OWNED
MEDIA_NOT_READY
MEDIA_ALREADY_DELETED
MEDIA_STILL_ATTACHED
EVENT_NOT_FOUND
EVENT_ORGANIZER_REQUIRED
EVENT_MEDIA_NOT_EDITABLE
EVENT_MEDIA_NOT_FOUND
GALLERY_LIMIT_REACHED
INVALID_ALT_TEXT
MEDIA_NOT_VIEWABLE
```

Expected failures are part of the interface; file-system and PostgreSQL faults remain exceptional. Repeating a successful `DELETE_MEDIA_ASSET` returns the already-deleted outcome and never exposes bytes. A repeated Cover assignment is idempotent when it selects the same asset and equivalent alt text.

## 9. Integration-test contract

The MediaModule interface is the test surface. Its integration tests must prove:

1. Invalid bytes, unsupported types, spoofed MIME declarations, and files over 10 MB never create a Ready asset.
2. A successful upload has readable local bytes and matching persisted metadata.
3. An unverified User cannot upload or attach media.
4. Avatar replacement leaves the former asset Ready and usable.
5. An Organizer cannot attach another User's asset; a non-Organizer cannot edit Event Media.
6. Cover replacement is atomic; Gallery admits at most five assets and no duplicate Event attachment.
7. Event media mutation fails after the Event starts or is no longer editable.
8. A referenced asset cannot be deleted; detaching every use permits deletion and removes access.
9. Public, Unlisted, Private, Profile, owner, and anonymous delivery paths apply the proper access rule without exposing storage keys.
10. Self-deletion detaches owned media, makes all owned assets inaccessible, and leaves no visible Profile or Event Media link.

## 10. Implementation map

```text
apps/api/src/media/
  media.module.ts
  media.interface.ts
  media.commands.ts
  media.results.ts
  media.errors.ts
  media.implementation.ts
  media.persistence.ts
  media.storage.ts
  media.http.ts
  media.integration-spec.ts
```

This is a responsibility map, not a requirement for shallow forwarding files. The deep implementation centralizes file validation, storage compensation, attachment constraints, and delivery authorization.

## 11. Related documents

- [System design](../architecture/system.md)
- [Application architecture](../architecture/application.md)
- [Auth design](./auth.md)
- [Event design](./events.md)
- [Data model](../architecture/data-model.md)
- [Domain glossary](../domain-glossary.md)
